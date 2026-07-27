import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';
import { Window } from 'happy-dom';
import { ALL_RULES } from '../lib/lint-rules.js';

/**
 * Discover all .visual.html files in screens/ (including one level of subdirs).
 */
function discoverScreens(screensDir) {
  const files = [];
  if (!fs.existsSync(screensDir)) return files;

  for (const entry of fs.readdirSync(screensDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.join(screensDir, entry.name));
    } else if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
      try {
        for (const sub of fs.readdirSync(path.join(screensDir, entry.name), { withFileTypes: true })) {
          if (sub.isFile() && sub.name.endsWith('.html')) {
            files.push(path.join(screensDir, entry.name, sub.name));
          }
        }
      } catch { /* skip unreadable */ }
    }
  }
  return files.sort();
}

/**
 * Parse an HTML file into a happy-dom Document.
 */
function parseHtml(filePath) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const window = new Window();
  window.document.write(html);
  return window.document;
}

export async function lint(rawArgs = []) {
  let strict = false;
  let fix = false;
  let json = false;
  let files = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--strict') strict = true;
    else if (a === '--fix') fix = true;
    else if (a === '--json') json = true;
    else files.push(a);
  }

  // Auto-discover if no files specified
  if (files.length === 0) {
    const screensDir = path.join(process.cwd(), 'screens');
    files = discoverScreens(screensDir);
    if (files.length === 0) {
      console.log(picocolors.dim('No .visual.html files found in screens/'));
      return;
    }
  }

  // Resolve relative paths
  files = files.map(f => path.resolve(process.cwd(), f));

  const allFindings = [];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      allFindings.push({ file, rule: 'not-found', level: 'error', message: `File not found: ${file}` });
      continue;
    }

    let doc;
    try {
      doc = parseHtml(file);
    } catch (err) {
      allFindings.push({ file, rule: 'parse-error', level: 'error', message: `Parse error: ${err.message}` });
      continue;
    }

    const fileFindings = [];
    for (const rule of ALL_RULES) {
      try {
        const results = rule.check(doc, file);
        fileFindings.push(...results);
      } catch (err) {
        fileFindings.push({ file, rule: rule.name, level: 'error', message: `Rule crashed: ${err.message}` });
      }
    }
    allFindings.push(...fileFindings);
  }

  // ── Output ──────────────────────────────────────────
  if (json) {
    console.log(JSON.stringify(allFindings, null, 2));
    return;
  }

  // Group by file
  const byFile = new Map();
  for (const f of allFindings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [file, findings] of byFile) {
    const rel = path.relative(process.cwd(), file);
    console.log(`\n${picocolors.underline(rel)}`);

    for (const f of findings) {
      const icon = f.level === 'error' ? picocolors.red('✗') : picocolors.yellow('!');
      const msg = picocolors.dim(`[${f.rule}]`);
      console.log(`  ${icon} ${f.message} ${msg}`);
      if (f.fix && fix) {
        console.log(`    ${picocolors.green('→')} ${picocolors.dim(f.fix)}`);
      }
      if (f.level === 'error') totalErrors++;
      else totalWarnings++;
    }
  }

  const checked = byFile.size;
  console.log(picocolors.dim(`\n${checked} file${checked !== 1 ? 's' : ''} checked · `) +
    picocolors.red(`${totalErrors} error${totalErrors !== 1 ? 's' : ''}`) +
    picocolors.dim(' · ') +
    picocolors.yellow(`${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}`));

  if (strict && totalErrors > 0) {
    process.exit(1);
  }
  if (strict && totalWarnings > 0) {
    process.exit(1);
  }
}
