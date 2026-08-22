/**
 * Minimal, forgiving multi-table CREATE TABLE parser used by schema:verify
 * to compare `database/schema.local.sql` against a fresh entities pull.
 * Not a strict SQL parser — just enough to get table/column names and
 * types for a diff report.
 */

/**
 * @param {string} sql  Full contents of a .sql file, one or more CREATE TABLE statements
 * @returns {Array<{ name: string, columns: Array<{ name: string, type: string }> }>}
 */
export function parseCreateTables(sql) {
  const chunks = sql.split(/CREATE TABLE\s+/gi).slice(1);
  const tables = [];

  for (const chunk of chunks) {
    const nameMatch = chunk.match(/^(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(/i);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const body = chunk.slice(chunk.indexOf('(') + 1);
    const rawColumns = [];
    let depth = 0;
    let current = '';

    for (const ch of body) {
      if (ch === '(') depth++;
      if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      if (ch === ',' && depth === 0) {
        rawColumns.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) rawColumns.push(current.trim());

    const columns = [];
    for (const col of rawColumns) {
      if (/^\s*(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)/i.test(col)) continue;
      const parts = col.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const colName = parts[0].replace(/["']/g, '');
      const colType = parts.slice(1).join(' ').toUpperCase();
      columns.push({ name: colName, type: colType });
    }

    tables.push({ name, columns });
  }

  return tables;
}
