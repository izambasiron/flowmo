import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

let _db = null;

export function getDbPath() {
  return path.join(process.cwd(), '.flowmo', 'database');
}

/**
 * Returns a singleton PGlite instance, initialised and ready to query.
 * Data is persisted to <cwd>/.flowmo/database.
 */
export async function getDb() {
  if (_db) return _db;

  const dbPath = getDbPath();
  fs.mkdirSync(dbPath, { recursive: true });

  _db = new PGlite(dbPath);
  await _db.waitReady;

  return _db;
}

/**
 * Close the singleton database connection.
 * Call at the end of a command to release file locks.
 */
export async function closeDb() {
  if (_db) {
    await _db.close();
    _db = null;
  }
}
