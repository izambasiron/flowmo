import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { getDb, closeDb } from '../lib/db.js';
import { parseAdvancedSql } from '../lib/parser.js';
import { renderTable } from '../lib/table.js';

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
  // Parse flags: --simple, --limit <n> / --limit=<n>
  let simple = false;
  let limit = 10;
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--simple') {
      simple = true;
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
    renderTable(result.fields, result.rows, { simple, limit });
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
    // Parse OutSystems syntax and map named @params to Postgres positional bindings.
    const { sql: parsedSql, paramNames } = parseAdvancedSql(rawSql);
    sql = parsedSql;

    if (paramNames.length > 0) {
      const paramsObj = paramsJson ? parseJsonArg(paramsJson) : {};

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

  renderTable(result.fields, result.rows, { simple, limit });
}
