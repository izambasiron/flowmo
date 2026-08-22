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

  it('reports confirmed when the fresh pull matches schema.local.sql exactly', () => {
    const file = writeFresh([GOAL_ENTITY]);
    const stdout = execSync(`node "${CLI}" "schema:verify" "${file}" --json`, { cwd: proj, encoding: 'utf-8' });
    const { report } = JSON.parse(stdout);
    expect(report).toEqual([{ table: 'goal', status: 'confirmed', details: [] }]);
  });

  it('reports missing when the entity is absent from the fresh pull', () => {
    const file = writeFresh([]);
    const stdout = execSync(`node "${CLI}" "schema:verify" "${file}" --json`, { cwd: proj, encoding: 'utf-8' });
    const { report } = JSON.parse(stdout);
    expect(report[0].status).toBe('missing');
  });

  it('reports attribute mismatch when a column type or name diverges', () => {
    const mismatched = {
      ...GOAL_ENTITY,
      additionalData: { attributes: [
        { name: 'Id', dataType: 'Long Integer', isMandatory: true, isPrimaryKey: true },
        { name: 'Name', dataType: 'Integer', isMandatory: true, isPrimaryKey: false },
      ] },
    };
    const file = writeFresh([mismatched]);
    const stdout = execSync(`node "${CLI}" "schema:verify" "${file}" --json`, { cwd: proj, encoding: 'utf-8' });
    const { report } = JSON.parse(stdout);
    expect(report[0].status).toBe('attribute mismatch');
    expect(report[0].details.some((d) => d.includes('name'))).toBe(true);
  });

  it('errors clearly when there is no schema.local.sql to verify against', () => {
    fs.rmSync(path.join(proj, 'database/schema.local.sql'));
    const file = writeFresh([GOAL_ENTITY]);
    expect(() => execSync(`node "${CLI}" "schema:verify" "${file}"`, { cwd: proj, stdio: 'pipe' })).toThrow();
  });
});
