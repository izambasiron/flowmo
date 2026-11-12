import fs from 'fs';
import path from 'path';
import Table from 'cli-table3';
import picocolors from 'picocolors';
import { transformContextEntities } from '../lib/context-entities.js';
import { toSnakeCase, TYPE_MAP, resolveRefType } from '../lib/schema-gen.js';
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
  // Mirrors schema-gen.js's generateSchema(): a PK can also be an FK, so
  // this isn't gated on !attr.isKey — that column's real emitted type
  // still comes from the referenced entity's PK, not its own dataType.
  // Uses the same chain-following resolver, so a key that is itself an FK
  // (shared identity) resolves to the same base type generateSchema emits.
  if (attr.isForeignKey && attr.references) return resolveRefType(attr, entitiesByKey);
  return pgType(attr.dataType);
}

// Local schema.local.sql is hand-written and can legally use any Postgres
// spelling of a type (SERIAL for a dev-convenience auto-increment PK, INT
// instead of INTEGER, VARCHAR(n) instead of a bare TEXT column, etc.) —
// TYPE_MAP only ever emits one canonical spelling per OutSystems type, so
// without normalizing these synonyms first, a semantically-identical,
// already-landed column reads as a false "attribute mismatch".
function normalizeType(type) {
  const t = type.trim().toUpperCase();
  if (t.startsWith('BIGSERIAL')) return 'BIGINT';
  if (t.startsWith('SMALLSERIAL')) return 'SMALLINT';
  if (t.startsWith('SERIAL')) return 'INTEGER';

  // Character types: any length here is a local-only constraint —
  // OutSystems' Text/Email/etc. attributes have no length dimension in
  // TYPE_MAP, so the comparison target is always bare TEXT regardless.
  if (/^(VARCHAR|CHARACTER VARYING|CHAR|CHARACTER)(\(\d+\))?\b/.test(t)) return 'TEXT';

  if (/^TIMESTAMP\s+WITH\s+TIME\s+ZONE\b/.test(t)) return 'TIMESTAMPTZ';

  // NUMERIC/DECIMAL are true Postgres synonyms — keep the precision (a
  // real divergence worth flagging), just canonicalize the keyword.
  // NB: the \b must come before the optional precision group, not after —
  // a \b following ")" (a non-word char) can never match, so the regex
  // would backtrack and silently abandon the precision, making DECIMAL(10,2)
  // indistinguishable from NUMERIC(28,8) (a false "confirmed").
  const numeric = t.match(/^(?:NUMERIC|DECIMAL)\b(\(\d+(?:,\d+)?\))?/);
  if (numeric) return `NUMERIC${numeric[1] ?? ''}`;

  if (/^INT4?\b/.test(t)) return 'INTEGER';
  if (/^INT8\b/.test(t)) return 'BIGINT';
  if (/^INT2\b/.test(t)) return 'SMALLINT';
  // Older pulls (and hand-written schemas following the old docs) used
  // BOOLEAN for Boolean; ODC stores it as NUMERIC(28,8), which is what
  // TYPE_MAP now emits, so don't report it as a mismatch. (An
  // INTEGER-for-Boolean column can't be aliased without hiding real
  // Integer/Boolean mismatches; it is reported.) The matching DATE alias is
  // attribute-aware, so it lives in the comparison below, not here.
  if (/^BOOL(EAN)?\b/.test(t)) return 'NUMERIC(28,8)';

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

  // Intentionally one-directional: this checks that every schema.local.sql
  // table/column landed remotely, not the reverse. A remote entity with
  // extra columns not present locally is not flagged — verify's job is
  // confirming your intended push landed, not a full schema diff.
  const report = localTables.map((table) => {
    const entity = entities.find((e) => toSnakeCase(e.name) === table.name);

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
      let actual = normalizeType(col.type);
      // A legacy DATE column is fine for a Date attribute (ODC stores it as
      // timestamptz), but not for a Date Time one: DATE drops the time.
      if (actual === 'DATE' && attr.dataType === 'Date') actual = 'TIMESTAMPTZ';
      if (expected !== actual) {
        details.push(`${col.name}: local ${actual} vs remote ${expected}`);
      }
    }

    return { table: table.name, status: details.length ? 'attribute mismatch' : 'confirmed', details };
  });

  const allConfirmed = report.every((r) => r.status === 'confirmed');
  // A scripted caller (an agent, CI) relies on the exit code to detect an
  // incomplete verification without having to parse output.
  if (!allConfirmed) process.exitCode = 1;

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

  if (allConfirmed) {
    console.log(picocolors.green('\n✓ All local entities confirmed live in OutSystems.'));
    console.log(picocolors.dim("Re-run 'flowmo schema:pull' to fold them into schema.os.sql."));
  } else {
    console.log(picocolors.dim("\nRe-run 'flowmo schema:pull' once all tables above show 'confirmed' to refresh schema.os.sql."));
  }
}
