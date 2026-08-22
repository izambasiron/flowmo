import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/flowmo.js');

const GOAL_ENTITY = {
  key: 'g1',
  name: 'Goal',
  additionalData: {
    attributes: [
      { name: 'Id', dataType: 'Long Integer', isMandatory: true, isPrimaryKey: true },
      { name: 'Name', dataType: 'Text', isMandatory: true, isPrimaryKey: false },
    ],
  },
};

describe('schema:verify', () => {
  let proj;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmo-schema-verify-'));
    fs.mkdirSync(path.join(proj, 'database'), { recursive: true });
    fs.writeFileSync(
      path.join(proj, 'database/schema.local.sql'),
      'CREATE TABLE goal (\n  id BIGSERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);\n'
    );
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  function writeFresh(entities) {
    const file = path.join(proj, 'fresh.json');
    fs.writeFileSync(file, JSON.stringify(entities));
    return file;
  }

  // execSync throws when the child exits non-zero — schema:verify does
  // that deliberately whenever a table isn't confirmed, so tests that
  // expect that status need to recover stdout from the caught error.
  function runVerify(file, extraArgs = '') {
    try {
      const stdout = execSync(`node "${CLI}" schema:verify "${file}" --json ${extraArgs}`, { cwd: proj, encoding: 'utf-8' });
      return { stdout, status: 0 };
    } catch (e) {
      return { stdout: e.stdout, status: e.status };
    }
  }

  it('reports confirmed and exits 0 when the fresh pull matches schema.local.sql exactly', () => {
    const file = writeFresh([GOAL_ENTITY]);
    const { stdout, status } = runVerify(file);
    const { report } = JSON.parse(stdout);
    expect(report).toEqual([{ table: 'goal', status: 'confirmed', details: [] }]);
    expect(status).toBe(0);
  });

  it('reports missing and exits non-zero when the entity is absent from the fresh pull', () => {
    const file = writeFresh([]);
    const { stdout, status } = runVerify(file);
    const { report } = JSON.parse(stdout);
    expect(report[0].status).toBe('missing');
    expect(status).not.toBe(0);
  });

  it('reports attribute mismatch and exits non-zero when a column type or name diverges', () => {
    const mismatched = {
      ...GOAL_ENTITY,
      additionalData: { attributes: [
        { name: 'Id', dataType: 'Long Integer', isMandatory: true, isPrimaryKey: true },
        { name: 'Name', dataType: 'Integer', isMandatory: true, isPrimaryKey: false },
      ] },
    };
    const file = writeFresh([mismatched]);
    const { stdout, status } = runVerify(file);
    const { report } = JSON.parse(stdout);
    expect(report[0].status).toBe('attribute mismatch');
    expect(report[0].details.some((d) => d.includes('name'))).toBe(true);
    expect(status).not.toBe(0);
  });

  it('errors clearly when there is no schema.local.sql to verify against', () => {
    fs.rmSync(path.join(proj, 'database/schema.local.sql'));
    const file = writeFresh([GOAL_ENTITY]);
    expect(() => execSync(`node "${CLI}" schema:verify "${file}"`, { cwd: proj, stdio: 'pipe' })).toThrow();
  });
});
