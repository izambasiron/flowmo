import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { getDb, closeDb } from '../lib/db.js';

/**
 * Resolve seed files to execute, in order.
 *
 * Resolution tiers:
 *   1. Explicit list (args provided) — resolved relative to <cwd>/database/ then <cwd>/
 *   2. Auto-discover database/seeds/ directory — all .sql files alphabetically
 *   3. Fallback to database/seeds.sql or ./seeds.sql
 */
function resolveSeedFiles(args) {
  // 1. Explicit list.
  if (args && args.length > 0) {
    return args.map((f) => {
      const candidates = [
        path.join(process.cwd(), 'database', f),
        path.join(process.cwd(), f),
        path.resolve(f),
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (!found) {
        throw new Error(`Seed file not found: ${f}`);
      }
      return found;
    });
  }

  // 2. Auto-discover seeds/ directory.
  const seedsDir = path.join(process.cwd(), 'database', 'seeds');
  if (fs.existsSync(seedsDir) && fs.statSync(seedsDir).isDirectory()) {
    const files = fs.readdirSync(seedsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => path.join(seedsDir, f));
    if (files.length > 0) return files;
  }

  // 3. Fallback: single seeds.sql.
  const candidates = [
    path.join(process.cwd(), 'database', 'seeds.sql'),
    path.join(process.cwd(), 'seeds.sql'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      'No seed files found. Looked for database/seeds/, database/seeds.sql, and ./seeds.sql.\nAre you in a Flowmo project directory?'
    );
  }
  return [found];
}

export async function dbSeed(files = []) {
  const seedPaths = resolveSeedFiles(files);

  console.log(picocolors.cyan('Seeding database…'));

  const db = await getDb();

  for (const seedsPath of seedPaths) {
    const seeds = fs.readFileSync(seedsPath, 'utf-8').trim();

    if (!seeds) {
      throw new Error(`${seedsPath} is empty. Add your INSERT statements first.`);
    }

    console.log(picocolors.dim(`Running: ${seedsPath}`));
    await db.exec(seeds);
    console.log(picocolors.green(`✓ ${path.basename(seedsPath)}`));
  }

  await closeDb();

  console.log(picocolors.green(`\n✓ Database seeded (${seedPaths.length} file${seedPaths.length === 1 ? '' : 's'})`));
}
