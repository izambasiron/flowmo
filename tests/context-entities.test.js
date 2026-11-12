import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { transformContextEntities } from '../src/lib/context-entities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mixed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/context-entities/mixed.json'), 'utf-8'));

describe('transformContextEntities', () => {
  it('maps isPrimaryKey to isKey', () => {
    const { entities } = transformContextEntities(mixed);
    const region = entities.find((e) => e.name === 'Region');
    expect(region.attrs.find((a) => a.name === 'Id').isKey).toBe(true);
    expect(region.attrs.find((a) => a.name === 'Name').isKey).toBe(false);
  });

  it('resolves a foreign key present in the input', () => {
    const { entities, warnings } = transformContextEntities(mixed);
    const branch = entities.find((e) => e.name === 'Branch');
    const regionIdAttr = branch.attrs.find((a) => a.name === 'RegionId');
    expect(regionIdAttr.isForeignKey).toBe(true);
    expect(regionIdAttr.references).toBe('11111111-0000-0000-0000-000000000001');
    expect(warnings.some((w) => w.includes('RegionId'))).toBe(false);
  });

  it('leaves references undefined and warns when the FK target is missing', () => {
    const { entities, warnings } = transformContextEntities(mixed);
    const loan = entities.find((e) => e.name === 'Loan');
    const employeeIdAttr = loan.attrs.find((a) => a.name === 'EmployeeId');
    expect(employeeIdAttr.isForeignKey).toBe(true);
    expect(employeeIdAttr.references).toBeUndefined();
    expect(warnings.some((w) => w.includes('Loan.EmployeeId'))).toBe(true);
  });

  it('surfaces isReferenced and producerAssetName for the dependency breakdown', () => {
    const { entities } = transformContextEntities(mixed);
    const region = entities.find((e) => e.name === 'Region');
    const branch = entities.find((e) => e.name === 'Branch');
    expect(region.isReferenced).toBe(true);
    expect(region.producerAssetName).toBe('SomeSharedLibrary');
    expect(branch.isReferenced).toBe(false);
  });

  it('handles a static entity with no additionalData.records without crashing', () => {
    const staticEntity = [{
      key: 'static-1',
      name: 'Color',
      isStatic: true,
      additionalData: { attributes: [{ key: 'a1', name: 'Id', dataType: 'Integer', isMandatory: true, isPrimaryKey: true }] },
    }];
    const { entities } = transformContextEntities(staticEntity);
    expect(entities).toHaveLength(1);
    expect(entities[0].attrs).toHaveLength(1);
    expect(entities[0].isStatic).toBe(true);
  });

  it('skips an entity with zero attributes and warns, rather than emitting an empty table', () => {
    const empty = [{ key: 'empty-1', name: 'Empty', additionalData: {} }];
    const { entities, warnings } = transformContextEntities(empty);
    expect(entities).toEqual([]);
    expect(warnings.some((w) => w.includes('Empty'))).toBe(true);
  });

  it('reports a FK pointing at a zero-attribute entity as unresolved, not silently found', () => {
    const input = [
      { key: 'empty-1', name: 'Empty', additionalData: {} },
      {
        key: 'child-1',
        name: 'Child',
        additionalData: { attributes: [
          { name: 'Id', dataType: 'Long Integer', isMandatory: true, isPrimaryKey: true },
          { name: 'EmptyId', dataType: 'Empty Identifier', isMandatory: false, isPrimaryKey: false, foreignKey: { entityKey: 'empty-1' } },
        ] },
      },
    ];
    const { entities, warnings } = transformContextEntities(input);
    const child = entities.find((e) => e.name === 'Child');
    expect(child.attrs.find((a) => a.name === 'EmptyId').references).toBeUndefined();
    expect(warnings.some((w) => w.includes('Child.EmptyId'))).toBe(true);
  });

  it('throws a clear error when given a non-array', () => {
    expect(() => transformContextEntities({ not: 'an array' })).toThrow(/JSON array/);
  });
});
