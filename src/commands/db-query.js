import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { getDb, closeDb } from '../lib/db.js';
import { parseAdvancedSql } from '../lib/parser.js';
import { applyO11Dialect } from '../lib/dialect-o11.js';
import { renderTable } from '../lib/table.js';

/**
 * Reads the "flowmo".platform field from the project's package.json.
 * Defaults to 'ODC' if the file is missing or the field is not set.
 */
function getProjectPlatform() {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) return 'ODC';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg?.flowmo?.platform ?? 'ODC';
  } catch {
    return 'ODC';
  }
}

/**
 * Parse a JSON parameter string from the shell.
 *
 * On Windows, cmd.exe (invoked via npx) strips double quotes from arguments,
 * turning {"Key":"val"} into {Key:val}. This helper attempts to recover by
 * re-quoting bare keys and string values before parsing.
 */
export function parseJsonArg(raw) {
  if (!raw) return {};

  // 1. Try strict JSON first — covers correctly-quoted input.
  try {
    return JSON.parse(raw);
  } catch {}

  // 2. Try to restore quotes stripped by Windows cmd.exe.
  try {
    const fixed = raw
      // Restore empty strings collapsed to a lone " by cmd.exe:  Key: ",  or  Key: "}
      .replace(/:\s*"(\s*[,}])/g, ': ""$1')
      // Quote unquoted object keys:  {Key:  or  ,Key:
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)\s*:/g, '$1"$2":')
      // Restore empty string values stripped by cmd.exe:  "key":,  or  "key":}
      .replace(/("[\w$-]+":\s*)(,|})/g, (m, key, end) => `${key}""${end}`)
      // Quote unquoted string values (leave numbers, booleans, null untouched).
      // Use a lookahead so values can contain commas (e.g. "1,2" for multi-value params).
      // A value ends only at `,"key":` or `}`, not at every comma.
      .replace(/("[\w$-]+":\s*)([^",{\[\]\s][^}]*?)(?=\s*(?:,\s*"[\w$-]+"\s*:|}))/g, (m, key, val) => {
        const t = val.trim();
        if (t === 'true' || t === 'false' || t === 'null' || /^-?\d+(\.\d+)?$/.test(t)) {
          return m;
        }
        return `${key}"${t}"`;
      });
    return JSON.parse(fixed);
  } catch {}

  throw new Error(
    `Could not parse parameters as JSON.\nReceived: ${raw}\n\n` +
    `On Windows PowerShell, wrap the JSON in single quotes:\n` +
    `  '{"Key":"Value"}'`
  );
}

export async function dbQuery(rawArgs = []) {
  // Parse flags: --simple, --json, --limit <n> / --limit=<n>, --param Key=Val
  let simple = false;
  let json = false;
  let limit = 10;
  let paramFlags = {};
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--simple') {
      simple = true;
    } else if (a === '--json') {
      json = true;
    } else if (a === '--param') {
      const kv = rawArgs[++i];
      if (kv) {
        const eq = kv.indexOf('=');
        if (eq > 0) {
          paramFlags[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
      }
    } else if (a.startsWith('--param=')) {
      const kv = a.slice(8);
      const eq = kv.indexOf('=');
      if (eq > 0) {
        paramFlags[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
    } else if (a === '--limit') {
      limit = Math.max(1, parseInt(rawArgs[++i], 10) || 10);
    } else if (a.startsWith('--limit=')) {
      limit = Math.max(1, parseInt(a.slice(8), 10) || 10);
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    throw new Error('Usage: flowmo db:query <file.sql> [params-json]\n       flowmo db:query "SELECT …" (inline SQL, no params)');
  }

  // Inline SQL mode: first positional arg does not end with .sql.
  const looksLikeFile = positional[0].endsWith('.sql');
  if (!looksLikeFile) {
    const inlineSql = positional.join(' ');
    console.log(picocolors.dim(`Query: ${inlineSql}\n`));
    const db = await getDb();
    const result = await db.query(inlineSql, []);
    await closeDb();
    renderTable(result.fields, result.rows, { simple, json, limit });
    return;
  }

  const filePath = positional[0];
  const paramsJson = positional.length > 1 ? positional.slice(1).join(' ') : undefined;

  const resolved = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const rawSql = fs.readFileSync(resolved, 'utf-8').trim();

  if (!rawSql) {
    throw new Error(`Query file is empty: ${filePath}`);
  }

  const isAdvanced = resolved.endsWith('.advance.sql');
  let sql = rawSql;
  let params = [];

  if (isAdvanced) {
    // Apply O11 T-SQL dialect pre-processor when the project platform is O11.
    let sqlToProcess = rawSql;
    const platform = getProjectPlatform();
    if (platform === 'O11') {
      const { sql: dialectSql, warnings } = applyO11Dialect(rawSql);
      sqlToProcess = dialectSql;
      if (warnings.length > 0) {
        console.log(picocolors.yellow('O11 dialect warnings:'));
        warnings.forEach((w) => console.log(picocolors.yellow(`  ⚠  ${w}`)));
        console.log('');
      }
    }

    // Parse OutSystems syntax and map named @params to Postgres positional bindings.
    const { sql: parsedSql, paramNames } = parseAdvancedSql(sqlToProcess);
    sql = parsedSql;

    if (paramNames.length > 0) {
      let paramsObj = paramsJson ? parseJsonArg(paramsJson) : {};

      // Merge --param flags (they override JSON params)
      Object.assign(paramsObj, paramFlags);

      // Validate all required params are supplied.
      const missing = paramNames.filter((n) => !(n in paramsObj));
      if (missing.length > 0) {
        throw new Error(
          `Missing required parameter(s): ${missing.map((n) => `@${n}`).join(', ')}\n` +
          `Pass them as a JSON string, e.g.: '${JSON.stringify(
            Object.fromEntries(paramNames.map((n) => [n, '...']))
          )}'`
        );
      }

      params = paramNames.map((n) => paramsObj[n]);

      const binding = paramNames.map((n, i) => `@${n} → $${i + 1}`).join(', ');
      console.log(picocolors.dim(`Bindings: ${binding}\n`));
    }
  } else if (paramsJson) {
    // For plain .sql files, accept a JSON array of positional params.
    const parsed = parseJsonArg(paramsJson);
    params = Array.isArray(parsed) ? parsed : Object.values(parsed);
  }

  const db = await getDb();
  const result = await db.query(sql, params);
  await closeDb();

  renderTable(result.fields, result.rows, { simple, json, limit });
}
