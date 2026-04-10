import picocolors from 'picocolors';
import { dbSetup } from './db-setup.js';
import { dbSeed } from './db-seed.js';

export async function dbReset(args = []) {
  const seedIdx = args.indexOf('--seed');
  const hasSeed = seedIdx !== -1;
  // Everything after --seed is the explicit file list (empty = auto-discover).
  const seedFiles = hasSeed ? args.slice(seedIdx + 1) : [];

  await dbSetup();

  if (hasSeed) {
    console.log('');
    await dbSeed(seedFiles);
  } else {
    console.log(picocolors.dim('\nTip: run with --seed to also seed the database.'));
  }
}
