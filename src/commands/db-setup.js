import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { getDb, closeDb } from '../lib/db.js';

function resolveFile(filename) {
  const candidates = [
    path.join(process.cwd(), 'database', filename),
    path.join(process.cwd(), filename),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export async function dbSetup() {
  // Support split schema: schema.os.sql (forge dump) + schema.local.sql (local additions)
  const osPath = resolveFile('schema.os.sql');
  const localPath = resolveFile('schema.local.sql');
  const singlePath = resolveFile('schema.sql');

  let schemaPath;
  let schema;

  if (osPath && localPath) {
    // Both split files exist — concatenate them
    const osSchema = fs.readFileSync(osPath, 'utf-8').trim();
    const localSchema = fs.readFileSync(localPath, 'utf-8').trim();

    if (!osSchema && !localSchema) {
      throw new Error('Both schema.os.sql and schema.local.sql are empty.');
    }

    schemaPath = `${osPath} + ${localPath}`;
    schema = [osSchema, localSchema].filter(Boolean).join('\n\n');

    console.log(picocolors.dim(`Using: ${osPath}`));
    console.log(picocolors.dim(`     + ${localPath}`));
  } else if (singlePath) {
    schemaPath = singlePath;
    schema = fs.readFileSync(singlePath, 'utf-8').trim();

    if (!schema) {
      throw new Error(`${singlePath} is empty. Add your CREATE TABLE statements first.`);
    }

    console.log(picocolors.dim(`Using: ${singlePath}`));
  } else {
    throw new Error(
      'No schema found. Expected one of:\n' +
      '  database/schema.os.sql + database/schema.local.sql (split)\n' +
      '  database/schema.sql (single file)\n' +
      'Are you in a Flowmo project directory?'
    );
  }

  console.log(picocolors.cyan('Setting up database…'));
  console.log(picocolors.dim(`Using: ${schemaPath}`));

  const db = await getDb();

  // Wipe the public schema so all user objects are removed cleanly.
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  // Apply the user-provided DDL.
  await db.exec(schema);

  await closeDb();

  console.log(picocolors.green(`✓ Database schema applied from ${schemaPath}`));
}
