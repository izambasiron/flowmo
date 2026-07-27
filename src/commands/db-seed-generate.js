import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';

/**
 * Parse a CREATE TABLE statement into column metadata.
 * Returns { name, columns: [{name, type, isFk, refTable, isNullable}] }
 */
function parseTable(sql) {
  const nameMatch = sql.match(/CREATE TABLE\s+["']?(\w+)["']?\s*\(/i);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  // Extract column definitions
  const body = sql.slice(sql.indexOf('(') + 1);
  const columns = [];
  let depth = 0;
  let current = '';

  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (ch === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) columns.push(current.trim());

  const parsed = [];
  for (const col of columns) {
    if (/^\s*(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)/i.test(col)) continue;

    const parts = col.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const colName = parts[0].replace(/["']/g, '');
    const colType = parts.slice(1).join(' ').toUpperCase();

    const isFk = /REFERENCES\s+["']?(\w+)/i.test(colType);
    const refTable = isFk ? (colType.match(/REFERENCES\s+["']?(\w+)/i) || [])[1] : null;
    const isNullable = !/NOT\s+NULL/i.test(colType) || /SERIAL|BIGSERIAL/i.test(colType);

    parsed.push({ name: colName, type: colType, isFk, refTable, isNullable });
  }

  return { name, columns: parsed };
}

/**
 * Generate a plausible value for a column based on its name and type.
 */
function generateValue(col, rowIndex) {
  const { name, type, isFk, isNullable } = col;

  // Skip serial/auto-increment columns
  if (/SERIAL/i.test(type)) return null;

  // Nullable: 10% chance of null
  if (isNullable && Math.random() < 0.1) return 'NULL';

  // Foreign keys: random ID in 1-20 range
  if (isFk) return String(Math.floor(Math.random() * 20) + 1);

  // By column name
  const lower = name.toLowerCase();
  if (lower === 'id') return String(rowIndex + 1);
  if (lower.includes('name') || lower === 'label') return `'${name}_${rowIndex + 1}'`;
  if (lower.includes('email')) return `'user${rowIndex + 1}@example.com'`;
  if (lower.includes('description') || lower.includes('notes') || lower.includes('message'))
    return `'Sample ${name.replace(/_/g, ' ')} ${rowIndex + 1}'`;
  if (lower.includes('guid') || lower.includes('uuid'))
    return `'00000000-0000-0000-0000-${String(rowIndex).padStart(12, '0')}'`;
  if (lower.includes('code') || lower.includes('reference'))
    return `'${name.substring(0, 3).toUpperCase()}-${String(rowIndex + 1).padStart(4, '0')}'`;
  if (lower.includes('url') || lower.includes('photo'))
    return `'https://example.com/${name}/${rowIndex + 1}'`;
  if (lower.includes('phone')) return `'+6012${String(3000000 + rowIndex)}'`;
  if (lower.includes('color') || lower.includes('colour')) return `'#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}'`;

  // By type
  if (/TEXT/i.test(type)) return `'value_${rowIndex + 1}'`;
  if (/INTEGER|BIGINT|NUMERIC|DECIMAL/i.test(type))
    return String(Math.floor(Math.random() * 100) + 1);
  if (/BOOLEAN/i.test(type)) return Math.random() > 0.5 ? 'true' : 'false';
  if (/TIMESTAMP|DATE/i.test(type))
    return `'2026-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}'`;

  return `'gen_${rowIndex + 1}'`;
}

/**
 * Generate INSERT statements for a table.
 */
function generateInserts(table, count) {
  const columns = table.columns.filter(c => !/SERIAL/i.test(c.type));
  const colNames = columns.map(c => `"${c.name}"`).join(', ');

  const rows = [];
  for (let i = 0; i < count; i++) {
    const values = columns.map(c => generateValue(c, i)).filter(v => v !== null);
    rows.push(`INSERT INTO "${table.name}" (${colNames}) VALUES (${values.join(', ')});`);
  }

  return rows;
}

export async function dbSeedGenerate(rawArgs = []) {
  // Parse: flowmo db:seed:generate <table> <count> [--output <file>]
  let outputFile = null;
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--output') {
      outputFile = rawArgs[++i];
    } else if (a.startsWith('--output=')) {
      outputFile = a.slice(9);
    } else {
      positional.push(a);
    }
  }

  if (positional.length < 2) {
    throw new Error(
      'Usage: flowmo db:seed:generate <table> <count> [--output <file>]\n' +
      'Example: flowmo db:seed:generate project 10 --output database/seeds/dev/projects.sql'
    );
  }

  const tableName = positional[0].toLowerCase();
  const count = Math.max(1, parseInt(positional[1], 10) || 10);

  // Find the schema file
  const schemaFiles = [
    path.join(process.cwd(), 'database', 'schema.os.sql'),
    path.join(process.cwd(), 'database', 'schema.sql'),
  ];
  const schemaPath = schemaFiles.find(f => fs.existsSync(f));
  if (!schemaPath) throw new Error('No schema file found. Expected database/schema.os.sql or database/schema.sql');

  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const tables = schema.split(/CREATE TABLE\s+/gi).slice(1).map(t => 'CREATE TABLE ' + t.trim());

  const tableSql = tables.find(t => {
    const m = t.match(/CREATE TABLE\s+["']?(\w+)/i);
    return m && m[1].toLowerCase() === tableName;
  });

  if (!tableSql) {
    const available = tables.map(t => {
      const m = t.match(/CREATE TABLE\s+["']?(\w+)/i);
      return m ? m[1] : '?';
    }).join(', ');
    throw new Error(`Table "${tableName}" not found in schema. Available: ${available}`);
  }

  const table = parseTable(tableSql);
  if (!table) throw new Error(`Could not parse table: ${tableName}`);

  const inserts = generateInserts(table, count);
  const sql = inserts.join('\n');

  if (outputFile) {
    const outPath = path.resolve(process.cwd(), outputFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, sql + '\n');
    console.log(picocolors.green(`✓ ${count} rows → ${outputFile}`));
  } else {
    console.log(sql);
  }
}
