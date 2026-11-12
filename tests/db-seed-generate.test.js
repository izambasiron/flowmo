import { describe, it, expect } from 'vitest';
import { generateValue } from '../src/commands/db-seed-generate.js';

// Columns as parseTable() returns them (types upper-cased, NOT NULL so no random NULLs).
const col = (name, type) => ({ name, type: `${type} NOT NULL`, isFk: false, isNullable: false });

function sample(column, n = 200) {
  return new Set(Array.from({ length: n }, (_, i) => generateValue(column, i)));
}

describe('db:seed:generate generateValue', () => {
  it('seeds a pulled ODC Boolean (NUMERIC(28,8), Is/Has/Can name) with 1/0', () => {
    for (const name of ['is_vegetarian', 'has_parking', 'can_deliver']) {
      const values = sample(col(name, 'NUMERIC(28,8)'));
      expect([...values].every((v) => v === '1' || v === '0')).toBe(true);
    }
  });

  it('still seeds a legacy BOOLEAN column with true/false', () => {
    const values = sample(col('is_open', 'BOOLEAN'));
    expect([...values].every((v) => v === 'true' || v === 'false')).toBe(true);
  });

  it('keeps seeding an ordinary numeric column with numbers, not just 1/0', () => {
    const values = sample(col('table_count', 'NUMERIC(28,8)'));
    expect([...values].some((v) => Number(v) > 1)).toBe(true);
  });
});
