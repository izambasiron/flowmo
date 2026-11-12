import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/flowmo.js');

describe('screen:create', () => {
  let proj;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flowmo-screen-create-'));
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('scaffolds a screen with the Font Awesome CDN by default (no flowmo config)', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'my-app' }));
    execSync(`node "${CLI}" screen:create home`, { cwd: proj, stdio: 'pipe' });

    const html = fs.readFileSync(path.join(proj, 'screens/home/index.visual.html'), 'utf-8');
    expect(html).toContain('cdnjs.cloudflare.com/ajax/libs/font-awesome');
    expect(html).not.toContain('phosphor-icons');
  });

  it('scaffolds a screen with the Phosphor CDN when flowmo.iconLibrary is "phosphor"', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({
      name: 'my-app',
      flowmo: { iconLibrary: 'phosphor' },
    }));
    execSync(`node "${CLI}" screen:create home`, { cwd: proj, stdio: 'pipe' });

    const html = fs.readFileSync(path.join(proj, 'screens/home/index.visual.html'), 'utf-8');
    expect(html).toContain('phosphor-icons');
    expect(html).not.toContain('font-awesome');
  });

  it('creates the full scaffold set (html, queries, test, README, mockups/)', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'my-app' }));
    execSync(`node "${CLI}" screen:create project-detail --layout side --ticket PROJ-1 --title "Project Detail"`, { cwd: proj, stdio: 'pipe' });

    const dir = path.join(proj, 'screens/project-detail');
    expect(fs.existsSync(path.join(dir, 'index.visual.html'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'queries.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'index.test.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'mockups'))).toBe(true);

    const html = fs.readFileSync(path.join(dir, 'index.visual.html'), 'utf-8');
    expect(html).toContain('layout-side/index.js');
    expect(html).toContain('Project Detail');
  });

  it('refuses to overwrite an existing screen without --force', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'my-app' }));
    execSync(`node "${CLI}" screen:create home`, { cwd: proj, stdio: 'pipe' });
    expect(() => execSync(`node "${CLI}" screen:create home`, { cwd: proj, stdio: 'pipe' })).toThrow();
  });

  it('overwrites an existing screen with --force', () => {
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'my-app' }));
    execSync(`node "${CLI}" screen:create home --title "First"`, { cwd: proj, stdio: 'pipe' });
    execSync(`node "${CLI}" screen:create home --title "Second" --force`, { cwd: proj, stdio: 'pipe' });

    const html = fs.readFileSync(path.join(proj, 'screens/home/index.visual.html'), 'utf-8');
    expect(html).toContain('Second');
  });
});
