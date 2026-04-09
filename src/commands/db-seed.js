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

export async function dbSeed() {
  const seedsPath = resolveFile('seeds.sql');

  if (!seedsPath) {
    throw new Error(
      'seeds.sql not found. Looked in database/seeds.sql and ./seeds.sql.\nAre you in a Flowmo project directory?'
    );
  }

  const seeds = fs.readFileSync(seedsPath, 'utf-8').trim();

  if (!seeds) {
    throw new Error(`${seedsPath} is empty. Add your INSERT statements first.`);
  }

  console.log(picocolors.cyan('Seeding database…'));
  console.log(picocolors.dim(`Using: ${seedsPath}`));

  const db = await getDb();
  await db.exec(seeds);
  await closeDb();

  console.log(picocolors.green(`✓ Database seeded from ${seedsPath}`));
}
