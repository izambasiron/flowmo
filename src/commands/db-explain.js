import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { getDb, closeDb } from '../lib/db.js';
import { parseAdvancedSql } from '../lib/parser.js';
import { parseJsonArg } from './db-query.js';

export async function dbExplain(rawArgs = []) {
  // Parse flags: --param K=V
  let paramFlags = {};
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--param') {
      const kv = rawArgs[++i];
      if (kv) {
        const eq = kv.indexOf('=');
        if (eq > 0) paramFlags[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
    } else if (a.startsWith('--param=')) {
      const kv = a.slice(8);
      const eq = kv.indexOf('=');
      if (eq > 0) paramFlags[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    throw new Error('Usage: flowmo db:explain <file.advance.sql> [--param K=V …]');
  }

  const filePath = positional[0];
  const paramsJson = positional.length > 1 ? positional.slice(1).join(' ') : undefined;

  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let sql = fs.readFileSync(resolved, 'utf-8').trim();
  if (!sql) throw new Error(`Query file is empty: ${filePath}`);

  let params = [];

  if (resolved.endsWith('.advance.sql')) {
    const { sql: parsedSql, paramNames } = parseAdvancedSql(sql);
    sql = parsedSql;

    if (paramNames.length > 0) {
      let paramsObj = paramsJson ? parseJsonArg(paramsJson) : {};
      Object.assign(paramsObj, paramFlags);

      const missing = paramNames.filter((n) => !(n in paramsObj));
      if (missing.length > 0) {
        throw new Error(
          `Missing required parameter(s): ${missing.map((n) => `@${n}`).join(', ')}\n` +
          `Pass them with --param, e.g.: --param ${missing[0]}=value`
        );
      }

      params = paramNames.map((n) => paramsObj[n]);
      const binding = paramNames.map((n, i) => `@${n} → $${i + 1}`).join(', ');
      console.log(picocolors.dim(`Bindings: ${binding}\n`));
    }
  }

  // Wrap in EXPLAIN ANALYZE
  sql = `EXPLAIN (ANALYZE, COSTS, BUFFERS, FORMAT TEXT) ${sql}`;

  const db = await getDb();
  const result = await db.query(sql, params);
  await closeDb();

  console.log(picocolors.bold('Query Plan'));
  console.log(picocolors.dim('─'.repeat(60)));

  for (const row of result.rows) {
    // EXPLAIN output comes as a single column 'QUERY PLAN'
    const plan = row['QUERY PLAN'] || row['query_plan'] || Object.values(row).join('');
    console.log(plan);
  }

  console.log(picocolors.dim('─'.repeat(60)));
}
