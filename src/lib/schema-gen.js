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
  'Boolean':            'NUMERIC(28,8)', // ODC (Aurora PostgreSQL) stores Boolean as numeric 1/0
  'Date Time':          'TIMESTAMPTZ',
  'Date':               'TIMESTAMPTZ',   // ODC stores Date as timestamptz, not date
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
 * Type of an FK column = type of the referenced entity's primary key, followed
 * through as many hops as needed. A PK can itself be an FK (shared-identity
 * pattern: RestaurantProfile.Id is a "Restaurant Identifier"), so stopping after
 * one hop maps a "RestaurantProfile Identifier" column to TEXT while the real
 * key is BIGINT, and Postgres then rejects the REFERENCES clause ("cannot be
 * implemented"). Shared with schema-verify.js so the two can't drift apart.
 *
 * @param {{ dataType: string, references?: string }} attr
 * @param {Map<string, { attrs: Array }>} keyToEntity entity key -> entity
 * @returns {string} PostgreSQL type
 */
export function resolveRefType(attr, keyToEntity, seen = new Set()) {
  if (!attr.references || seen.has(attr.references)) return pgType(attr.dataType);
  seen.add(attr.references);
  const refEntity = keyToEntity.get(attr.references);
  const pkAttr = refEntity?.attrs.find((a) => a.isKey);
  if (!pkAttr) return pgType(attr.dataType);
  return pkAttr.references ? resolveRefType(pkAttr, keyToEntity, seen) : pgType(pkAttr.dataType);
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
 * A non-static entity's own integer key (not an FK) is emitted as SERIAL /
 * BIGSERIAL, matching OutSystems' default auto-number; a static entity's key
 * keeps its plain type, since its ids are fixed records.
 *
 * @param {Array<{
 *   key: string,
 *   name: string,
 *   isStatic?: boolean,
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
      // Auto-number: OutSystems gives a non-static entity's integer Id an auto-number by default. Without
      // this a seed/insert that omits the id fails on NOT NULL (the old Forge pull emitted BIGSERIAL).
      if (attr.isKey && !attr.references && !entity.isStatic) {
        if (type === 'BIGINT') type = 'BIGSERIAL';
        else if (type === 'INTEGER') type = 'SERIAL';
      }
      let ref = '';
      // A PK can also be an FK (an entity-extension / shared-identity
      // pattern: Child.Id both PRIMARY KEY and REFERENCES Parent.Id — valid
      // Postgres syntax) — don't gate this on !attr.isKey, or that column
      // silently loses both its inherited type and its REFERENCES clause.
      if (attr.references) {
        type = resolveRefType(attr, keyToEntity);
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
