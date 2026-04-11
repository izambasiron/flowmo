import { describe, it, expect } from 'vitest';
import { parseAdvancedSql } from '../src/lib/parser.js';

// ---------------------------------------------------------------------------
// Helper — just the sql output, ignoring paramNames
// ---------------------------------------------------------------------------
function parse(sql) {
  return parseAdvancedSql(sql).sql;
}

// ---------------------------------------------------------------------------
// toSnakeCase (tested implicitly through parseAdvancedSql)
// ---------------------------------------------------------------------------
describe('toSnakeCase (via parseAdvancedSql)', () => {
  it('converts PascalCase to snake_case', () => {
    expect(parse('{WorkLog}')).toBe('work_log');
  });

  it('handles consecutive uppercase acronyms (e.g. SSRClient)', () => {
    expect(parse('{SSRClient}')).toBe('ssr_client');
  });

  it('handles already-lowercase words', () => {
    expect(parse('{user}')).toBe('"user"'); // reserved word path
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — {Entity}.[Attribute]  →  table.column
// ---------------------------------------------------------------------------
describe('Rule 1: {Entity}.[Attribute] → snake table.column', () => {
  it('converts a simple entity+attribute pair', () => {
    expect(parse('{WorkLog}.[TaskId]')).toBe('work_log.task_id');
  });

  it('quotes the "user" reserved word in table position', () => {
    expect(parse('{User}.[Id]')).toBe('"user".id');
  });

  it('handles multi-word entity and attribute', () => {
    expect(parse('{NonBillableRef}.[TaskRoleId]')).toBe('non_billable_ref.task_role_id');
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — bare {Entity}  →  entity_name
// ---------------------------------------------------------------------------
describe('Rule 2: bare {Entity} → snake table name', () => {
  it('converts a bare entity reference', () => {
    expect(parse('FROM {WorkLog}')).toBe('FROM work_log');
  });

  it('quotes "user" reserved word for bare entity too', () => {
    expect(parse('JOIN {User}')).toBe('JOIN "user"');
  });
});

// ---------------------------------------------------------------------------
// Rule 3a — WITH PascalName AS  →  WITH snake_name AS
// ---------------------------------------------------------------------------
describe('Rule 3a: CTE WITH clause name', () => {
  it('converts the CTE definition name to snake_case', () => {
    expect(parse('WITH TimesheetSkeleton AS (')).toBe('WITH timesheet_skeleton AS (');
  });
});

// ---------------------------------------------------------------------------
// Rule 3b — AS PascalAlias  →  AS snake_alias
// ---------------------------------------------------------------------------
describe('Rule 3b: AS PascalAlias → AS snake_alias', () => {
  it('lowercases a column alias', () => {
    expect(parse('NULL::bigint AS NonBillableRefTaskId')).toBe('NULL::bigint AS non_billable_ref_task_id');
  });

  it('lowercases a JOIN table alias', () => {
    expect(parse('LEFT JOIN ref_task AS NBRefTask')).toBe('LEFT JOIN ref_task AS nb_ref_task');
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — alias.[Attribute]  →  snake_alias.snake_attr
// ---------------------------------------------------------------------------
describe('Rule 4: alias.[Attribute] bracket notation', () => {
  it('converts alias and attribute to snake_case', () => {
    // After rules 3a/3b, the alias is already snake; rule 4 catches remaining
    // cases where the alias has NOT been converted yet.
    expect(parse('NBRefTask.[Id]')).toBe('nb_ref_task.id');
  });

  it('handles a longer alias', () => {
    expect(parse('TimesheetSkeleton.[TaskId]')).toBe('timesheet_skeleton.task_id');
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — standalone [Identifier]  →  identifier (lowercase)
// ---------------------------------------------------------------------------
describe('Rule 5: standalone [Identifier] brackets', () => {
  it('strips brackets and lowercases', () => {
    expect(parse('AS [Row_UniqueId]')).toBe('AS row_uniqueid');
  });

  it('lowercases an ORDER BY bracket reference', () => {
    expect(parse('ORDER BY [Col]')).toBe('ORDER BY col');
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — @Param  →  $N positional bindings
// ---------------------------------------------------------------------------
describe('Rule 6: @Param → $N positional bindings', () => {
  it('replaces a single @param and records its name', () => {
    const { sql, paramNames } = parseAdvancedSql('WHERE id = @UserId');
    expect(sql).toBe('WHERE id = $1');
    expect(paramNames).toEqual(['UserId']);
  });

  it('assigns $1, $2 to two distinct params in order of appearance', () => {
    const { sql, paramNames } = parseAdvancedSql('@UserId AND @RoleId');
    expect(sql).toBe('$1 AND $2');
    expect(paramNames).toEqual(['UserId', 'RoleId']);
  });

  it('maps repeated use of the same @param to the same $N', () => {
    const { sql, paramNames } = parseAdvancedSql('@UserId OR @UserId');
    expect(sql).toBe('$1 OR $1');
    expect(paramNames).toEqual(['UserId']);
  });

  it('returns an empty paramNames array when there are no @params', () => {
    const { paramNames } = parseAdvancedSql('SELECT 1');
    expect(paramNames).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — bare PascalCase identifiers  →  snake_case
// ---------------------------------------------------------------------------
describe('Rule 7: bare PascalCase identifiers', () => {
  it('converts a CTE reference in FROM clause', () => {
    expect(parse('FROM TimesheetSkeleton')).toBe('FROM timesheet_skeleton');
  });

  it('does NOT convert ALL-CAPS SQL keywords', () => {
    expect(parse('SELECT * FROM foo')).toBe('SELECT * FROM foo');
  });
});

// ---------------------------------------------------------------------------
// Integration — compound SQL snippets
// ---------------------------------------------------------------------------
describe('Integration: compound SQL snippets', () => {
  it('handles a simple entity + attribute + @param combo', () => {
    const { sql, paramNames } = parseAdvancedSql(
      'SELECT {WorkLog}.[Id] FROM {WorkLog} WHERE {WorkLog}.[UserId] = @UserId'
    );
    expect(sql).toBe('SELECT work_log.id FROM work_log WHERE work_log.user_id = $1');
    expect(paramNames).toEqual(['UserId']);
  });

  it('handles a JOIN with an alias and bracket column access', () => {
    const { sql } = parseAdvancedSql(
      'LEFT JOIN {RefTask} AS NBRefTask ON NBRefTask.[Id] = {WorkLog}.[TaskId]'
    );
    expect(sql).toBe('LEFT JOIN ref_task AS nb_ref_task ON nb_ref_task.id = work_log.task_id');
  });
});
