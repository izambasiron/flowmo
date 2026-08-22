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
 * children that reference them. Cycles are broken by skipping the back-edge
 * (the REFERENCES clause will simply be omitted for that column).
 *
 * @param {Array} entities
 * @returns {Array} entities in dependency-safe order
 */
export function topoSort(entities) {
  const keyMap = new Map(entities.map((e) => [e.key, e]));
  const visited = new Set();
  const inProgress = new Set();
  const sorted = [];

  function visit(entity) {
    const key = entity.key;
    if (visited.has(key)) return;
    if (inProgress.has(key)) return; // cycle — skip back-edge
    inProgress.add(key);
    for (const attr of entity.attrs) {
      if (attr.references) {
        const dep = keyMap.get(attr.references);
        if (dep) visit(dep);
      }
    }
    inProgress.delete(key);
    visited.add(key);
    sorted.push(entity);
  }

  for (const entity of entities) visit(entity);
  return sorted;
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
  const sorted = topoSort(entities);

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
      if (!attr.isKey && attr.references) {
        const refEntity = keyToEntity.get(attr.references);
        if (refEntity) {
          const pkAttr = refEntity.attrs.find((a) => a.isKey);
          if (pkAttr) type = pgType(pkAttr.dataType);
        }
        const target = keyToLocalName.get(attr.references);
        if (target) ref = ` REFERENCES ${target}`;
      }
      return `  ${col} ${type}${notNull}${pk}${ref}`;
    });

    statements.push(`CREATE TABLE ${tableName} (\n${colDefs.join(',\n')}\n);`);
  }

  return statements.join('\n\n');
}
