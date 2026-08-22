import { describe, it, expect } from 'vitest';
import { parseCreateTables } from '../src/lib/schema-local-parser.js';

describe('parseCreateTables', () => {
  it('parses multiple tables from one file', () => {
    const sql = `
      CREATE TABLE project (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE task (
        id BIGSERIAL PRIMARY KEY,
        project_id BIGINT REFERENCES project(id)
      );
    `;
    const tables = parseCreateTables(sql);
    expect(tables.map((t) => t.name)).toEqual(['project', 'task']);
  });

  it('handles nested-paren types like NUMERIC(28,8) without mis-splitting columns', () => {
    const sql = `
      CREATE TABLE invoice (
        id BIGSERIAL PRIMARY KEY,
        amount NUMERIC(28,8) NOT NULL
      );
    `;
    const [table] = parseCreateTables(sql);
    expect(table.columns).toHaveLength(2);
    expect(table.columns[1]).toEqual({ name: 'amount', type: 'NUMERIC(28,8) NOT NULL' });
  });

  it('skips CONSTRAINT/FOREIGN KEY lines rather than parsing them as columns', () => {
    const sql = `
      CREATE TABLE task (
        id BIGSERIAL PRIMARY KEY,
        project_id BIGINT,
        CONSTRAINT fk_project FOREIGN KEY (project_id) REFERENCES project(id)
      );
    `;
    const [table] = parseCreateTables(sql);
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'project_id']);
  });

  it('returns an empty array for a string with no CREATE TABLE', () => {
    expect(parseCreateTables('-- just a comment')).toEqual([]);
  });

  it('parses CREATE TABLE IF NOT EXISTS rather than silently skipping the table', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS project (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL
      );
    `;
    const tables = parseCreateTables(sql);
    expect(tables.map((t) => t.name)).toEqual(['project']);
  });

  it('folds an unquoted PascalCase identifier to lowercase, matching real Postgres storage', () => {
    const sql = `
      CREATE TABLE Goal (
        Id BIGSERIAL PRIMARY KEY,
        Name TEXT NOT NULL
      );
    `;
    const [table] = parseCreateTables(sql);
    expect(table.name).toBe('goal');
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'name']);
  });

  it('preserves the exact case of a quoted identifier, matching real Postgres storage', () => {
    const sql = `
      CREATE TABLE "Goal" (
        "Id" BIGSERIAL PRIMARY KEY
      );
    `;
    const [table] = parseCreateTables(sql);
    expect(table.name).toBe('Goal');
    expect(table.columns[0].name).toBe('Id');
  });
});
