import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/flowmo.js');
const FIXTURE = path.resolve(__dirname, 'fixtures/context-entities/mixed.json');

describe('schema:pull', () => {
  let proj;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmo-schema-pull-'));
    fs.mkdirSync(path.join(proj, 'database'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'database/schema.local.sql'), '-- local additions, untouched by schema:pull\n');
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('writes database/schema.os.sql from a file argument and never touches schema.local.sql', () => {
    const before = fs.readFileSync(path.join(proj, 'database/schema.local.sql'), 'utf-8');
    execSync(`node "${CLI}" schema:pull "${FIXTURE}"`, { cwd: proj, stdio: 'pipe' });

    const osSql = fs.readFileSync(path.join(proj, 'database/schema.os.sql'), 'utf-8');
    expect(osSql).toContain('CREATE TABLE "region"');
    expect(osSql).toContain('CREATE TABLE "branch"');
    expect(osSql).toContain('CREATE TABLE "loan"');

    const after = fs.readFileSync(path.join(proj, 'database/schema.local.sql'), 'utf-8');
    expect(after).toBe(before);
  });

  it('reads from stdin when no file argument is given', () => {
    execSync(`cat "${FIXTURE}" | node "${CLI}" schema:pull`, { cwd: proj, shell: '/bin/bash', stdio: 'pipe' });
    const osSql = fs.readFileSync(path.join(proj, 'database/schema.os.sql'), 'utf-8');
    expect(osSql).toContain('CREATE TABLE "region"');
  });

  it('--dry-run prints DDL without writing schema.os.sql', () => {
    const stdout = execSync(`node "${CLI}" schema:pull "${FIXTURE}" --dry-run`, { cwd: proj, encoding: 'utf-8' });
    expect(stdout).toContain('CREATE TABLE "region"');
    expect(fs.existsSync(path.join(proj, 'database/schema.os.sql'))).toBe(false);
  });

  it('reports an unresolved FK as a warning, not a silent drop', () => {
    // Default (non --json) mode: diagnostics go to stdout, the human-readable stream.
    const out = execSync(`node "${CLI}" schema:pull "${FIXTURE}"`, { cwd: proj, encoding: 'utf-8' });
    expect(out).toContain('Loan.EmployeeId');
  });

  it('--json emits valid, parseable JSON including a warnings array', () => {
    const stdout = execSync(`node "${CLI}" schema:pull "${FIXTURE}" --json`, { cwd: proj, encoding: 'utf-8' });
    const parsed = JSON.parse(stdout);
    expect(parsed.tableCount).toBe(3);
    expect(parsed.ownedCount).toBe(2);
    expect(parsed.dependencyCount).toBe(1);
    expect(parsed.warnings.some((w) => w.includes('Loan.EmployeeId'))).toBe(true);
  });

  it('refuses to write when every entity is skipped, leaving a previous schema.os.sql untouched', () => {
    const emptyFixture = path.join(proj, 'empty.json');
    fs.writeFileSync(emptyFixture, JSON.stringify([{ key: 'e1', name: 'Empty', additionalData: {} }]));
    const osSql = path.join(proj, 'database/schema.os.sql');
    fs.writeFileSync(osSql, '-- previous good pull\n');

    let stderr = '';
    try {
      execSync(`node "${CLI}" schema:pull "${emptyFixture}"`, { cwd: proj, stdio: 'pipe' });
      expect.unreachable('should have exited non-zero');
    } catch (e) {
      stderr = e.stderr?.toString() ?? '';
    }
    expect(stderr).toContain('No usable entities');
    expect(stderr).toContain('Empty'); // the skip warning explains why
    expect(fs.readFileSync(osSql, 'utf-8')).toBe('-- previous good pull\n');
  });
});
