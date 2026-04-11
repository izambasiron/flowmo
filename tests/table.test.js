import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderTable } from '../src/lib/table.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fields(...names) {
  return names.map((name) => ({ name }));
}

function rows(...records) {
  return records;
}

// Capture all console.log calls during a renderTable invocation.
function captureOutput(fn) {
  const lines = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    // picocolors may wrap text in ANSI codes; strip them for reliable assertions.
    lines.push(args.join(' ').replace(/\x1B\[[0-9;]*m/g, ''));
  });
  fn();
  spy.mockRestore();
  return lines;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('renderTable', () => {
  describe('empty result set', () => {
    it('prints "(0 rows)" when rows array is empty', () => {
      const lines = captureOutput(() => renderTable(fields('id', 'name'), rows()));
      expect(lines.join('\n')).toContain('(0 rows)');
    });
  });

  describe('single row', () => {
    it('prints a row separator containing "Row 1"', () => {
      const output = captureOutput(() =>
        renderTable(fields('id', 'name'), rows({ id: 1, name: 'Alice' }))
      );
      const combined = output.join('\n');
      expect(combined).toContain('Row 1');
    });

    it('prints "(1 row)" in the footer', () => {
      const output = captureOutput(() =>
        renderTable(fields('id'), rows({ id: 42 }))
      );
      expect(output.join('\n')).toContain('(1 row)');
    });
  });

  describe('multiple rows', () => {
    it('prints correct row count in the footer', () => {
      const data = rows({ id: 1 }, { id: 2 }, { id: 3 });
      const output = captureOutput(() => renderTable(fields('id'), data));
      expect(output.join('\n')).toContain('(3 rows)');
    });
  });

  describe('--limit truncation', () => {
    it('shows only <limit> rows and prints a "showing N of M" note', () => {
      const data = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
      const output = captureOutput(() =>
        renderTable(fields('id'), data, { limit: 5 })
      );
      const combined = output.join('\n');
      expect(combined).toContain('showing 5 of 20');
    });

    it('does NOT print a truncation note when rows <= limit', () => {
      const data = rows({ id: 1 }, { id: 2 });
      const output = captureOutput(() =>
        renderTable(fields('id'), data, { limit: 10 })
      );
      expect(output.join('\n')).not.toContain('showing');
    });
  });

  describe('NULL / undefined values', () => {
    it('renders NULL for null values without crashing', () => {
      const output = captureOutput(() =>
        renderTable(fields('id', 'ref'), rows({ id: 1, ref: null }))
      );
      expect(output.join('\n')).toContain('NULL');
    });

    it('renders NULL for undefined values without crashing', () => {
      const output = captureOutput(() =>
        renderTable(fields('id', 'ref'), rows({ id: 1, ref: undefined }))
      );
      expect(output.join('\n')).toContain('NULL');
    });
  });

  describe('date formatting', () => {
    it('trims an ISO datetime string to YYYY-MM-DD', () => {
      const output = captureOutput(() =>
        renderTable(
          fields('created_at'),
          rows({ created_at: '2024-03-15T12:34:56Z' })
        )
      );
      expect(output.join('\n')).toContain('2024-03-15');
      expect(output.join('\n')).not.toContain('T12:34:56');
    });

    it('trims a Date object to YYYY-MM-DD', () => {
      const output = captureOutput(() =>
        renderTable(fields('created_at'), rows({ created_at: new Date('2024-06-01T00:00:00Z') }))
      );
      expect(output.join('\n')).toContain('2024-06-01');
    });
  });

  describe('--simple mode', () => {
    it('prints "key: value" pairs without a table border', () => {
      const output = captureOutput(() =>
        renderTable(fields('id', 'name'), rows({ id: 7, name: 'Bob' }), { simple: true })
      );
      const combined = output.join('\n');
      expect(combined).toContain('id: 7');
      expect(combined).toContain('name: Bob');
    });
  });
});
