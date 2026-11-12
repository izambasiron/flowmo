import fs from 'fs';
import path from 'path';

const ICON_LIBRARIES = ['font-awesome', 'phosphor'];

// Regular weight only for Phosphor — see architectural-heuristics.md §1: a
// real ODC module typically ships one installed icon weight, and `ph-fill`
// glyphs silently vanish if the module doesn't also have Fill installed.
export const ICON_CDN = {
  'font-awesome': '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">',
  phosphor: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/style.css">',
};

function toPascalCase(str) {
  const name = String(str || '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  // A PascalCase namespace becomes a `window.<Namespace>` global — a leading
  // digit (from a package name like "3pl-tracker") would make that an
  // invalid identifier.
  return /^\d/.test(name) ? `_${name}` : name;
}

/**
 * Reads the project's `flowmo` config block from package.json.
 * Both fields are optional and fall back to a derived default — there is no
 * required config file, matching screen:create's inferAppName precedent.
 */
export function readFlowmoConfig(projectPath) {
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
  } catch {
    // fall through to defaults
  }

  const cfg = pkg.flowmo || {};

  const namespace = cfg.namespace || toPascalCase(pkg.name) || 'App';

  const iconLibrary = ICON_LIBRARIES.includes(cfg.iconLibrary) ? cfg.iconLibrary : 'font-awesome';

  return { namespace, iconLibrary };
}

export { toPascalCase };
