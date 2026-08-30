import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/flowmo.js');
const BANNER_RE = /^\/\* flowmo:build [0-9a-f]{8} · \d{4}-\d{2}-\d{2}T[\d:.]+Z — regenerate with `flowmo block:build`; do not hand-edit \*\/\n/;

function writeComponent(proj, name, { render = true, css = true, demo = null, extraJs = '' } = {}) {
  const dir = path.join(proj, 'components/business', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    render
      ? `${extraJs}export function render(props) {\n  return '<div class="${name}">' + (props.label || '') + '</div>';\n}\n`
      : `export function helper() { return 42; }\n`
  );
  if (css) fs.writeFileSync(path.join(dir, 'index.css'), `.${name} { color: red; }\n`);
  if (demo) fs.writeFileSync(path.join(dir, 'demo.js'), demo);
}

// A minimal but real copy of the shared Component.js (not the full template
// file — just enough to exercise the runtime contract in these tests).
const COMPONENT_JS_SOURCE = `export class Component {
  constructor({ target, props = {}, onEvent = () => {} }) {
    this.target = target;
    this.props = props;
    this.onEvent = onEvent;
  }
  mount() {
    this.render();
    this.attachEvents();
    return this;
  }
  render() {}
  update(nextProps) { this.props = { ...this.props, ...nextProps }; this.render(); }
  attachEvents() {}
  destroy() { this.target.innerHTML = ''; }
  esc(s) { return String(s ?? '').replace(/&/g, '&amp;'); }
}
`;

function writeSharedComponentJs(proj) {
  fs.mkdirSync(path.join(proj, 'components/shared'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'components/shared/Component.js'), COMPONENT_JS_SOURCE);
}

function writeClassComponent(proj, name, className, { css = true, demo = null, extraRender = '' } = {}) {
  const dir = path.join(proj, 'components/business', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    `import { Component } from '../../shared/Component.js';\n\nexport class ${className} extends Component {\n  render() {\n    this.target.innerHTML = '<div class="${name}">' + this.esc(this.props.label || '') + '</div>';${extraRender}\n  }\n}\n`
  );
  if (css) fs.writeFileSync(path.join(dir, 'index.css'), `.${name} { color: blue; }\n`);
  if (demo) fs.writeFileSync(path.join(dir, 'demo.js'), demo);
}

describe('block:build', () => {
  let proj;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmo-block-build-'));
    fs.mkdirSync(path.join(proj, 'theme'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'theme/theme.css'), ':root { --color-primary: #123; }\n');
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('does nothing and warns when no components exist', () => {
    const out = execSync(`node "${CLI}" block:build`, { cwd: proj, encoding: 'utf-8' });
    expect(out).toContain('No components found');
    expect(fs.existsSync(path.join(proj, 'dist/outsystems'))).toBe(false);
  });

  it('bundles a component into its own folder, derives namespace from package.json name, and writes a gitignored generic verify.html', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-nav-rail', { demo: `export default { label: 'hi' };\n` });

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    expect(fs.readFileSync(path.join(outDir, '.gitignore'), 'utf-8')).toBe('*\n');

    const js = fs.readFileSync(path.join(outDir, 'JobNavRail/JobNavRail.js'), 'utf-8');
    expect(js).toMatch(BANNER_RE);
    expect(js).toContain('window.EfmCargo.renderJobNavRail = (function () {');
    expect(js).not.toContain('export function render'); // export stripped
    expect(js).toContain('window.EfmCargo.demoData.JobNavRail'); // demoData key
    expect(js).toContain('"label": "hi"');

    const css = fs.readFileSync(path.join(outDir, 'JobNavRail/JobNavRail.css'), 'utf-8');
    expect(css).toMatch(BANNER_RE);
    expect(css).toContain('.job-nav-rail { color: red; }');

    const shared = fs.readFileSync(path.join(outDir, 'EfmCargo-Shared.js'), 'utf-8');
    expect(shared).toMatch(BANNER_RE);
    expect(shared).toContain('window.EfmCargo.render = function');

    const theme = fs.readFileSync(path.join(outDir, 'theme.css'), 'utf-8');
    expect(theme).toMatch(BANNER_RE);
    expect(theme).toContain('--color-primary: #123');

    const verify = fs.readFileSync(path.join(outDir, 'verify.html'), 'utf-8');
    expect(verify).toContain('Generic fallback harness');
    expect(verify).toContain('data-flowmo-mount="JobNavRail"');
    expect(verify).toContain('<script src="./EfmCargo-Shared.js"></script>');
    expect(verify).toContain('<script src="./JobNavRail/JobNavRail.js"></script>');
    // cascade order: component CSS, then OSUI, then theme, in that order
    const compIdx = verify.indexOf('JobNavRail/JobNavRail.css');
    const osuiIdx = verify.indexOf('theme/outsystems-ui.css');
    const themeIdx = verify.indexOf('theme.css');
    expect(compIdx).toBeGreaterThan(-1);
    expect(compIdx).toBeLessThan(osuiIdx);
    expect(osuiIdx).toBeLessThan(themeIdx);

    const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf-8');
    expect(readme).toContain('JobNavRail/JobNavRail.js');
    expect(readme).toContain('JobNavRail/JobNavRail.css');
    expect(readme).toContain('EfmCargo-Shared.js');
    expect(readme).not.toContain('| `theme/outsystems-ui.css`'); // never a paste target
    expect(readme).toContain('| Component | Contract | Script resource | Style Sheet |'); // table header present
  });

  it('respects an explicit namespace and iconLibrary config', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({
      name: 'efm-cargo',
      flowmo: { namespace: 'EFM', iconLibrary: 'phosphor' },
    }));
    writeComponent(proj, 'job-chat');

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    expect(fs.existsSync(path.join(outDir, 'JobChat/JobChat.js'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'EFM-Shared.js'))).toBe(true);
    const verify = fs.readFileSync(path.join(outDir, 'verify.html'), 'utf-8');
    expect(verify).toContain('phosphor-icons');
  });

  it('skips a component with no render export, warns, and still builds the rest', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    writeComponent(proj, 'not-a-component', { render: false });

    const out = execSync(`node "${CLI}" block:build`, { cwd: proj, encoding: 'utf-8' });
    expect(out).toContain('not-a-component/index.js has no "render" export');

    const outDir = path.join(proj, 'dist/outsystems');
    expect(fs.existsSync(path.join(outDir, 'JobChat/JobChat.js'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'NotAComponent'))).toBe(false);
  });

  it('copies screen stylesheets into dist/outsystems/screens/ and lists them in the README', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    fs.mkdirSync(path.join(proj, 'screens/general-details'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'screens/general-details/index.css'), '.foo {}\n');

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    const screenCss = fs.readFileSync(path.join(outDir, 'screens/GeneralDetails.css'), 'utf-8');
    expect(screenCss).toMatch(BANNER_RE);
    expect(screenCss).toContain('.foo {}');

    const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf-8');
    expect(readme).toContain('screens/GeneralDetails.css');
    expect(readme).toContain('GeneralDetails Screen');
  });

  it('copies scripts/prototype-interactions.js as a second Script resource when present', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    fs.mkdirSync(path.join(proj, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'scripts/prototype-interactions.js'), 'document.addEventListener("click", () => {});\n');

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    const interactions = fs.readFileSync(path.join(outDir, 'EfmCargo-Interactions.js'), 'utf-8');
    expect(interactions).toMatch(BANNER_RE);
    expect(interactions).toContain('addEventListener');
    const verify = fs.readFileSync(path.join(outDir, 'verify.html'), 'utf-8');
    expect(verify).toContain('EfmCargo-Interactions.js');
    const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf-8');
    expect(readme).toContain('a second module **Script** resource');
  });

  it('rewrites a named import from components/shared/ into a window.<NS>.Shared reference', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    fs.mkdirSync(path.join(proj, 'components/shared'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'components/shared/esc.js'), `export function esc(s) {\n  return String(s ?? '').replace(/&/g, '&amp;');\n}\n`);
    writeComponent(proj, 'job-nav-rail', { extraJs: `import { esc } from '../../shared/esc.js';\n` });

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    const js = fs.readFileSync(path.join(outDir, 'JobNavRail/JobNavRail.js'), 'utf-8');
    expect(js).toContain('const { esc } = window.EfmCargo.Shared;');
    expect(js).not.toContain("import { esc }");

    const shared = fs.readFileSync(path.join(outDir, 'EfmCargo-Shared.js'), 'utf-8');
    expect(shared).toContain('function esc(s)');
    expect(shared).toContain('window.EfmCargo.Shared.esc = esc;');
  });

  it('injects into a hand-authored theme/verify-shell.html instead of the generic fallback', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    fs.writeFileSync(path.join(proj, 'theme/verify-shell.html'), `<!DOCTYPE html>
<html><head>
<!-- flowmo:stylesheets -->
</head>
<body class="desktop landscape osx chrome">
  <div data-flowmo-mount="JobChat"></div>
  <!-- flowmo:scripts -->
</body></html>
`);

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const verify = fs.readFileSync(path.join(proj, 'dist/outsystems/verify.html'), 'utf-8');
    expect(verify).toContain('class="desktop landscape osx chrome"');
    expect(verify).toContain('theme/outsystems-ui.css');
    expect(verify).toContain('<script src="./EfmCargo-Shared.js"></script>');
    expect(verify).toContain('<script src="./JobChat/JobChat.js"></script>');
    expect(verify).toContain("EfmCargo.render('JobChat'");
    expect(verify).not.toContain('generic fallback harness');

    const readme = fs.readFileSync(path.join(proj, 'dist/outsystems/README.md'), 'utf-8');
    expect(readme).toContain('was generated from your `theme/verify-shell.html`');
  });

  it('warns (and does not call render for) a shell mount name with no matching built component', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    fs.writeFileSync(path.join(proj, 'theme/verify-shell.html'), `<html><head>
<!-- flowmo:stylesheets -->
</head><body>
  <div data-flowmo-mount="JobChat"></div>
  <div data-flowmo-mount="JobNavRial"></div>
  <!-- flowmo:scripts -->
</body></html>
`);

    const out = execSync(`node "${CLI}" block:build`, { cwd: proj, encoding: 'utf-8' });
    expect(out).toContain('mounts "JobNavRial", but no built component has that name');

    const verify = fs.readFileSync(path.join(proj, 'dist/outsystems/verify.html'), 'utf-8');
    expect(verify).not.toContain("render('JobNavRial'");
  });

  it('warns when a built component is never mounted in the shell', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    writeComponent(proj, 'job-nav-rail');
    fs.writeFileSync(path.join(proj, 'theme/verify-shell.html'), `<html><head>
<!-- flowmo:stylesheets -->
</head><body>
  <div data-flowmo-mount="JobChat"></div>
  <!-- flowmo:scripts -->
</body></html>
`);

    const out = execSync(`node "${CLI}" block:build`, { cwd: proj, encoding: 'utf-8' });
    expect(out).toContain('JobNavRail is bundled but not mounted anywhere in theme/verify-shell.html');

    const readme = fs.readFileSync(path.join(proj, 'dist/outsystems/README.md'), 'utf-8');
    expect(readme).toContain('JobNavRail is bundled but not mounted anywhere');
  });

  it('throws a clear error when verify-shell.html is missing a required placeholder', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    fs.writeFileSync(path.join(proj, 'theme/verify-shell.html'), '<html><body></body></html>\n');

    expect(() => execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' })).toThrow();
  });

  // ── Phase 2: the class contract ──────────────────────────────────────

  describe('class contract (Phase 2)', () => {
    it('bundles a class component under window.<NS>.<Name> (no "render" prefix), exposes Component directly (not under .Shared)', () => {
      fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
      writeSharedComponentJs(proj);
      writeClassComponent(proj, 'job-nav-rail', 'JobNavRail', { demo: `export default { label: 'hi' };\n` });

      const out = execSync(`node "${CLI}" block:build`, { cwd: proj, encoding: 'utf-8' });
      expect(out).toContain('(class)');

      const outDir = path.join(proj, 'dist/outsystems');
      const js = fs.readFileSync(path.join(outDir, 'JobNavRail/JobNavRail.js'), 'utf-8');
      expect(js).toContain('window.EfmCargo.JobNavRail = (function () {');
      expect(js).not.toContain('window.EfmCargo.renderJobNavRail');
      expect(js).toContain('const Component = window.EfmCargo.Component;');
      expect(js).not.toContain('window.EfmCargo.Shared;'); // Component is NOT under .Shared
      expect(js).toContain('return JobNavRail;');
      expect(js).toContain('window.EfmCargo.instances[$parameters.ContainerId]'); // OnReady snippet in header
      expect(js).toContain('OnParametersChanged: window.EfmCargo.instances[$parameters.ContainerId]?.update');
      expect(js).toContain('OnDestroy:           window.EfmCargo.instances[$parameters.ContainerId]?.destroy();');

      const shared = fs.readFileSync(path.join(outDir, 'EfmCargo-Shared.js'), 'utf-8');
      expect(shared).toContain('window.EfmCargo.Component = Component;');
      expect(shared).toContain('class Component {');

      const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf-8');
      expect(readme).toContain('| **JobNavRail** | class |');
      expect(readme).toContain('`class` contract components also need OnParametersChanged and OnDestroy wired');
    });

    it('actually runs at runtime: instantiate, mount, update, destroy, via the instances registry', () => {
      fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
      writeSharedComponentJs(proj);
      writeClassComponent(proj, 'job-nav-rail', 'JobNavRail');

      execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

      const outDir = path.join(proj, 'dist/outsystems');
      const sharedJs = fs.readFileSync(path.join(outDir, 'EfmCargo-Shared.js'), 'utf-8');
      const componentJs = fs.readFileSync(path.join(outDir, 'JobNavRail/JobNavRail.js'), 'utf-8');

      const sandbox = {};
      sandbox.window = sandbox;
      sandbox.document = {
        getElementById: () => ({ innerHTML: '' }),
      };
      // eslint-disable-next-line no-new-func
      const run = new Function('window', 'document', `${sharedJs}\n${componentJs}\nreturn window;`);
      const w = run(sandbox, sandbox.document);

      const target = { innerHTML: '<stale>' };
      const instance = new w.EfmCargo.JobNavRail({ target, props: { label: 'A & B' } }).mount();
      expect(target.innerHTML).toContain('A &amp; B');

      instance.update({ label: 'updated' });
      expect(target.innerHTML).toContain('updated');

      instance.destroy();
      expect(target.innerHTML).toBe('');
    });

    it('mixes function- and class-contract components in the same build', () => {
      fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
      writeSharedComponentJs(proj);
      writeComponent(proj, 'job-chat');
      writeClassComponent(proj, 'job-nav-rail', 'JobNavRail');

      execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

      const outDir = path.join(proj, 'dist/outsystems');
      const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf-8');
      expect(readme).toContain('| **JobChat** | function |');
      expect(readme).toContain('| **JobNavRail** | class |');

      // verify.html's generic fallback mounts each with the right call
      const verify = fs.readFileSync(path.join(outDir, 'verify.html'), 'utf-8');
      expect(verify).toContain("EfmCargo.render('JobChat'"); // function-contract dispatch
      expect(verify).toContain("new window.EfmCargo.JobNavRail({"); // class-contract instantiation
    });

    it('warns if the class name does not match the directory-derived component name, but still bundles it', () => {
      fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
      writeSharedComponentJs(proj);
      writeClassComponent(proj, 'job-nav-rail', 'WeirdName');

      const out = execSync(`node "${CLI}" block:build`, { cwd: proj, encoding: 'utf-8' });
      expect(out).toContain('exports class "WeirdName", expected "JobNavRail"');

      const js = fs.readFileSync(path.join(proj, 'dist/outsystems/JobNavRail/JobNavRail.js'), 'utf-8');
      expect(js).toContain('window.EfmCargo.JobNavRail = (function () {');
      expect(js).toContain('return WeirdName;');
    });
  });
});
