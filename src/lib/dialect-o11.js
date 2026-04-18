/**
 * Pre-processes O11 T-SQL syntax into standard PostgreSQL before the
 * OutSystems Advanced SQL parser runs.
 *
 * Only high-confidence, regex-safe patterns are rewritten. Complex
 * functions (DATEDIFF, DATEADD, CONVERT, etc.) are flagged as warnings
 * rather than silently mangled.
 *
 * @param {string} sql  Raw SQL from an O11 SQL node
 * @returns {{ sql: string, warnings: string[] }}
 */
export function applyO11Dialect(sql) {
  const warnings = [];
  let out = sql;

  // 1. SELECT TOP N  →  SELECT  +  LIMIT N appended at end
  //    Handles both SELECT TOP 10 and SELECT TOP(10)
  const topValues = [];
  out = out.replace(/\bSELECT\s+TOP\s*\(?\s*(\d+)\s*\)?\s+/gi, (_, n) => {
    topValues.push(Number(n));
    return 'SELECT ';
  });
  if (topValues.length === 1) {
    // Append LIMIT before any trailing semicolon / whitespace
    out = out.replace(/\s*;?\s*$/, ` LIMIT ${topValues[0]}`);
  } else if (topValues.length > 1) {
    warnings.push(
      'Multiple SELECT TOP clauses detected (nested queries). Automatic LIMIT conversion was skipped — convert manually.'
    );
  }

  // 2. ISNULL(x, y)  →  COALESCE(x, y)
  out = out.replace(/\bISNULL\s*\(/gi, 'COALESCE(');

  // 3. NEWID()  →  gen_random_uuid()
  //    gen_random_uuid() is available in PostgreSQL 13+ (and PGlite) without any extension.
  out = out.replace(/\bNEWID\s*\(\s*\)/gi, 'gen_random_uuid()');

  // 4. GETDATE() / GETUTCDATE()  →  NOW()
  out = out.replace(/\bGET(?:UTC)?DATE\s*\(\s*\)/gi, 'NOW()');

  // 5. String concatenation adjacent to string literals only.
  //    'literal' + x  →  'literal' || x
  //    x + 'literal'  →  x || 'literal'
  //    Avoids rewriting arithmetic + by anchoring on string literal boundaries.
  out = out.replace(/'([^']*)'\s*\+\s*/g, "'$1' || ");
  out = out.replace(/\s*\+\s*'([^']*)'/g, " || '$1'");

  // 6. Warn on unsupported T-SQL functions — no safe automatic equivalent.
  const unsupported = [
    { pattern: /\bDATEDIFF\s*\(/i,  name: 'DATEDIFF'  },
    { pattern: /\bDATEADD\s*\(/i,   name: 'DATEADD'   },
    { pattern: /\bCONVERT\s*\(/i,   name: 'CONVERT'   },
    { pattern: /\bCHARINDEX\s*\(/i, name: 'CHARINDEX' },
    { pattern: /\bSTUFF\s*\(/i,     name: 'STUFF'     },
    { pattern: /\bFORMAT\s*\(/i,    name: 'FORMAT'    },
  ];
  for (const { pattern, name } of unsupported) {
    if (pattern.test(out)) {
      warnings.push(
        `'${name}' is a T-SQL function with no direct PostgreSQL equivalent — rewrite manually.`
      );
    }
  }

  return { sql: out, warnings };
}
