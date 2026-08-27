import fs from 'fs';
import path from 'path';
import picocolors from 'picocolors';

const LAYOUTS = ['top', 'side', 'base', 'blank'];

const LAYOUT_IMPORTS = {
  top:   '../../components/layouts/layout-top/index.js',
  side:  '../../components/layouts/layout-side/index.js',
  base:  '../../components/layouts/layout-base/index.js',
  blank: '../../components/layouts/layout-blank/index.js',
};

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inferAppName(projectPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
    if (pkg.name) return pkg.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    // fall through to generic default
  }
  return 'App';
}

function scaffoldScreen(projectPath, dirName, { layout, ticket, title, module, appName, force }) {
  const screenDir = path.join(projectPath, 'screens', dirName);
  if (fs.existsSync(screenDir) && !force) {
    throw new Error(`Directory already exists: screens/${dirName}\nUse --force to overwrite.`);
  }

  fs.mkdirSync(screenDir, { recursive: true });
  // recursive: true — under --force, mockups/ (and any Figma exports a
  // developer already dropped there) must survive re-scaffolding.
  fs.mkdirSync(path.join(screenDir, 'mockups'), { recursive: true });
  if (!fs.existsSync(path.join(screenDir, 'mockups', '.gitkeep'))) {
    fs.writeFileSync(path.join(screenDir, 'mockups', '.gitkeep'), '');
  }

  const displayTitle = title || dirName.replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // ── index.visual.html ──────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(displayTitle)} — Flowmo</title>
  <link rel="stylesheet" href="../../theme/outsystems-ui.css">
  <link rel="stylesheet" href="../../theme/grid.css">
  <link rel="stylesheet" href="../../theme/theme.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
</head>
<body class="desktop landscape windows chrome is--touch">
  <div id="app-root">
    <!-- Layout component mounts here -->
    <!-- Every layout in components/layouts/ already wraps its own output in
         .active-screen — do not add a second one here, it silently breaks
         scrolling (the outer .active-screen clamps to 100vh with its own
         overflow:auto, but its scrollHeight never grows past that because
         the real content lives inside the INNER .active-screen instead). -->
  </div>
  <script src="../../scripts/device-detect.js"></script>
  <script type="module">
    import { mount } from '${LAYOUT_IMPORTS[layout]}';
    import { getScreenData } from './queries.js';

    const layout = mount(document.getElementById('app-root'), {
      appName: '${esc(appName)}',
      menuLinks: [
        { label: 'Home', href: '#', active: true },
      ],
      breadcrumbs: ['${esc(displayTitle)}'],
      title: '${esc(displayTitle)}',
    });

    // Mount business components into the content slot
    // const data = await getScreenData({ /* params */ });
    // const contentSlot = layout.getContentSlot();
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(screenDir, 'index.visual.html'), html);

  // ── queries.js ─────────────────────────────
  const ticketRef = ticket;
  const queries = `// ${dirName} — data layer
// ${ticketRef ? `Ticket: ${ticketRef}` : ''}

export const QUERIES = {
  // TODO: add query mappings
  //
  // example:
  // projectSummary: {
  //   file: 'database/sql/GetProjectSummary.advance.sql',
  //   params: ['ProjectId'],
  // },
};

/** Fetch all data needed by this screen. */
export function getScreenData(params) {
  // TODO: run queries and return data
  return {};
}
`;

  fs.writeFileSync(path.join(screenDir, 'queries.js'), queries);

  // ── index.test.js ───────────────────────────
  const testFile = `import { describe, it, expect } from 'vitest';

describe('${ticketRef ? ticketRef + ' — ' : ''}${displayTitle}', () => {
  it('renders layout without errors', () => {
    // TODO: mount screen, verify layout renders
    expect(true).toBe(true);
  });
});
`;

  fs.writeFileSync(path.join(screenDir, 'index.test.js'), testFile);

  // ── README.md ───────────────────────────────
  const readme = `# ${ticketRef ? ticketRef + ' — ' : ''}${displayTitle}

**Ticket:** ${ticketRef ? esc(ticketRef) : '_none_'}
**OutSystems:** Module \`${esc(module || '…')}\`, Screen \`${esc(displayTitle)}\`
**Status:** In progress

## Queries

| Screen function | SQL file |
|---|---|
| | |

## Components used

| Component | Mode |
|---|---|
| \`layouts/layout-${layout}\` | page shell |
| | |

## Mockups

| File | Description |
|---|---|
| | |
`;

  fs.writeFileSync(path.join(screenDir, 'README.md'), readme);

  return screenDir;
}

export async function screenCreate(rawArgs = []) {
  let layout = 'top';
  let ticket = '';
  let title = '';
  let module = '';
  let force = false;
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--layout') layout = rawArgs[++i] || 'top';
    else if (a.startsWith('--layout=')) layout = a.slice(9);
    else if (a === '--ticket') ticket = rawArgs[++i] || '';
    else if (a.startsWith('--ticket=')) ticket = a.slice(9);
    else if (a === '--title') title = rawArgs[++i] || '';
    else if (a.startsWith('--title=')) title = a.slice(10);
    else if (a === '--module') module = rawArgs[++i] || '';
    else if (a.startsWith('--module=')) module = a.slice(9);
    else if (a === '--force') force = true;
    else positional.push(a);
  }

  const dirName = positional[0];
  if (!dirName) {
    throw new Error(
      'Usage: flowmo screen:create <dir-name> [--layout top|side|base|blank] [--ticket <ref>] [--title "…"]\n' +
      'Example: flowmo screen:create 354-project-detail --layout top --ticket PROJ-354 --title "Project Detail"'
    );
  }

  if (!LAYOUTS.includes(layout)) {
    throw new Error(`Invalid layout: ${layout}. Must be one of: ${LAYOUTS.join(', ')}`);
  }

  const projectPath = process.cwd();
  const appName = inferAppName(projectPath);
  const screenDir = scaffoldScreen(projectPath, dirName, { layout, ticket, title, module, appName, force });

  const rel = path.relative(projectPath, screenDir);
  console.log(picocolors.green(`✓ Created ${rel}/`));
  console.log(picocolors.dim(`  index.visual.html  (layout-${layout})`));
  console.log(picocolors.dim(`  queries.js`));
  console.log(picocolors.dim(`  index.test.js`));
  console.log(picocolors.dim(`  README.md`));
  console.log(picocolors.dim(`  mockups/`));
}
