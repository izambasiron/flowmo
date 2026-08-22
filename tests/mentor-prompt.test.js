import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/flowmo.js');

describe('mentor:prompt', () => {
  let proj;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmo-mentor-prompt-'));
    fs.mkdirSync(path.join(proj, 'database/sql'), { recursive: true });
    fs.writeFileSync(
      path.join(proj, 'database/schema.local.sql'),
      'CREATE TABLE goal (\n  id BIGSERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);\n'
    );
    fs.writeFileSync(
      path.join(proj, 'database/sql/get_goals.advance.sql'),
      '-- GetGoals\nSELECT {Goal}.[Id], {Goal}.[Name] FROM {Goal}\n'
    );
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('includes the raw schema.local.sql content and instruction framing', () => {
    const stdout = execSync(`node "${CLI}" mentor:prompt`, { cwd: proj, encoding: 'utf-8' });
    expect(stdout).toContain('Create OutSystems entities matching this exact schema');
    expect(stdout).toContain('CREATE TABLE goal');
  });

  it('includes a section per named .advance.sql file', () => {
    const stdout = execSync(`node "${CLI}" mentor:prompt database/sql/get_goals.advance.sql`, { cwd: proj, encoding: 'utf-8' });
    expect(stdout).toContain('### database/sql/get_goals.advance.sql');
    expect(stdout).toContain('SELECT {Goal}.[Id]');
  });

  it('--output writes to a file instead of stdout', () => {
    const stdout = execSync(`node "${CLI}" mentor:prompt --output mentor-prompt.md`, { cwd: proj, encoding: 'utf-8' });
    expect(stdout).toContain('Mentor prompt written to mentor-prompt.md');
    const written = fs.readFileSync(path.join(proj, 'mentor-prompt.md'), 'utf-8');
    expect(written).toContain('CREATE TABLE goal');
  });

  it('errors clearly when there is nothing to prompt from', () => {
    fs.rmSync(path.join(proj, 'database/schema.local.sql'));
    fs.rmSync(path.join(proj, 'database/sql/get_goals.advance.sql'));
    expect(() => execSync(`node "${CLI}" mentor:prompt`, { cwd: proj, stdio: 'pipe' })).toThrow();
  });

  it('errors clearly when --output is given with no filename, instead of silently printing to stdout', () => {
    let stderr = '';
    try {
      execSync(`node "${CLI}" mentor:prompt --output`, { cwd: proj, stdio: 'pipe' });
      expect.unreachable('should have exited non-zero');
    } catch (e) {
      stderr = e.stderr?.toString() ?? '';
    }
    expect(stderr).toContain('--output requires a file path');
  });
});
