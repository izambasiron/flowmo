import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import {
  checkActiveScreen, checkCssLinks, checkDeviceDetect, checkMediaQueries,
  checkColumns, checkColumnItems, checkBreakClasses, checkFontAwesome,
  checkBtnSpecificity, checkGutter, checkHexColors,
} from '../src/lib/lint-rules.js';

function doc(html) {
  const window = new Window();
  window.document.write(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`);
  return window.document;
}

const FILE = 'test.visual.html';

describe('checkActiveScreen', () => {
  it('passes with .active-screen > .layout', () => {
    const d = doc('<div class="active-screen"><div class="layout layout-top"></div></div>');
    expect(checkActiveScreen(d, FILE)).toEqual([]);
  });

  it('flags missing .active-screen', () => {
    const d = doc('<div class="layout"></div>');
    const r = checkActiveScreen(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('missing-active-screen');
  });

  it('allows #app-root mount point (layout rendered by JS)', () => {
    const d = doc('<div class="active-screen"><div id="app-root"></div></div>');
    d.body.innerHTML += '<script type="module">import { mount } from \'../../components/layouts/layout-top/index.js\';</script>';
    expect(checkActiveScreen(d, FILE)).toEqual([]);
  });

  it('flags missing .layout when no mount point either', () => {
    const d = doc('<div class="active-screen"><div>no layout or app-root</div></div>');
    const r = checkActiveScreen(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('missing-layout');
  });
});

describe('checkCssLinks', () => {
  it('passes with all three CSS files in correct order', () => {
    const d = doc('');
    d.head.innerHTML = `
      <link rel="stylesheet" href="outsystems-ui.css">
      <link rel="stylesheet" href="grid.css">
      <link rel="stylesheet" href="theme.css">
    `;
    expect(checkCssLinks(d, FILE)).toEqual([]);
  });

  it('flags missing CSS files', () => {
    const d = doc('');
    d.head.innerHTML = '<link rel="stylesheet" href="theme.css">';
    const r = checkCssLinks(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].message).toContain('outsystems-ui.css');
    expect(r[0].message).toContain('grid.css');
  });

  it('flags wrong order', () => {
    const d = doc('');
    d.head.innerHTML = `
      <link rel="stylesheet" href="theme.css">
      <link rel="stylesheet" href="grid.css">
      <link rel="stylesheet" href="outsystems-ui.css">
    `;
    const r = checkCssLinks(d, FILE);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('checkDeviceDetect', () => {
  it('passes when device-detect.js is present', () => {
    const d = doc('<script src="../scripts/device-detect.js"></script>');
    expect(checkDeviceDetect(d, FILE)).toEqual([]);
  });

  it('flags missing device-detect.js', () => {
    const d = doc('<script src="app.js"></script>');
    const r = checkDeviceDetect(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('missing-device-detect');
  });
});

describe('checkMediaQueries', () => {
  it('passes without @media', () => {
    const d = doc('<style>body { color: red; }</style>');
    expect(checkMediaQueries(d, FILE)).toEqual([]);
  });

  it('flags @media', () => {
    const d = doc('<style>@media (max-width: 768px) { body { color: red; } }</style>');
    const r = checkMediaQueries(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('no-media-queries');
  });
});

describe('checkColumns', () => {
  it('passes with .columns.columns3', () => {
    const d = doc('<div class="columns columns3 gutter-base"></div>');
    expect(checkColumns(d, FILE)).toEqual([]);
  });

  it('flags .columns3 without .columns', () => {
    const d = doc('<div class="columns3"></div>');
    const r = checkColumns(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('missing-columns-base');
  });
});

describe('checkColumnItems', () => {
  it('passes with .columns-item children', () => {
    const d = doc('<div class="columns columns2"><div class="columns-item">A</div></div>');
    expect(checkColumnItems(d, FILE)).toEqual([]);
  });

  it('flags .column (wrong class)', () => {
    const d = doc('<div class="columns columns2"><div class="column">A</div></div>');
    const r = checkColumnItems(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('bad-column-class');
  });
});

describe('checkBreakClasses', () => {
  it('passes with phone-break-all', () => {
    const d = doc('<div class="columns columns3 phone-break-all"></div>');
    expect(checkBreakClasses(d, FILE)).toEqual([]);
  });

  it('warns without break class', () => {
    const d = doc('<div class="columns columns3 gutter-base"></div>');
    const r = checkBreakClasses(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].level).toBe('warning');
  });
});

describe('checkFontAwesome', () => {
  it('passes when no icons are used', () => {
    const d = doc('<div>no icons</div>');
    expect(checkFontAwesome(d, FILE)).toEqual([]);
  });

  it('passes when icons and CDN both present', () => {
    const d = doc('<i class="fa fa-home"></i>');
    d.head.innerHTML = '<link rel="stylesheet" href="font-awesome.min.css">';
    expect(checkFontAwesome(d, FILE)).toEqual([]);
  });

  it('flags icons without CDN', () => {
    const d = doc('<i class="fa fa-home"></i>');
    const r = checkFontAwesome(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('missing-font-awesome');
  });
});

describe('checkBtnSpecificity', () => {
  it('passes for plain .btn', () => {
    const d = doc('<button class="btn btn-primary">Save</button>');
    expect(checkBtnSpecificity(d, FILE)).toEqual([]);
  });

  it('warns when .btn has .background-neutral-0', () => {
    const d = doc('<button class="btn background-neutral-0 text-primary">Save</button>');
    const r = checkBtnSpecificity(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].level).toBe('warning');
  });
});

describe('checkGutter', () => {
  it('passes with gutter class', () => {
    const d = doc('<div class="columns columns2 gutter-base"></div>');
    expect(checkGutter(d, FILE)).toEqual([]);
  });

  it('warns without gutter', () => {
    const d = doc('<div class="columns columns2"></div>');
    const r = checkGutter(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('missing-gutter');
  });
});

describe('checkHexColors', () => {
  it('passes without hex colors', () => {
    const d = doc('<style>body { color: var(--color-primary); }</style>');
    expect(checkHexColors(d, FILE)).toEqual([]);
  });

  it('warns with hex color in style block', () => {
    const d = doc('<style>body { color: #fff; }</style>');
    const r = checkHexColors(d, FILE);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe('hardcoded-color');
  });

  it('warns with hex color in inline style', () => {
    const d = doc('<div style="background: #ff0000"></div>');
    const r = checkHexColors(d, FILE);
    expect(r).toHaveLength(1);
  });
});
