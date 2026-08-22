import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';

function resolveFile(filename) {
  const candidates = [
    path.join(process.cwd(), 'database', filename),
    path.join(process.cwd(), filename),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export async function mentorPrompt(rawArgs = []) {
  let outputFile = null;
  let outputFlagSeen = false;
  const advanceSqlArgs = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--output') { outputFlagSeen = true; outputFile = rawArgs[++i]; }
    else if (a.startsWith('--output=')) { outputFlagSeen = true; outputFile = a.slice(9); }
    else advanceSqlArgs.push(a);
  }

  if (outputFlagSeen && !outputFile) {
    throw new Error('--output requires a file path, e.g. --output mentor-prompt.md');
  }

  const localPath = resolveFile('schema.local.sql');
  const localSql = localPath ? fs.readFileSync(localPath, 'utf-8').trim() : '';

  const queries = [];
  for (const arg of advanceSqlArgs) {
    const resolved = path.resolve(process.cwd(), arg);
    if (!fs.existsSync(resolved)) {
      console.error(picocolors.yellow(`⚠  Skipping ${arg} — file not found`));
      continue;
    }
    queries.push({ file: arg, sql: fs.readFileSync(resolved, 'utf-8').trim() });
  }

  if (!localSql && queries.length === 0) {
    throw new Error(
      'Nothing to prompt from. Add local-only entities to database/schema.local.sql ' +
      'or pass one or more .advance.sql files.'
    );
  }

  const sections = ['# Mentor Prompt: Sync local Flowmo changes to OutSystems'];

  if (localSql) {
    sections.push(
      '## Entities to create or update\n\n' +
      'Create OutSystems entities matching this exact schema. Match column ' +
      'names, types, nullability, and primary/foreign keys exactly:\n\n' +
      '```sql\n' + localSql + '\n```'
    );
  }

  if (queries.length > 0) {
    const queryBlocks = queries.map((q) => `### ${q.file}\n\n\`\`\`sql\n${q.sql}\n\`\`\``).join('\n\n');
    sections.push(
      '## Server Actions to implement\n\n' +
      'Implement a Server Action equivalent to each validated, already-tested ' +
      'query below. These queries were run and verified against a local ' +
      'PGlite database using this same schema — treat their logic as correct; ' +
      'translate the SQL into OutSystems Aggregates/Advanced SQL nodes ' +
      'preserving parameter names and result shape.\n\n' + queryBlocks
    );
  }

  const prompt = sections.join('\n\n') + '\n';

  if (outputFile) {
    const outPath = path.resolve(process.cwd(), outputFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, prompt);
    console.log(picocolors.green(`✓ Mentor prompt written to ${outputFile}`));
  } else {
    console.log(prompt);
  }
}
