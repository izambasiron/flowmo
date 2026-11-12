/**
 * Adapts the OutSystems MCP `context_entities` response shape into the
 * entity/attribute model `schema-gen.js`'s `generateSchema()` expects.
 *
 * Real FK data lives at `attr.foreignKey.entityKey`, pointing at another
 * entity's `key` in the same response — this is authoritative platform
 * data, not a guess. Fetching with `--owned-only false` for a given `--app`
 * pulls in the full dependency closure (entities from other apps/libraries
 * an owned entity references), tagged `isReferenced: true` with
 * `producerAssetName` naming the real owner — so a `references` that
 * doesn't resolve against the given input means the caller didn't fetch
 * broadly enough, not that the data doesn't exist. That's reported as a
 * warning here, not guessed around.
 */

export function transformContextEntities(rawEntities) {
  if (!Array.isArray(rawEntities)) {
    throw new Error('Expected a JSON array of entity objects (the context_entities "data" array).');
  }

  const warnings = [];

  // An entity with zero attributes can't become a valid CREATE TABLE (no
  // columns) — skip it rather than aborting the whole pull over one bad
  // entity, consistent with how an unresolved FK is a warning, not a
  // fatal error. Filtered out before knownKeys so any FK pointing at one
  // of these correctly reports as unresolved, not silently "found".
  // (Single pass: build `usable` and the skip warnings together.)
  const usable = [];
  for (const raw of rawEntities) {
    if ((raw.additionalData?.attributes ?? []).length > 0) {
      usable.push(raw);
    } else {
      warnings.push(`${raw.name}: has no attributes — skipped (can't generate a table with zero columns)`);
    }
  }

  const knownKeys = new Set(usable.map((e) => e.key));

  const entities = usable.map((raw) => {
    const rawAttrs = raw.additionalData?.attributes ?? [];

    const attrs = rawAttrs.map((attr) => {
      const isForeignKey = Boolean(attr.foreignKey);
      let references;

      if (isForeignKey) {
        const targetKey = attr.foreignKey.entityKey;
        if (knownKeys.has(targetKey)) {
          references = targetKey;
        } else {
          warnings.push(
            `${raw.name}.${attr.name} → FK target entity (key=${targetKey}) not found in input; ` +
            `fetch its owning app too, or re-run context_entities with --owned-only false`
          );
        }
      }

      return {
        name: attr.name,
        dataType: attr.dataType,
        isMandatory: Boolean(attr.isMandatory),
        isKey: Boolean(attr.isPrimaryKey),
        isForeignKey,
        references,
      };
    });

    return {
      key: raw.key,
      name: raw.name,
      // Static entities have fixed ids; non-static ones get auto-number ids by default. context_entities
      // has no per-attribute isAutoNumber, so schema-gen uses this to decide SERIAL/BIGSERIAL.
      isStatic: Boolean(raw.isStatic),
      isReferenced: Boolean(raw.isReferenced),
      producerAssetName: raw.producerAssetName ?? null,
      attrs,
    };
  });

  return { entities, warnings };
}
