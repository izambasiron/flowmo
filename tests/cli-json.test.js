import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/flowmo.js');

// ---------------------------------------------------------------------------
// CLI integration — guards the --json stdout purity contract:
// stdout carries ONLY the JSON array (callers pipe / JSON.parse it);
// diagnostics (bindings, warnings, echoes) go to stderr.
// ---------------------------------------------------------------------------
describe('db:query --json stdout purity', () => {
  let proj;

  beforeAll(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmo-cli-'));
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ flowmo: { platform: 'ODC' } }));
    fs.mkdirSync(path.join(proj, 'database/sql'), { recursive: true });
    fs.writeFileSync(
      path.join(proj, 'database/schema.sql'),
      'CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL);\n'
    );
    fs.writeFileSync(
      path.join(proj, 'database/sql/get_user.advance.sql'),
      '-- Lookup a user by id.\nSELECT {User}.[Id], {User}.[Name] FROM {User} WHERE {User}.[Id] = @UserId\n'
    );
    execSync(`node "${CLI}" db:setup`, { cwd: proj, stdio: 'ignore' });
  }, 60000);

  afterAll(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('emits stdout that JSON.parse accepts directly', () => {
    const stdout = execSync(
      `node "${CLI}" db:query database/sql/get_user.advance.sql --param UserId=user-001 --json`,
      { cwd: proj, encoding: 'utf-8' }
    );
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(JSON.parse(stdout)).toEqual([]);
  }, 30000);

  it('sends the bindings line to stderr, not stdout', () => {
    let stderr = '';
    try {
      execSync(`node "${CLI}" db:query database/sql/get_user.advance.sql --param UserId=user-001 --json`, {
        cwd: proj,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      stderr = e.stderr || '';
    }
    // Re-run capturing stderr via shell redirection for reliability
    const out = execSync(
      `node "${CLI}" db:query database/sql/get_user.advance.sql --param UserId=user-001 --json 2>/tmp/flowmo-cli-stderr.txt`,
      { cwd: proj, encoding: 'utf-8' }
    );
    expect(out.trim().startsWith('[')).toBe(true);
    stderr = fs.readFileSync('/tmp/flowmo-cli-stderr.txt', 'utf-8');
    expect(stderr).toContain('Bindings:');
  }, 30000);
});
