import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/flowmo.js');

function writeComponent(proj, name, { render = true, css = true, demo = null } = {}) {
  const dir = path.join(proj, 'components/business', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    render
      ? `export function render(props) {\n  return '<div class="${name}">' + (props.label || '') + '</div>';\n}\n`
      : `export function helper() { return 42; }\n`
  );
  if (css) fs.writeFileSync(path.join(dir, 'index.css'), `.${name} { color: red; }\n`);
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

  it('bundles a component, derives namespace from package.json name, and writes a gitignored generic verify.html', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-nav-rail', { demo: `export default { label: 'hi' };\n` });

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    expect(fs.readFileSync(path.join(outDir, '.gitignore'), 'utf-8')).toBe('*\n');

    const js = fs.readFileSync(path.join(outDir, 'EfmCargo-blocks.js'), 'utf-8');
    expect(js).toContain('window.EfmCargo.renderJobNavRail = (function () {');
    expect(js).toContain('window.EfmCargo.render = function');
    expect(js).not.toContain('export function render'); // export stripped
    expect(js).toContain('"JobNavRail"'); // demoData key
    expect(js).toContain('"label": "hi"');

    const verify = fs.readFileSync(path.join(outDir, 'verify.html'), 'utf-8');
    expect(verify).toContain('Generic fallback harness');
    expect(verify).toContain('data-flowmo-mount="JobNavRail"');
    // cascade order: component CSS, then OSUI, then theme, in that order
    const compIdx = verify.indexOf('components/business/job-nav-rail/index.css');
    const osuiIdx = verify.indexOf('theme/outsystems-ui.css');
    const themeIdx = verify.indexOf('theme/theme.css');
    expect(compIdx).toBeGreaterThan(-1);
    expect(compIdx).toBeLessThan(osuiIdx);
    expect(osuiIdx).toBeLessThan(themeIdx);

    const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf-8');
    expect(readme).toContain('EfmCargo-blocks.js');
    expect(readme).toContain('the JobNavRail Block');
    expect(readme).not.toContain('| `theme/outsystems-ui.css`'); // never a paste target
  });

  it('respects an explicit namespace and iconLibrary config', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({
      name: 'efm-cargo',
      flowmo: { namespace: 'EFM', iconLibrary: 'phosphor' },
    }));
    writeComponent(proj, 'job-chat');

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    expect(fs.existsSync(path.join(outDir, 'EFM-blocks.js'))).toBe(true);
    const verify = fs.readFileSync(path.join(outDir, 'verify.html'), 'utf-8');
    expect(verify).toContain('phosphor-icons');
  });

  it('skips a component with no render export, warns, and still builds the rest', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    writeComponent(proj, 'not-a-component', { render: false });

    const out = execSync(`node "${CLI}" block:build`, { cwd: proj, encoding: 'utf-8' });
    expect(out).toContain('not-a-component/index.js has no "render" export');

    const js = fs.readFileSync(path.join(proj, 'dist/outsystems/EfmCargo-blocks.js'), 'utf-8');
    expect(js).toContain('renderJobChat');
    expect(js).not.toContain('NotAComponent');
  });

  it('lists screen stylesheets in the paste table', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    fs.mkdirSync(path.join(proj, 'screens/general-details'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'screens/general-details/index.css'), '.foo {}\n');

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const readme = fs.readFileSync(path.join(proj, 'dist/outsystems/README.md'), 'utf-8');
    expect(readme).toContain('screens/general-details/index.css');
    expect(readme).toContain('GeneralDetails Screen');
  });

  it('copies scripts/prototype-interactions.js as a second Script resource when present', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'efm-cargo' }));
    writeComponent(proj, 'job-chat');
    fs.mkdirSync(path.join(proj, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'scripts/prototype-interactions.js'), 'document.addEventListener("click", () => {});\n');

    execSync(`node "${CLI}" block:build`, { cwd: proj, stdio: 'pipe' });

    const outDir = path.join(proj, 'dist/outsystems');
    expect(fs.readFileSync(path.join(outDir, 'EfmCargo-interactions.js'), 'utf-8')).toContain('addEventListener');
    const verify = fs.readFileSync(path.join(outDir, 'verify.html'), 'utf-8');
    expect(verify).toContain('EfmCargo-interactions.js');
    const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf-8');
    expect(readme).toContain('a second module **Script** resource');
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
});
