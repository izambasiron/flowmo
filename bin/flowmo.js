#!/usr/bin/env node
import picocolors from 'picocolors';

const [, , command, ...args] = process.argv;

const HELP = `
${picocolors.cyan(`
      ___       ___           ___ 
     /\\__\\     /\\  \\         /\\__\\
    /:/  /    /::\\  \\       /:/  /
   /:/  /    /:/\\:\\  \\     /:/  / 
  /:/  /    /:/  \\:\\  \\   /:/  /  
 /:/__/    /:/__/ \\:\\__\\ /:/__/   
 \\:\\  \\    \\:\\  \\ /:/  / \\:\\  \\   
  \\:\\  \\    \\:\\  /:/  /   \\:\\  \\  
   \\:\\  \\    \\:\\/:/  /     \\:\\  \\ 
    \\:\\__\\    \\::/  /       \\:\\__\\
     \\/__/     \\/__/         \\/__/
`)}
${picocolors.bold('Flowmo CLI')} — Local prototyping engine for OutSystems-Lite workflows.

${picocolors.bold('Usage:')}
  flowmo <command> [options]

${picocolors.bold('Commands:')}
  ${picocolors.cyan('db:setup')}                            Reset and provision the local database from database/schema.sql
  ${picocolors.cyan('db:seed')} [file …]                    Seed from explicit file(s), database/seeds/ dir, or database/seeds.sql
  ${picocolors.cyan('db:reset')} [--seed [file …]]          Alias for db:setup; add --seed to also run seeds
  ${picocolors.cyan('db:query')} <file|sql> [params-json]   Execute a .sql/.advance.sql file or an inline SQL string
                                     ${picocolors.dim('--limit <n>')}  Max rows to show (default: 10)
                                     ${picocolors.dim('--simple')}     Plain key: value output, no truncation

${picocolors.bold('Examples:')}
  flowmo db:setup
  flowmo db:seed
  flowmo db:seed database/seeds/01_users.sql database/seeds/02_products.sql
  flowmo db:reset
  flowmo db:reset --seed
  flowmo db:reset --seed database/seeds/01_users.sql database/seeds/02_products.sql
  flowmo db:query database/queries/get_users.sql
  flowmo db:query database/queries/get_user.advance.sql '{"UserId": 1}'
  flowmo db:query "SELECT * FROM users"
  flowmo db:query database/queries/get_users.sql --limit 25
  flowmo db:query database/queries/get_users.sql --simple
`;

async function run() {
  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(command ? 1 : 0);
  }

  const { dbSetup } = await import('../src/commands/db-setup.js');
  const { dbSeed } = await import('../src/commands/db-seed.js');
  const { dbReset } = await import('../src/commands/db-reset.js');
  const { dbQuery } = await import('../src/commands/db-query.js');

  const commands = {
    'db:setup': () => dbSetup(),
    'db:seed': () => dbSeed(args),
    'db:reset': () => dbReset(args),
    // Join all args after the file path in case the shell splits the JSON string.
    'db:query': () => dbQuery(args),
  };

  if (!commands[command]) {
    console.error(picocolors.red(`Unknown command: ${command}`));
    console.log(HELP);
    process.exit(1);
  }

  try {
    await commands[command]();
  } catch (err) {
    console.error(picocolors.red(`\nError: ${err.message}`));
    process.exit(1);
  }
}

run();
