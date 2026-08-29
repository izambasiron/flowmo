import fs from 'fs';
import path from 'path';

const ICON_LIBRARIES = ['font-awesome', 'phosphor'];

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
