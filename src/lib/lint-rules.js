/**
 * Lint rules for flowmo .visual.html files.
 * Each rule receives a Document (happy-dom) and returns findings.
 *
 * Finding shape: { file, rule, level: 'error'|'warning', message, fix? }
 */

// ── Rule 1: .active-screen wrapper + .layout child ──────────
export function checkActiveScreen(doc, file) {
  const findings = [];
  const screen = doc.querySelector('.active-screen');
  if (!screen) {
    findings.push({ file, rule: 'missing-active-screen', level: 'error',
      message: 'Root element missing .active-screen wrapper' });
    return findings;
  }
  // Allow screens that use layout components (.layout rendered by JS at runtime)
  const layout = screen.querySelector('.layout');
  const hasAppRoot = screen.querySelector('#app-root');
  const hasLayoutImport = [...doc.querySelectorAll('script')].some(s =>
    (s.textContent || '').includes('components/layouts/'));
  if (!layout && !hasAppRoot && !hasLayoutImport) {
    findings.push({ file, rule: 'missing-layout', level: 'error',
      message: '.active-screen must contain a .layout child, #app-root mount point, or import a layout component' });
  }
  return findings;
}

// ── Rule 2: Three CSS files linked in correct order ─────────
export function checkCssLinks(doc, file) {
  const findings = [];
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
  const hrefs = links.map(l => l.getAttribute('href') || '');

  const required = ['outsystems-ui.css', 'grid.css', 'theme.css'];
  const found = required.filter(r => hrefs.some(h => h.includes(r)));

  if (found.length < 3) {
    const missing = required.filter(r => !hrefs.some(h => h.includes(r)));
    findings.push({ file, rule: 'missing-css', level: 'error',
      message: `Missing CSS: ${missing.join(', ')}` });
  }

  // Check order: os-ui must come before grid, grid before theme
  const osIdx = hrefs.findIndex(h => h.includes('outsystems-ui.css'));
  const gridIdx = hrefs.findIndex(h => h.includes('grid.css'));
  const themeIdx = hrefs.findIndex(h => h.includes('theme.css'));
  if (osIdx >= 0 && gridIdx >= 0 && osIdx > gridIdx) {
    findings.push({ file, rule: 'css-order', level: 'error',
      message: 'outsystems-ui.css must come before grid.css',
      fix: 'Reorder <link> tags: os-ui → grid → theme' });
  }
  if (gridIdx >= 0 && themeIdx >= 0 && gridIdx > themeIdx) {
    findings.push({ file, rule: 'css-order', level: 'error',
      message: 'grid.css must come before theme.css' });
  }

  return findings;
}

// ── Rule 3: device-detect.js at end of body ─────────────────
export function checkDeviceDetect(doc, file) {
  const scripts = [...doc.querySelectorAll('script[src]')];
  const deviceScript = scripts.find(s => (s.getAttribute('src') || '').includes('device-detect.js'));

  if (!deviceScript) {
    return [{ file, rule: 'missing-device-detect', level: 'error',
      message: 'Missing <script src="…device-detect.js"> before </body>',
      fix: 'Add <script src="../scripts/device-detect.js"></script> at end of <body>' }];
  }

  // Check it's the last script in body
  const body = doc.querySelector('body');
  if (body) {
    const bodyScripts = [...body.querySelectorAll('script')];
    const lastSrc = bodyScripts.filter(s => s.getAttribute('src')).pop();
    if (lastSrc && !(lastSrc.getAttribute('src') || '').includes('device-detect.js')) {
      return [{ file, rule: 'device-detect-order', level: 'warning',
        message: 'device-detect.js should be the last script before </body>' }];
    }
  }

  return [];
}

// ── Rule 4: No @media queries ──────────────────────────────
export function checkMediaQueries(doc, file) {
  const findings = [];
  const styles = [...doc.querySelectorAll('style')];
  for (const s of styles) {
    if (s.textContent && /@media\b/.test(s.textContent)) {
      findings.push({ file, rule: 'no-media-queries', level: 'error',
        message: '@media queries are not allowed — use OSUI break classes instead (phone-break-*, tablet-break-*)' });
    }
  }
  return findings;
}

// ── Rule 5: Columns: .columns AND number class ──────────────
const COLUMN_CLASSES = ['columns2', 'columns3', 'columns4', 'columns5', 'columns6',
  'columns-small-left', 'columns-small-right', 'columns-medium-left', 'columns-medium-right'];

export function checkColumns(doc, file) {
  const findings = [];
  for (const colClass of COLUMN_CLASSES) {
    const els = [...doc.querySelectorAll(`.${colClass}`)];
    for (const el of els) {
      if (!el.classList.contains('columns')) {
        findings.push({ file, rule: 'missing-columns-base', level: 'error',
          message: `.${colClass} requires .columns base class — use class="columns ${colClass}"`,
          fix: `Add 'columns' to class attribute: class="columns ${colClass}"` });
      }
    }
  }
  return findings;
}

// ── Rule 6: Columns children are .columns-item not .column ──
export function checkColumnItems(doc, file) {
  const findings = [];
  // Find all column parents (elements with both .columns and a number class)
  const parents = [...doc.querySelectorAll('.columns')].filter(el =>
    COLUMN_CLASSES.some(c => el.classList.contains(c)));

  for (const parent of parents) {
    const children = [...parent.children];
    for (const child of children) {
      if (child.classList.contains('column') && !child.classList.contains('columns-item')) {
        findings.push({ file, rule: 'bad-column-class', level: 'error',
          message: 'Found .column — use .columns-item instead',
          fix: 'Rename class="column" to class="columns-item"' });
      }
    }
  }
  return findings;
}

// ── Rule 7: phone-break-* on multi-column layouts ──────────
export function checkBreakClasses(doc, file) {
  const findings = [];
  const parents = [...doc.querySelectorAll('.columns')].filter(el =>
    COLUMN_CLASSES.some(c => el.classList.contains(c)));

  for (const parent of parents) {
    const hasBreak = [...parent.classList].some(c =>
      c.startsWith('phone-break-') || c.startsWith('tablet-break-'));
    if (!hasBreak) {
      const colClass = COLUMN_CLASSES.find(c => parent.classList.contains(c));
      findings.push({ file, rule: 'missing-break', level: 'warning',
        message: `.${colClass} has no phone-break-* class — columns may not stack on mobile`,
        fix: `Add phone-break-all to the parent: class="columns ${colClass} phone-break-all"` });
    }
  }
  return findings;
}

// ── Rule 8: Font Awesome CDN if icons are used ──────────────
export function checkFontAwesome(doc, file) {
  const iconEls = [...doc.querySelectorAll('i[class*="fa"]')];
  if (iconEls.length === 0) return [];

  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
  const hasFA = links.some(l => (l.getAttribute('href') || '').includes('font-awesome'));

  if (!hasFA) {
    return [{ file, rule: 'missing-font-awesome', level: 'error',
      message: 'Font Awesome icons used but CDN not linked',
      fix: 'Add <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css"> in <head>' }];
  }
  return [];
}

// ── Rule 9: .btn + .background-* specificity trap ──────────
export function checkBtnSpecificity(doc, file) {
  const findings = [];
  const btns = [...doc.querySelectorAll('.btn')];
  const bgClasses = ['background-neutral-0', 'background-neutral-1', 'background-neutral-9',
    'background-neutral-10', 'background-primary', 'background-secondary'];
  const textClasses = ['text-neutral-0', 'text-neutral-10', 'text-primary'];

  for (const btn of btns) {
    const hasBg = bgClasses.some(c => btn.classList.contains(c));
    const hasText = textClasses.some(c => btn.classList.contains(c));
    if (hasBg || hasText) {
      findings.push({ file, rule: 'btn-specificity', level: 'warning',
        message: '.btn with .background-* or .text-* may produce invisible text — create a custom button class instead' });
      break; // one warning per file is enough
    }
  }
  return findings;
}

// ── Rule 10: Gutter class on columns ───────────────────────
const GUTTER_CLASSES = ['gutter-none', 'gutter-xs', 'gutter-s', 'gutter-base',
  'gutter-m', 'gutter-l', 'gutter-xl', 'gutter-xxl'];

export function checkGutter(doc, file) {
  const findings = [];
  const parents = [...doc.querySelectorAll('.columns')].filter(el =>
    COLUMN_CLASSES.some(c => el.classList.contains(c)));

  for (const parent of parents) {
    const hasGutter = GUTTER_CLASSES.some(g => parent.classList.contains(g));
    if (!hasGutter) {
      const colClass = COLUMN_CLASSES.find(c => parent.classList.contains(c));
      findings.push({ file, rule: 'missing-gutter', level: 'warning',
        message: `.${colClass} missing gutter class — add gutter-base`,
        fix: `Add 'gutter-base' to class: class="columns ${colClass} gutter-base"` });
    }
  }
  return findings;
}

// ── Rule 11: Hardcoded hex colors ──────────────────────────
export function checkHexColors(doc, file) {
  const findings = [];
  const styles = [...doc.querySelectorAll('style')];
  for (const s of styles) {
    if (s.textContent && /#[0-9a-fA-F]{3,8}/.test(s.textContent)) {
      findings.push({ file, rule: 'hardcoded-color', level: 'warning',
        message: 'Hardcoded hex color found — prefer CSS variables (var(--color-primary), etc.)' });
    }
  }
  // Also check inline styles
  const allEls = [...doc.querySelectorAll('[style]')];
  for (const el of allEls) {
    const style = el.getAttribute('style') || '';
    if (/#[0-9a-fA-F]{3,8}/.test(style)) {
      findings.push({ file, rule: 'hardcoded-color', level: 'warning',
        message: 'Hardcoded hex color in inline style — prefer CSS variables' });
    }
  }
  return findings;
}

// ── All rules ────────────────────────────────────────────────
export const ALL_RULES = [
  { name: 'active-screen', check: checkActiveScreen },
  { name: 'css-links', check: checkCssLinks },
  { name: 'device-detect', check: checkDeviceDetect },
  { name: 'media-queries', check: checkMediaQueries },
  { name: 'columns', check: checkColumns },
  { name: 'column-items', check: checkColumnItems },
  { name: 'break-classes', check: checkBreakClasses },
  { name: 'font-awesome', check: checkFontAwesome },
  { name: 'btn-specificity', check: checkBtnSpecificity },
  { name: 'gutter', check: checkGutter },
  { name: 'hex-colors', check: checkHexColors },
];
