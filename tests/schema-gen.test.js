import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSchema, toSnakeCase, topoSort } from '../src/lib/schema-gen.js';
import { transformContextEntities } from '../src/lib/context-entities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mixed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/context-entities/mixed.json'), 'utf-8'));

describe('generateSchema', () => {
  it('emits the referenced table before the referencing table (topo order)', () => {
    const { entities } = transformContextEntities(mixed);
    const ddl = generateSchema(entities);
    expect(ddl.indexOf('CREATE TABLE "region"')).toBeLessThan(ddl.indexOf('CREATE TABLE "branch"'));
  });

  it('adds a REFERENCES clause for a resolved FK', () => {
    const { entities } = transformContextEntities(mixed);
    const ddl = generateSchema(entities);
    expect(ddl).toMatch(/"region_id"\s+BIGINT\s+NOT NULL\s+REFERENCES "region"/);
  });

  it('does not emit a REFERENCES clause for an unresolved FK, and falls back to TEXT', () => {
    const { entities } = transformContextEntities(mixed);
    const ddl = generateSchema(entities);
    const loanTable = ddl.slice(ddl.indexOf('CREATE TABLE "loan"'));
    expect(loanTable).not.toContain('REFERENCES');
    expect(loanTable).toMatch(/"employee_id"\s+TEXT/);
  });

  it('quotes every table/column name, not just reserved-word special cases', () => {
    const entities = [
      { key: 'u1', name: 'User', attrs: [{ name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true }] },
      { key: 'o1', name: 'MessageStatus', attrs: [{ name: 'Order', dataType: 'Integer', isMandatory: true, isKey: false }] },
    ];
    const ddl = generateSchema(entities);
    expect(ddl).toContain('CREATE TABLE "user"');
    expect(ddl).toContain('"order" INTEGER');
  });

  it('infers the FK column type from the target entity\'s own PK type', () => {
    const entities = [
      { key: 'p1', name: 'Parent', attrs: [{ name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true }] },
      { key: 'c1', name: 'Child', attrs: [
        { name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true },
        { name: 'ParentId', dataType: 'Text', isMandatory: true, isKey: false, isForeignKey: true, references: 'p1' },
      ] },
    ];
    const ddl = generateSchema(entities);
    const childTable = ddl.slice(ddl.indexOf('CREATE TABLE "child"'));
    expect(childTable).toMatch(/"parent_id"\s+BIGINT/);
  });

  it('drops the back-edge REFERENCES on a mutual FK cycle so the DDL is executable', () => {
    // A -> B and B -> A: whichever table is emitted second cannot REFERENCE
    // the other in a plain sequence of CREATE TABLE statements.
    const entities = [
      { key: 'a', name: 'A', attrs: [
        { name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true },
        { name: 'BId', dataType: 'B Identifier', isMandatory: false, isKey: false, isForeignKey: true, references: 'b' },
      ] },
      { key: 'b', name: 'B', attrs: [
        { name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true },
        { name: 'AId', dataType: 'A Identifier', isMandatory: false, isKey: false, isForeignKey: true, references: 'a' },
      ] },
    ];
    const ddl = generateSchema(entities);
    // Exactly one direction keeps its REFERENCES clause.
    const referenceCount = (ddl.match(/REFERENCES/g) ?? []).length;
    expect(referenceCount).toBe(1);
  });

  it('inherits type and adds REFERENCES even when the FK column is also the primary key', () => {
    // Entity-extension / shared-identity pattern: Child.Id is both
    // PRIMARY KEY and a FK to Parent.Id — valid Postgres, and a real
    // OutSystems modeling pattern, not just a synthetic edge case.
    const entities = [
      { key: 'p1', name: 'Parent', attrs: [{ name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true }] },
      { key: 'c1', name: 'Child', attrs: [
        { name: 'Id', dataType: 'Text', isMandatory: true, isKey: true, isForeignKey: true, references: 'p1' },
      ] },
    ];
    const ddl = generateSchema(entities);
    const childTable = ddl.slice(ddl.indexOf('CREATE TABLE "child"'));
    expect(childTable).toMatch(/"id"\s+BIGINT\s+NOT NULL\s+PRIMARY KEY\s+REFERENCES "parent"/);
  });

  it('allows a self-referencing FK without treating it as a cycle', () => {
    const entities = [
      { key: 'e1', name: 'Employee', attrs: [
        { name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true },
        { name: 'ManagerId', dataType: 'Employee Identifier', isMandatory: false, isKey: false, isForeignKey: true, references: 'e1' },
      ] },
    ];
    const ddl = generateSchema(entities);
    expect(ddl).toContain('REFERENCES "employee"');
  });
});

describe('toSnakeCase', () => {
  it('converts PascalCase to snake_case', () => {
    expect(toSnakeCase('IsActive')).toBe('is_active');
    expect(toSnakeCase('HBAccountName')).toBe('hb_account_name');
  });
});

describe('topoSort', () => {
  it('breaks cycles by recording the back-edge rather than looping forever', () => {
    const entities = [
      { key: 'a', name: 'A', attrs: [{ name: 'BId', isForeignKey: true, references: 'b' }] },
      { key: 'b', name: 'B', attrs: [{ name: 'AId', isForeignKey: true, references: 'a' }] },
    ];
    const { sorted, skippedRefs } = topoSort(entities);
    expect(sorted).toHaveLength(2);
    expect(skippedRefs.size).toBe(1);
  });

  it('does not record a self-reference as a skipped back-edge', () => {
    const entities = [{ key: 'a', name: 'A', attrs: [{ name: 'ParentId', isForeignKey: true, references: 'a' }] }];
    const { skippedRefs } = topoSort(entities);
    expect(skippedRefs.size).toBe(0);
  });
});
