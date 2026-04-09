/**
 * Converts a PascalCase or camelCase identifier to snake_case.
 * Examples:
 *   RollingWeek       -> rolling_week
 *   WorkLog           -> work_log
 *   SSRClient         -> ssr_client
 *   NonBillableRefId  -> non_billable_ref_id
 *   TaskRoleId        -> task_role_id
 */
function toSnakeCase(str) {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
  // NOTE: trailing underscores are preserved intentionally.
  // e.g. NonBillableRefTaskId_ → non_billable_ref_task_id_
  // rolling_week uses trailing _ to disambiguate from identically-named columns on other tables.
}

/**
 * Parses an OutSystems Advanced SQL file into standard PostgreSQL.
 *
 * Transformations applied (in order):
 *   {Entity}.[Attribute]  ->  entity_name.attribute_name  (snake_case)
 *   {Entity}              ->  entity_name                 (snake_case)
 *   AS PascalAlias        ->  AS snake_alias              (CTE cols + table aliases)
 *   alias.[Attribute]     ->  snake_alias.attribute_name  (snake_case both sides)
 *   [Identifier]          ->  identifier                  (standalone bracket refs)
 *   @ParamName            ->  $1, $2, ...                 (first-appearance order)
 *
 * Returns { sql: string, paramNames: string[] } where paramNames[i] is the
 * original @-prefixed name that maps to positional binding $(i+1).
 */
export function parseAdvancedSql(sql) {
  // 1. Replace {Entity}.[Attribute] with snake_case table and column
  // 'user' is a PostgreSQL reserved word; quote it so it resolves to our view.
  let parsed = sql.replace(/\{(\w+)\}\.\[(\w+)\]/g, (_, entity, attr) => {
    const table = toSnakeCase(entity);
    return `${table === 'user' ? '"user"' : table}.${toSnakeCase(attr)}`;
  });

  // 2. Replace bare {Entity} (table reference without attribute)
  parsed = parsed.replace(/\{(\w+)\}/g, (_, entity) => {
    const name = toSnakeCase(entity);
    return name === 'user' ? '"user"' : name;
  });

  // 3a. Convert CTE definition names in WITH clause to snake_case.
  //     The name comes BEFORE "AS", so it must be handled separately.
  //     e.g. WITH TimesheetSkeleton AS ( -> WITH timesheet_skeleton AS (
  parsed = parsed.replace(/\bWITH\s+([A-Z][A-Za-z0-9]+)\s+AS\b/g, (_, name) => {
    return `WITH ${toSnakeCase(name)} AS`;
  });

  // 3b. Convert bare "AS PascalCase" aliases to snake_case.
  //    Applies to CTE column aliases and table aliases in JOINs.
  //    e.g. NULL::bigint AS NonBillableRefTaskId -> AS non_billable_ref_task_id
  //         LEFT JOIN ref_task AS NBRefTask      -> AS nb_ref_task
  //    Bracket aliases (AS [Col]) are left for step 5.
  parsed = parsed.replace(/\b(?:AS|as)\s+([A-Z][A-Za-z0-9]+)\b/g, (_, alias) => {
    return `AS ${toSnakeCase(alias)}`;
  });

  // 4. Replace alias.[Attribute] bracket notation still remaining.
  //    Lowercases the alias prefix too so it matches the snake_case alias
  //    defined in step 3.
  //    e.g. TimesheetSkeleton.[TaskId] -> timesheetskeleton.task_id
  //         NBRefTask.[Id]             -> nb_ref_task.id
  parsed = parsed.replace(/(\w+)\.\[(\w+)\]/g, (_, alias, attr) => {
    return `${toSnakeCase(alias)}.${toSnakeCase(attr)}`;
  });

  // 5. Replace remaining standalone [Identifier] brackets
  //    e.g. AS [Row_UniqueId] -> AS row_uniqueid
  //         ORDER BY [Col]    -> ORDER BY col
  parsed = parsed.replace(/\[(\w+)\]/g, (_, name) => {
    return name.toLowerCase();
  });

  // 6. Collect @params in order of first appearance and replace with $N.
  //    Must run BEFORE the bare PascalCase step so that @UserId is captured
  //    as "UserId" and not converted to "user_id" first.
  const paramNames = [];
  const paramIndex = {};

  parsed = parsed.replace(/@(\w+)/g, (_, name) => {
    if (!(name in paramIndex)) {
      paramNames.push(name);
      paramIndex[name] = paramNames.length;
    }
    return `$${paramIndex[name]}`;
  });

  // 7. Convert any remaining bare PascalCase identifiers to snake_case.
  //    Catches CTE name references like FROM TimesheetSkeleton that have no
  //    dot or brackets. SQL keywords are ALL CAPS and never match because
  //    the regex requires at least one lowercase letter in the word.
  //    @params are already replaced with $N so they are safe.
  //    e.g. FROM TimesheetSkeleton -> FROM timesheet_skeleton
  parsed = parsed.replace(/\b([A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*)\b/g, (_, name) => {
    return toSnakeCase(name);
  });

  return { sql: parsed, paramNames };
}
