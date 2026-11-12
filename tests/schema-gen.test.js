import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSchema, toSnakeCase, topoSort } from '../src/lib/schema-gen.js';
import { transformContextEntities } from '../src/lib/context-entities.js';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mixed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/context-entities/mixed.json'), 'utf-8'));

// Restaurant -> RestaurantProfile (an extension: its Id *is* a Restaurant Identifier)
// -> MenuPhoto (an FK to the profile). The profile's key is an FK, so resolving
// MenuPhoto.ProfileId's type takes two hops.
function restaurantEntities() {
  return [
    { key: 'r', name: 'Restaurant', attrs: [
      { name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true },
      { name: 'Name', dataType: 'Text', isMandatory: true, isKey: false },
      { name: 'IsOpen', dataType: 'Boolean', isMandatory: true, isKey: false },
    ] },
    { key: 'rp', name: 'RestaurantProfile', attrs: [
      { name: 'Id', dataType: 'Restaurant Identifier', isMandatory: true, isKey: true, isForeignKey: true, references: 'r' },
      { name: 'OpenedOn', dataType: 'Date', isMandatory: false, isKey: false },
    ] },
    { key: 'mp', name: 'MenuPhoto', attrs: [
      { name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true },
      { name: 'ProfileId', dataType: 'RestaurantProfile Identifier', isMandatory: true, isKey: false, isForeignKey: true, references: 'rp' },
    ] },
  ];
}

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
  it('follows an FK through a PK that is itself an FK, down to the base type', () => {
    // RestaurantProfile.Id is a "Restaurant Identifier" (shared identity); MenuPhoto.ProfileId is a
    // "RestaurantProfile Identifier". One hop gives TEXT, which Postgres can't REFERENCE a BIGINT with.
    const ddl = generateSchema(restaurantEntities());
    const photoTable = ddl.slice(ddl.indexOf('CREATE TABLE "menu_photo"'));
    expect(photoTable).toMatch(/"profile_id"\s+BIGINT\s+NOT NULL\s+REFERENCES "restaurant_profile"/);
  });

  it('stops on an FK-of-PK cycle instead of recursing forever, falling back to the declared type', () => {
    const entities = [
      { key: 'a', name: 'A', attrs: [{ name: 'Id', dataType: 'B Identifier', isMandatory: true, isKey: true, isForeignKey: true, references: 'b' }] },
      { key: 'b', name: 'B', attrs: [{ name: 'Id', dataType: 'A Identifier', isMandatory: true, isKey: true, isForeignKey: true, references: 'a' }] },
    ];
    const ddl = generateSchema(entities);
    expect(ddl).toMatch(/CREATE TABLE "a" \(\n  "id" TEXT NOT NULL PRIMARY KEY/);
    expect(ddl).toMatch(/CREATE TABLE "b" \(\n  "id" TEXT NOT NULL PRIMARY KEY/);
  });

  it('gives a non-static entity\'s integer key an auto-number (BIGSERIAL / SERIAL)', () => {
    const entities = [
      { key: 'r', name: 'Reservation', attrs: [{ name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true }] },
      { key: 'v', name: 'Review', attrs: [{ name: 'Id', dataType: 'Integer', isMandatory: true, isKey: true }] },
    ];
    const ddl = generateSchema(entities);
    expect(ddl).toMatch(/CREATE TABLE "reservation" \(\n  "id" BIGSERIAL NOT NULL PRIMARY KEY/);
    expect(ddl).toMatch(/CREATE TABLE "review" \(\n  "id" SERIAL NOT NULL PRIMARY KEY/);
  });

  it('keeps a static entity\'s key, a text key and an FK key as plain columns (no auto-number)', () => {
    const entities = [
      { key: 's', name: 'Status', isStatic: true, attrs: [{ name: 'Id', dataType: 'Integer', isMandatory: true, isKey: true }] },
      { key: 'k', name: 'Cuisine', isStatic: true, attrs: [{ name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true }] },
      { key: 'c', name: 'Currency', attrs: [{ name: 'Code', dataType: 'Text', isMandatory: true, isKey: true }] },
      { key: 'p', name: 'Parent', attrs: [{ name: 'Id', dataType: 'Long Integer', isMandatory: true, isKey: true }] },
      { key: 'x', name: 'Extension', attrs: [
        { name: 'Id', dataType: 'Parent Identifier', isMandatory: true, isKey: true, isForeignKey: true, references: 'p' },
      ] },
    ];
    const ddl = generateSchema(entities);
    expect(ddl).toMatch(/CREATE TABLE "status" \(\n  "id" INTEGER NOT NULL PRIMARY KEY/);
    expect(ddl).toMatch(/CREATE TABLE "cuisine" \(\n  "id" BIGINT NOT NULL PRIMARY KEY/);
    expect(ddl).toMatch(/CREATE TABLE "currency" \(\n  "code" TEXT NOT NULL PRIMARY KEY/);
    expect(ddl).toMatch(/CREATE TABLE "extension" \(\n  "id" BIGINT NOT NULL PRIMARY KEY REFERENCES "parent"/);
  });

  it('maps Boolean to numeric and Date to timestamptz, matching live ODC storage', () => {
    const entities = [
      { key: 'd', name: 'Dish', isStatic: true, attrs: [
        { name: 'Id', dataType: 'Integer', isMandatory: true, isKey: true },
        { name: 'IsVegetarian', dataType: 'Boolean', isMandatory: true, isKey: false },
        { name: 'AvailableFrom', dataType: 'Date', isMandatory: false, isKey: false },
      ] },
    ];
    const ddl = generateSchema(entities);
    expect(ddl).toContain('"is_vegetarian" NUMERIC(28,8) NOT NULL');
    expect(ddl).toContain('"available_from" TIMESTAMPTZ');
  });

  it('emits DDL that PGlite accepts, with working FK chains, auto-numbers and 1/0 booleans', async () => {
    const db = new PGlite();
    try {
      await db.exec(generateSchema(restaurantEntities()));
      // No ids given: auto-number fills them.
      await db.exec(`
        INSERT INTO "restaurant" ("name", "is_open") VALUES ('Harbour Grill', 1), ('Corner Cafe', 0);
        INSERT INTO "restaurant_profile" ("id", "opened_on") VALUES (1, '2020-03-01');
        INSERT INTO "menu_photo" ("profile_id") VALUES (1);
      `);
      const open = await db.query('SELECT "name" FROM "restaurant" WHERE "is_open" = 1');
      expect(open.rows).toEqual([{ name: 'Harbour Grill' }]);
      // The multi-hop FK is enforced: profile 2 doesn't exist.
      await expect(db.exec('INSERT INTO "menu_photo" ("profile_id") VALUES (2)')).rejects.toThrow(/foreign key/i);
    } finally {
      await db.close();
    }
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
