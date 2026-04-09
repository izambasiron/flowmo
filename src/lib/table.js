import Table from 'cli-table3';
import picocolors from 'picocolors';

const TERMINAL_WIDTH = process.stdout.columns || 120;
const KEY_COL_WIDTH = 28;
const VAL_COL_WIDTH = TERMINAL_WIDTH - KEY_COL_WIDTH - 7; // 7 = borders + padding

// Outer frame + vertical divider only — no horizontal inner lines
const CHARS = {
  top: '─', 'top-mid': '─', 'top-left': '┌', 'top-right': '┐',
  bottom: '─', 'bottom-mid': '─', 'bottom-left': '└', 'bottom-right': '┘',
  left: '│', 'left-mid': '', mid: '', 'mid-mid': '',
  right: '│', 'right-mid': '',
  middle: '│',
};

function formatVal(val) {
  if (val === null || val === undefined) return picocolors.dim('NULL');
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) return val.slice(0, 10);
  return String(val);
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Renders query results as a vertical key/value block per row.
 *
 * @param {Array<{ name: string }>} fields
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ simple?: boolean, limit?: number }} opts
 */
export function renderTable(fields, rows, { simple = false, limit = 10 } = {}) {
  if (rows.length === 0) {
    console.log(picocolors.dim('(0 rows)'));
    return;
  }

  const total = rows.length;
  const displayed = rows.slice(0, limit);

  if (simple) {
    displayed.forEach((row, i) => {
      console.log(picocolors.dim(`-[ Row ${i + 1} ]` + '-'.repeat(30)));
      for (const f of fields) {
        console.log(`${picocolors.bold(f.name)}: ${formatVal(row[f.name])}`);
      }
    });
  } else {
    displayed.forEach((row, i) => {
      console.log(picocolors.dim(`-[ Row ${i + 1} ]` + '-'.repeat(30)));
      const table = new Table({
        chars: CHARS,
        style: { head: [], border: ['grey'] },
        colWidths: [KEY_COL_WIDTH, VAL_COL_WIDTH],
      });
      for (const f of fields) {
        table.push([picocolors.bold(f.name), truncate(formatVal(row[f.name]), VAL_COL_WIDTH - 2)]);
      }
      console.log(table.toString());
    });
  }

  const rowLabel = `(${displayed.length} row${displayed.length !== 1 ? 's' : ''})`;
  const limitNote = total > limit
    ? picocolors.yellow(` — showing ${limit} of ${total}, use --limit to change`)
    : '';
  console.log(picocolors.dim(rowLabel) + limitNote);
}
