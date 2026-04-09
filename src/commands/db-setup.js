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
  const schemaPath = resolveFile('schema.sql');

  if (!schemaPath) {
    throw new Error(
      'schema.sql not found. Looked in database/schema.sql and ./schema.sql.\nAre you in a Flowmo project directory?'
    );
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8').trim();

  if (!schema) {
    throw new Error(`${schemaPath} is empty. Add your CREATE TABLE statements first.`);
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
