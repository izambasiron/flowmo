/**
 * Generates PostgreSQL CREATE TABLE DDL from an entity/attribute model.
 *
 * Adapted from flowmo-forge's schema-generator.js (the Forge-component path,
 * which has no real FK data and must guess `<Entity>Id`-shaped columns).
 * The MCP path (context-entities.js) always has real `foreignKey` data when
 * called correctly, so this version has no guessing fallback — an
 * unresolved `references` is reported by the caller as a warning instead.
 */

/** Maps OutSystems SS_Data_Type names to PostgreSQL DDL types. */
export const TYPE_MAP = {
  'Text':               'TEXT',
  'Integer':            'INTEGER',
  'Long Integer':       'BIGINT',
  'Decimal':            'NUMERIC(28,8)',
  'Boolean':            'BOOLEAN',
  'Date Time':          'TIMESTAMPTZ',
  'Date':               'DATE',
  'Time':               'TIME',
  'Binary Data':        'BYTEA',
  'Currency':           'NUMERIC(28,8)',
  'Email':              'TEXT',
  'Phone Number':       'TEXT',
  'URL':                'TEXT',
  'Entity Identifier':  'TEXT',
};

export function toSnakeCase(str) {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function pgType(dataType) {
  return TYPE_MAP[dataType] ?? 'TEXT';
}

/**
 * Topologically sorts entities so parent tables are emitted before the
 * children that reference them. A multi-entity FK cycle (A -> B -> A) has
 * no valid emission order — one direction's REFERENCES clause is dropped
 * (the back-edge), or PGlite would reject the DDL with "relation ... does
 * not exist" for whichever table gets created second. A self-reference
 * (an entity's own FK to itself) is always fine and never treated as a
 * cycle: PostgreSQL allows a REFERENCES clause pointing at the very table
 * being created within that same CREATE TABLE statement.
 *
 * @param {Array} entities
 * @returns {{ sorted: Array, skippedRefs: Set<string> }} `skippedRefs`
 *   holds `${entityKey}::${attrName}` for each FK attribute whose
 *   REFERENCES clause must be omitted to break a cycle.
 */
export function topoSort(entities) {
  const keyMap = new Map(entities.map((e) => [e.key, e]));
  const visited = new Set();
  const inProgress = new Set();
  const sorted = [];
  const skippedRefs = new Set();

  function visit(entity) {
    const key = entity.key;
    if (visited.has(key)) return;
    inProgress.add(key);
    for (const attr of entity.attrs) {
      if (!attr.references || attr.references === key) continue; // self-reference: always fine
      if (inProgress.has(attr.references)) {
        // Back-edge: the target is still on the current DFS path (a cycle).
        skippedRefs.add(`${key}::${attr.name}`);
        continue;
      }
      const dep = keyMap.get(attr.references);
      if (dep) visit(dep);
    }
    inProgress.delete(key);
    visited.add(key);
    sorted.push(entity);
  }

  for (const entity of entities) visit(entity);
  return { sorted, skippedRefs };
}

/**
 * Generates PostgreSQL CREATE TABLE DDL from a list of entities.
 * Tables are emitted in topological order (parents before children).
 * REFERENCES clauses are added for FK attributes whose target is present.
 *
 * @param {Array<{
 *   key: string,
 *   name: string,
 *   attrs: Array<{ name: string, dataType: string, isMandatory: boolean, isKey: boolean,
 *                  isForeignKey?: boolean, references?: string }>
 * }>} entities
 * @returns {string} DDL suitable for PGlite exec
 */
export function generateSchema(entities) {
  const { sorted, skippedRefs } = topoSort(entities);

  // Table/column names are always double-quoted rather than special-cased
  // per reserved word (e.g. "user", "order", "trigger") — quoting is always
  // legal in Postgres and real OutSystems entities/attributes routinely
  // collide with SQL keywords (an entity named Order, an attribute named
  // Trigger), so guessing at a reserved-word list would just miss some.
  const keyToLocalName = new Map();
  const keyToEntity = new Map();
  for (const entity of sorted) {
    keyToLocalName.set(entity.key, `"${toSnakeCase(entity.name)}"`);
    keyToEntity.set(entity.key, entity);
  }

  const statements = [];

  for (const entity of sorted) {
    const tableName = `"${toSnakeCase(entity.name)}"`;

    const colDefs = entity.attrs.map((attr) => {
      const col = `"${toSnakeCase(attr.name)}"`;
      let type = pgType(attr.dataType);
      const notNull = attr.isMandatory || attr.isKey ? ' NOT NULL' : '';
      const pk = attr.isKey ? ' PRIMARY KEY' : '';
      let ref = '';
      // A PK can also be an FK (an entity-extension / shared-identity
      // pattern: Child.Id both PRIMARY KEY and REFERENCES Parent.Id — valid
      // Postgres syntax) — don't gate this on !attr.isKey, or that column
      // silently loses both its inherited type and its REFERENCES clause.
      if (attr.references) {
        const refEntity = keyToEntity.get(attr.references);
        if (refEntity) {
          const pkAttr = refEntity.attrs.find((a) => a.isKey);
          if (pkAttr) type = pgType(pkAttr.dataType);
        }
        const isBackEdge = skippedRefs.has(`${entity.key}::${attr.name}`);
        const target = keyToLocalName.get(attr.references);
        if (target && !isBackEdge) ref = ` REFERENCES ${target}`;
      }
      return `  ${col} ${type}${notNull}${pk}${ref}`;
    });

    statements.push(`CREATE TABLE ${tableName} (\n${colDefs.join(',\n')}\n);`);
  }

  return statements.join('\n\n');
}
