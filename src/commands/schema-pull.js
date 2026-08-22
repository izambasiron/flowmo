import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { transformContextEntities } from '../lib/context-entities.js';
import { generateSchema } from '../lib/schema-gen.js';

function resolveWriteTarget(filename) {
  const dbDir = path.join(process.cwd(), 'database');
  return fs.existsSync(dbDir) ? path.join(dbDir, filename) : path.join(process.cwd(), filename);
}

function readInput(filePath) {
  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
    return fs.readFileSync(resolved, 'utf-8');
  }
  if (process.stdin.isTTY) {
    throw new Error(
      'Usage: flowmo schema:pull <entities.json>\n' +
      '       flowmo schema:pull   (reads a JSON array from stdin)\n\n' +
      'Pass the merged "data" array from an OutSystems MCP context_entities call.'
    );
  }
  return fs.readFileSync(0, 'utf-8');
}

export async function schemaPull(rawArgs = []) {
  let dryRun = false;
  let json = false;
  const positional = [];

  for (const a of rawArgs) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--json') json = true;
    else positional.push(a);
  }

  // Diagnostics must never pollute stdout when stdout is carrying
  // machine-consumable output: the JSON summary in --json mode, or the raw
  // DDL in --dry-run mode (so `schema:pull ... --dry-run > file.sql` gets
  // only the DDL, not the summary/warning lines appended after it).
  const diag = (...args) => ((json || dryRun) ? console.error(...args) : console.log(...args));

  const raw = readInput(positional[0]);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON input: ${e.message}`);
  }

  const { entities, warnings } = transformContextEntities(parsed);

  // Never write an empty schema.os.sql — it would silently clobber the
  // previous good pull. Zero usable entities means bad input (empty array,
  // or every entity was skipped as attribute-less), so fail loudly rather
  // than warning-and-continuing like a single skipped entity.
  if (entities.length === 0) {
    const why = warnings.length ? `\n${warnings.map((w) => `  ⚠  ${w}`).join('\n')}` : '';
    throw new Error(`No usable entities found in input — schema.os.sql was NOT written.${why}`);
  }

  const ddl = generateSchema(entities);

  const owned = entities.filter((e) => !e.isReferenced);
  const dependencies = entities.filter((e) => e.isReferenced);
  const dependencyLibs = [...new Set(dependencies.map((e) => e.producerAssetName).filter(Boolean))];

  let written = null;
  if (!dryRun) {
    const target = resolveWriteTarget('schema.os.sql');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, ddl + '\n');
    written = target;
  }

  if (json) {
    console.log(JSON.stringify({
      written,
      ...(dryRun ? { ddl } : {}),
      tableCount: entities.length,
      ownedCount: owned.length,
      dependencyCount: dependencies.length,
      dependencyLibraries: dependencyLibs,
      warnings,
    }));
  } else {
    if (dryRun) {
      console.log(ddl);
    }
    diag(picocolors.cyan(`${entities.length} table(s): ${owned.length} owned, ${dependencies.length} pulled in for FK integrity` +
      (dependencyLibs.length ? ` (from: ${dependencyLibs.join(', ')})` : '')));
    if (warnings.length) {
      diag(picocolors.yellow('\nUnresolved foreign keys:'));
      warnings.forEach((w) => diag(picocolors.yellow(`  ⚠  ${w}`)));
    }
    if (written) {
      diag(picocolors.green(`\n✓ Wrote ${entities.length} table(s) to ${written}`));
    }
  }
}
