import fs from 'fs';
import path from 'path';
import Table from 'cli-table3';
import picocolors from 'picocolors';
import { transformContextEntities } from '../lib/context-entities.js';
import { toSnakeCase, TYPE_MAP } from '../lib/schema-gen.js';
import { parseCreateTables } from '../lib/schema-local-parser.js';

function resolveFile(filename) {
  const candidates = [
    path.join(process.cwd(), 'database', filename),
    path.join(process.cwd(), filename),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function readInput(filePath) {
  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
    return fs.readFileSync(resolved, 'utf-8');
  }
  if (process.stdin.isTTY) {
    throw new Error(
      'Usage: flowmo schema:verify <fresh-entities.json>\n' +
      '       flowmo schema:verify   (reads a JSON array from stdin)\n\n' +
      'Pass a fresh, merged context_entities "data" array, taken after a Mentor publish.'
    );
  }
  return fs.readFileSync(0, 'utf-8');
}

function pgType(dataType) {
  return TYPE_MAP[dataType] ?? 'TEXT';
}

function resolvedAttrType(attr, entitiesByKey) {
  if (!attr.isKey && attr.isForeignKey && attr.references) {
    const target = entitiesByKey.get(attr.references);
    const pkAttr = target?.attrs.find((a) => a.isKey);
    if (pkAttr) return pgType(pkAttr.dataType);
  }
  return pgType(attr.dataType);
}

// Local schema.local.sql often uses SERIAL/BIGSERIAL for dev-convenience
// auto-increment PKs; the remote entity's real type never is — normalize
// both to the same base integer type before comparing so this doesn't read
// as a mismatch.
function normalizeType(type) {
  const t = type.trim().toUpperCase();
  if (t.startsWith('BIGSERIAL')) return 'BIGINT';
  if (t.startsWith('SMALLSERIAL')) return 'SMALLINT';
  if (t.startsWith('SERIAL')) return 'INTEGER';
  return t.split(/\s+/)[0];
}

export async function schemaVerify(rawArgs = []) {
  let json = false;
  const positional = [];
  for (const a of rawArgs) {
    if (a === '--json') json = true;
    else positional.push(a);
  }

  const localPath = resolveFile('schema.local.sql');
  const localSql = localPath ? fs.readFileSync(localPath, 'utf-8').trim() : '';
  if (!localSql) {
    throw new Error(
      'No database/schema.local.sql found — nothing to verify against. ' +
      '(Local-only entities live there; schema.os.sql is the mirror of what\'s already confirmed in OutSystems.)'
    );
  }
  const localTables = parseCreateTables(localSql);

  const raw = readInput(positional[0]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON input: ${e.message}`);
  }
  const { entities } = transformContextEntities(parsed);
  const entitiesByKey = new Map(entities.map((e) => [e.key, e]));

  const report = localTables.map((table) => {
    const entity = entities.find((e) => {
      const rawName = toSnakeCase(e.name);
      const name = rawName === 'user' ? '"user"' : rawName;
      return name.replace(/"/g, '') === table.name.replace(/"/g, '');
    });

    if (!entity) {
      return { table: table.name, status: 'missing', details: [] };
    }

    const details = [];
    for (const col of table.columns) {
      const attr = entity.attrs.find((a) => toSnakeCase(a.name) === col.name);
      if (!attr) {
        details.push(`missing column: ${col.name}`);
        continue;
      }
      const expected = normalizeType(resolvedAttrType(attr, entitiesByKey));
      const actual = normalizeType(col.type);
      if (expected !== actual) {
        details.push(`${col.name}: local ${actual} vs remote ${expected}`);
      }
    }

    return { table: table.name, status: details.length ? 'attribute mismatch' : 'confirmed', details };
  });

  if (json) {
    console.log(JSON.stringify({ report }));
    return;
  }

  const cliTable = new Table({ head: ['Table', 'Status', 'Details'] });
  const colorForStatus = { confirmed: picocolors.green, missing: picocolors.red, 'attribute mismatch': picocolors.yellow };
  for (const row of report) {
    const color = colorForStatus[row.status] ?? ((s) => s);
    cliTable.push([row.table, color(row.status), row.details.join('\n') || '—']);
  }
  console.log(cliTable.toString());

  const allConfirmed = report.every((r) => r.status === 'confirmed');
  if (allConfirmed) {
    console.log(picocolors.green('\n✓ All local entities confirmed live in OutSystems.'));
    console.log(picocolors.dim("Re-run 'flowmo schema:pull' to fold them into schema.os.sql."));
  } else {
    console.log(picocolors.dim("\nRe-run 'flowmo schema:pull' once all tables above show 'confirmed' to refresh schema.os.sql."));
  }
}
