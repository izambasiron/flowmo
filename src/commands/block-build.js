import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import picocolors from 'picocolors';
import { readFlowmoConfig, toPascalCase, ICON_CDN } from '../lib/flowmo-config.js';

/* Generalizes the OutSystems-porting pipeline EFM-Cargo hand-built in
   scripts/build-os-block.js (see flowmo/reviews/2026-08-29-efm-cargo-retro.md
   §1). OutSystems can't host ES modules, so components written the flowmo way
   (`export function render(props)`) need bundling before they can be pasted
   into a module. CSS is never transformed — every stylesheet already targets
   exactly one destination (component CSS → that Block, theme.css → the
   Theme, screen CSS → that Screen) — but per
   flowmo/reviews/2026-08-30-components-plan.md §1.3, it IS copied into
   dist/outsystems/ so the whole paste payload is one self-contained folder.

   Phase 1 of that plan (§1.1-§1.6): one folder per component instead of one
   shared bundle — so two developers working on different components never
   touch the same generated file — plus a components/shared/ bundle for
   reusable code, analogous to theme.css vs per-component CSS. */

// A drift-detection banner (components plan §1.6): a hash of this exact
// output plus a timestamp, prepended to every generated file. `/* */` is a
// valid comment in both JS and CSS, so one implementation covers both.
function versionBanner(content) {
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
  const stamp = new Date().toISOString();
  return `/* flowmo:build ${hash} · ${stamp} — regenerate with \`flowmo block:build\`; do not hand-edit */\n`;
}

function discoverComponents(projectPath) {
  const root = path.join(projectPath, 'components/business');
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'index.js')))
    .sort()
    .map((name) => ({
      dirName: name,
      componentName: toPascalCase(name),
      jsFile: path.join(root, name, 'index.js'),
      cssFile: fs.existsSync(path.join(root, name, 'index.css')) ? path.join(root, name, 'index.css') : null,
      demoFile: fs.existsSync(path.join(root, name, 'demo.js')) ? path.join(root, name, 'demo.js') : null,
    }));
}

function discoverScreenStylesheets(projectPath) {
  const root = path.join(projectPath, 'screens');
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'index.css')))
    .sort()
    .map((name) => ({ screenName: name, screenPascal: toPascalCase(name), cssFile: path.join(root, name, 'index.css') }));
}

function discoverSharedFiles(projectPath) {
  const root = path.join(projectPath, 'components/shared');
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js'))
    .map((d) => d.name)
    .sort();
}

function collectExportNames(src) {
  const names = new Set();
  const fnRe = /^export function (\w+)/gm;
  const constRe = /^export const (\w+)/gm;
  const classRe = /^export class (\w+)/gm;
  let m;
  while ((m = fnRe.exec(src))) names.add(m[1]);
  while ((m = constRe.exec(src))) names.add(m[1]);
  while ((m = classRe.exec(src))) names.add(m[1]);
  return [...names];
}

// Rewrites `import { a, b } from '<anything>/shared/<file>.js';` to
// `const { a, b } = window.<NS>.Shared;` — the plan's §1.5 decision: a
// narrowly-scoped regex pass, not a real bundler, so the "no dependency
// graph to resolve" property that makes the export-strip-and-wrap transform
// possible survives. Only named imports pointing into components/shared/
// are handled; anything else (a cross-component import, a default import)
// is untouched and will surface as a SyntaxError in the output, same as
// today — that's still a real signal that the component broke the "zero
// cross-imports" rule in business-components.md.
//
// One exception (components plan §1.2/§2.4): Component is exposed directly
// as window.<NS>.Component, not window.<NS>.Shared.Component — its load
// order is what makes `class X extends Component` safe at parse time, and
// that shouldn't be buried a level deep in the general utility namespace.
const SHARED_IMPORT_RE = /^import\s*\{\s*([^}]+?)\s*\}\s*from\s*['"][^'"]*\/shared\/([^'"]+)['"]\s*;?\s*$/gm;

function rewriteSharedImports(src, namespace) {
  return src.replace(SHARED_IMPORT_RE, (_, names, file) => {
    if (file === 'Component.js' && names.trim() === 'Component') {
      return `const Component = window.${namespace}.Component;`;
    }
    return `const { ${names} } = window.${namespace}.Shared;`;
  });
}

function buildSharedBundle(namespace, projectPath, sharedFiles) {
  const assignments = [];
  const bodies = sharedFiles.map((file) => {
    const raw = fs.readFileSync(path.join(projectPath, 'components/shared', file), 'utf-8');
    const names = collectExportNames(raw);
    for (const n of names) {
      if (file === 'Component.js' && n === 'Component') {
        assignments.push(`  window.${namespace}.Component = Component;`);
      } else {
        assignments.push(`  window.${namespace}.Shared.${n} = ${n};`);
      }
    }
    const stripped = raw.replace(/^export /gm, '');
    return `/* ── components/shared/${file} ── */\n${stripped.trimEnd()}`;
  });

  const body = `/* ── ${namespace} — shared utilities + mount dispatcher ──
   GENERATED by \`flowmo block:build\` — do not edit here.
   Edit source under components/shared/*.js and re-run.

   Paste into its own Script resource, before any component's own Script
   resource (Load order note below). Exposes:
     window.${namespace}.Component                 -> the base class components/business/*
                                       extend (from components/shared/Component.js)
     window.${namespace}.Shared.*                   -> everything else under components/shared/*.js
     window.${namespace}.render(name, el[, props])  -> injects into el (old render(props) contract only)
     window.${namespace}.instances                  -> { [containerId]: instance } registry
                                       (new class contract only — see business-components.md)

   Load order: for a plain render(props) component this only needs to be
   pasted before its render is first CALLED, not before it's parsed. For a
   component that does \`class X extends Component\` (the class contract),
   this is load-bearing: \`extends\` evaluates at PARSE time, so this script
   must load and finish executing before that component's script parses, or
   it throws "Cannot extend undefined" immediately. Confirmed 2026-08-30
   against a live ODC app that Script resources load in declaration order —
   attach this one first in Service Studio.
──────────────────────────────────────────────────────── */
window.${namespace} = window.${namespace} || {};
window.${namespace}.Shared = window.${namespace}.Shared || {};
window.${namespace}.instances = window.${namespace}.instances || {};
${sharedFiles.length ? `(function () {
${bodies.join('\n\n')}

${assignments.join('\n')}
})();
` : '// (no components/shared/*.js files yet)'}
window.${namespace}.render = function (name, el, props) {
  var fn = window.${namespace}['render' + name];
  if (!fn) { throw new Error('${namespace}: unknown component "' + name + '"'); }
  if (!el) { throw new Error('${namespace}: no container element for "' + name + '"'); }
  el.innerHTML = fn(props || (window.${namespace}.demoData && window.${namespace}.demoData[name]) || {});
  return el;
};
`;

  return versionBanner(body) + body;
}

// Components plan §2.7: the class contract (Phase 2) coexists with today's
// render(props) contract (Phase 1) — §2.5 deliberately doesn't require
// migrating all components atomically. So the gate has to detect BOTH
// shapes, not just recognize one.
const CLASS_EXTENDS_RE = /class\s+(\w+)\s+extends\s+Component\b/;

function onReadySnippet(namespace, c) {
  if (c.kind === 'class') {
    return `window.${namespace}.instances = window.${namespace}.instances || {};
window.${namespace}.instances[$parameters.ContainerId] = new window.${namespace}.${c.componentName}({
  target: document.getElementById($parameters.ContainerId),
  props: $parameters.InitialValue || window.${namespace}.demoData.${c.componentName},
  onEvent: (name, data) => $actions.HandleJsEvent(name, JSON.stringify(data)),
}).mount();`;
  }
  return `window.${namespace}.render('${c.componentName}', document.getElementById($parameters.ContainerId));`;
}

async function buildComponents(namespace, components) {
  const warnings = [];
  const built = [];

  for (const c of components) {
    const raw = fs.readFileSync(c.jsFile, 'utf-8');
    const rewritten = rewriteSharedImports(raw, namespace);
    const stripped = rewritten.replace(/^export /gm, '');

    const classMatch = stripped.match(CLASS_EXTENDS_RE);
    const isFunction = /\bfunction\s+render\s*\(/.test(stripped) || /\bconst\s+render\s*=/.test(stripped);

    if (!classMatch && !isFunction) {
      warnings.push(`components/business/${c.dirName}/index.js has no "render" export and no "class ... extends Component" — skipped.`);
      continue;
    }

    const kind = classMatch ? 'class' : 'function';
    const internalClassName = classMatch ? classMatch[1] : null;
    if (internalClassName && internalClassName !== c.componentName) {
      warnings.push(`components/business/${c.dirName}/index.js exports class "${internalClassName}", expected "${c.componentName}" (from the directory name) — bundled under window.${namespace}.${c.componentName} regardless, but consider renaming the class to match.`);
    }

    let demoData = {};
    if (c.demoFile) {
      const mod = await import(pathToFileURL(c.demoFile).href);
      demoData = mod.default ?? mod.demoData ?? {};
    } else {
      warnings.push(`components/business/${c.dirName}/demo.js not found — ${c.componentName} demos with {}.`);
    }

    const componentWithKind = { ...c, kind };
    const mountSnippet = onReadySnippet(namespace, componentWithKind);

    const returnLine = kind === 'class' ? `  return ${internalClassName};` : '  return render;';
    const exposesLine = kind === 'class'
      ? `window.${namespace}.${c.componentName}          -> the component class (instantiate with 'new')`
      : `window.${namespace}.render${c.componentName}(props) -> HTML string`;

    const body = `/* ── ${c.componentName} — bundled OutSystems Block component (${kind} contract) ──
   GENERATED by \`flowmo block:build\` — do not edit here.
   Edit the source under components/business/${c.dirName}/index.js and re-run.

   Paste into its own Script resource, then from this Block's OnReady:
     ${mountSnippet.split('\n').join('\n     ')}
   Also paste ${namespace}-Shared.js (any order for this component${kind === 'class' ? '' : ', but'} —
   it defines ${kind === 'class' ? 'the shared Component base class this extends, which MUST load first (parse-time dependency — see that file\'s own header)' : 'the render() dispatcher this call uses'}.
   Exposes:
     ${exposesLine}
   With no explicit props, ${kind === 'class' ? 'the OnReady snippet above falls back to' : 'render() falls back to'} the demo
   data below, so the Block renders a real layout before any aggregate is
   wired up.${kind === 'class' ? `
   OnParametersChanged: window.${namespace}.instances[$parameters.ContainerId]?.update({ ...changed props });
   OnDestroy:           window.${namespace}.instances[$parameters.ContainerId]?.destroy(); delete window.${namespace}.instances[$parameters.ContainerId];` : ''}
──────────────────────────────────────────────────────── */
window.${namespace} = window.${namespace} || {};
window.${namespace}.${kind === 'class' ? c.componentName : 'render' + c.componentName} = (function () {
${stripped.trimEnd().split('\n').map((l) => (l ? '  ' + l : l)).join('\n')}

${returnLine}
})();

window.${namespace}.demoData = window.${namespace}.demoData || {};
window.${namespace}.demoData.${c.componentName} = ${JSON.stringify(demoData, null, 2)};
`;

    built.push({ ...componentWithKind, mountSnippet, js: versionBanner(body) + body });
  }

  return { built, warnings };
}

function buildCssManifest(components, screens) {
  // Cascade order per architectural-heuristics.md §1: Block CSS -> outsystems-ui.css -> Theme -> Screen.
  // Each entry: sourceRel (copy from), distRel (dist/outsystems-relative, both for the copy
  // destination and for verify.html's <link>), paste (does the README list it as a paste target).
  const list = [];
  for (const c of components) {
    if (c.cssFile) {
      list.push({
        sourceRel: `components/business/${c.dirName}/index.css`,
        distRel: `${c.componentName}/${c.componentName}.css`,
        dest: `the ${c.componentName} Block's **Style Sheet**`,
        paste: true,
      });
    }
  }
  list.push({ sourceRel: 'theme/outsystems-ui.css', distRel: null, dest: null, paste: false }); // never copied/pasted — source-only, for cascade parity
  list.push({ sourceRel: 'theme/theme.css', distRel: 'theme.css', dest: 'the module **Theme**', paste: true });
  for (const s of screens) {
    list.push({
      sourceRel: s.cssFile ? `screens/${s.screenName}/index.css` : null,
      distRel: `screens/${s.screenPascal}.css`,
      dest: `the ${s.screenPascal} Screen's **Style Sheet**`,
      paste: true,
      screenName: s.screenName,
    });
  }
  return list;
}

// The verify.html mount call for one component, by kind — mirrors
// onReadySnippet's real-Block mapping but targets a querySelector'd element
// (no $parameters.ContainerId here) and keys the instances registry by
// component name, since verify.html mounts each component exactly once.
function verifyMountCall(namespace, byName, name) {
  const c = byName.get(name);
  if (c?.kind === 'class') {
    return `window.${namespace}.instances = window.${namespace}.instances || {}; window.${namespace}.instances['${name}'] = new window.${namespace}.${name}({ target: document.querySelector('[data-flowmo-mount="${name}"]'), props: window.${namespace}.demoData && window.${namespace}.demoData['${name}'] }).mount();`;
  }
  return `${namespace}.render('${name}', document.querySelector('[data-flowmo-mount="${name}"]'));`;
}

function buildVerifyHtml({ projectPath, namespace, iconLibrary, css, components, hasInteractions }) {
  const shellPath = path.join(projectPath, 'theme/verify-shell.html');
  const byName = new Map(components.map((c) => [c.componentName, c]));
  const linkTags = css.map((s) => `  <link rel="stylesheet" href="${s.distRel ? './' + s.distRel : '/' + s.sourceRel}">`).join('\n');
  const scriptTags = [
    `  <script src="./${namespace}-Shared.js"></script>`,
    ...components.map((c) => `  <script src="./${c.componentName}/${c.componentName}.js"></script>`),
    hasInteractions ? `  <script src="./${namespace}-Interactions.js"></script>` : null,
  ].filter(Boolean).join('\n');
  const mountNames = [];

  if (fs.existsSync(shellPath)) {
    let shell = fs.readFileSync(shellPath, 'utf-8');
    const shellWarnings = [];

    const mountRe = /data-flowmo-mount="([^"]+)"/g;
    let m;
    while ((m = mountRe.exec(shell))) mountNames.push(m[1]);

    // Reconcile shell mount points against what actually got bundled. Without
    // this, a typo in the shell throws "unknown component" only in the
    // browser console, and a bundled component the shell forgot to mount is
    // never exercised at all — silently, with the harness still "passing".
    // Both are exactly the "local preview flatters the port" failure this
    // command exists to prevent.
    const builtNames = new Set(components.map((c) => c.componentName));
    const mountedNames = new Set(mountNames);
    for (const n of mountNames) {
      if (!builtNames.has(n)) {
        shellWarnings.push(`theme/verify-shell.html mounts "${n}", but no built component has that name — verify.html will throw "unknown component" in the browser console.`);
      }
    }
    for (const c of components) {
      if (!mountedNames.has(c.componentName)) {
        shellWarnings.push(`${c.componentName} is bundled but not mounted anywhere in theme/verify-shell.html — it is never exercised by verify.html. Add data-flowmo-mount="${c.componentName}" somewhere in the shell.`);
      }
    }

    const scripts = [
      scriptTags,
      '  <script>',
      ...mountNames.filter((n) => builtNames.has(n)).map((n) => `    ${verifyMountCall(namespace, byName, n)}`),
      '  </script>',
    ].join('\n');

    if (!shell.includes('<!-- flowmo:stylesheets -->')) {
      throw new Error('theme/verify-shell.html is missing the <!-- flowmo:stylesheets --> placeholder.');
    }
    if (!shell.includes('<!-- flowmo:scripts -->')) {
      throw new Error('theme/verify-shell.html is missing the <!-- flowmo:scripts --> placeholder.');
    }

    shell = shell.replace('<!-- flowmo:stylesheets -->', linkTags);
    shell = shell.replace('<!-- flowmo:scripts -->', scripts);
    return { html: shell, generic: false, mountNames, warnings: shellWarnings };
  }

  // Generic fallback: correct cascade order, no assumption about real DOM/body
  // classes. Catches cascade-order bugs; won't catch DOM-shape-dependent ones.
  // Author theme/verify-shell.html with the real live DOM to get full fidelity.
  for (const c of components) mountNames.push(c.componentName);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OutSystems port check — ${namespace} (generic harness)</title>
  ${ICON_CDN[iconLibrary]}
${linkTags}
</head>
<!-- Generic fallback harness: no theme/verify-shell.html found, so this DOM
     does not mirror your live app's real structure or body classes. It still
     loads stylesheets in the correct cascade order (Block CSS -> OSUI ->
     Theme -> Screen), so it catches cascade/specificity bugs, but it will not
     catch anything that depends on the real live DOM shape. For full
     fidelity, author theme/verify-shell.html (see the generated README) with
     DOM sampled from your live app, then re-run flowmo block:build. -->
<body class="desktop">
${mountNames.map((n) => `  <div data-flowmo-mount="${n}"></div>`).join('\n')}
${scriptTags}
  <script>
${mountNames.map((n) => `    ${verifyMountCall(namespace, byName, n)}`).join('\n')}
  </script>
</body>
</html>
`;
  return { html, generic: true, mountNames, warnings: [] };
}

function buildReadme({ namespace, css, components, hasInteractions, verify, warnings }) {
  const pasteRows = css.filter((s) => s.paste).map((s) => `| \`dist/outsystems/${s.distRel}\` | ${s.dest} |`);
  const hasClassComponents = components.some((c) => c.kind === 'class');
  const componentRows = components.map((c) => {
    const cssFile = css.find((s) => s.distRel === `${c.componentName}/${c.componentName}.css`);
    return `| **${c.componentName}** | ${c.kind} | \`${c.componentName}/${c.componentName}.js\` → its own Script resource | ${cssFile ? `\`${c.componentName}/${c.componentName}.css\` → the Block's Style Sheet` : '_(no CSS)_'} |`;
  }).join('\n');

  return `# Porting ${namespace}'s components to OutSystems

Generated by \`flowmo block:build\`. This folder is gitignored — re-run rather than editing
anything here. Every generated file starts with a \`flowmo:build <hash> · <timestamp>\` comment —
compare it against what's pasted in Service Studio to spot drift (whoever paste-updates a Script
resource last silently wins over anyone else's changes; the banner is what lets you notice).

**The CSS is not transformed**, but unlike source it's no longer referenced in place either — every
stylesheet is copied into this folder so the whole paste payload is one self-contained folder (see
the components plan §1.3). Only the JavaScript needs bundling, because OutSystems can't host ES
modules.

## One folder per component — matches Service Studio's per-Block properties

| Component | Contract | Script resource | Style Sheet |
|---|---|---|---|
${componentRows}

Each component's folder holds only that component's files — working on \`${components[0]?.componentName ?? 'ComponentName'}\` never touches anyone else's generated files.

## Everything else — module-level, not owned by one Block

| Paste this file | Into |
|---|---|
| \`dist/outsystems/${namespace}-Shared.js\` | its own module **Script** resource — paste this one too, any order relative to the components above |
${hasInteractions ? `| \`dist/outsystems/${namespace}-Interactions.js\` | a second module **Script** resource — see the note below |\n` : ''}${pasteRows.join('\n')}

\`theme/outsystems-ui.css\` is **not** copied or pasted — it's already in every module. It's loaded
locally in \`verify.html\` (from source) only so this harness reproduces the platform's real
cascade order.

## Steps

1. **Add the Script resources.** ${namespace}-Shared.js, then each component's own \`<Name>.js\`.${hasInteractions ? ` Add
   \`${namespace}-Interactions.js\` too — it's a demo aid, not the final implementation: each
   interaction it drives (accordion, sortable table, expandable rows, …) should eventually become a
   real platform widget (Accordion, Table, Sidebar, If) wired to screen actions, at which point this
   file can be dropped.` : ''}
2. **Add the stylesheets** — the module Theme, each component's own Style Sheet, each Screen's own
   Style Sheet, in the table order above. A Block's stylesheet is bundled **module-wide**, not
   scoped to the block — see \`architectural-heuristics.md\` §1 for the real cascade order and why a
   Block CSS rule that merely ties an OSUI rule loses live.
3. **Build one Block per component.** Each Block holds a single **empty** Container with an
   \`id\` Extended Property bound to a block input parameter (not a literal — a literal breaks the
   moment the block is placed twice). Keep that container out of any \`If\`: OutSystems' renderer
   diffs what it drew, so an empty container survives re-renders; one wrapped in an \`If\` gets
   silently wiped.
4. **Render on OnReady.** One JavaScript node per Block — see each component's own \`<Name>.js\`
   header for its exact call. With no explicit props it uses the baked-in demo data, so the Block
   renders a real layout before any aggregate is wired up.${hasClassComponents ? `
5. **\`class\` contract components also need OnParametersChanged and OnDestroy wired** — see each
   such component's own \`<Name>.js\` header for its exact calls. This is what makes \`update()\`
   and \`destroy()\` actually run; skipping it means props changes are silently ignored and the DOM
   is never cleaned up when the Block is removed.` : ''}

## Verifying before you paste

\`dist/outsystems/verify.html\` ${verify.generic
    ? 'is a **generic fallback harness** — no `theme/verify-shell.html` was found, so this DOM does not mirror your live app\'s real structure or body classes. It still loads stylesheets in the correct cascade order, so it will catch cascade/specificity bugs, but not anything that depends on the real live DOM shape. For full fidelity: author `theme/verify-shell.html` with DOM sampled from your live app (mark mount points with `data-flowmo-mount="ComponentName"`, and include `<!-- flowmo:stylesheets -->` and `<!-- flowmo:scripts -->` placeholders), then re-run `flowmo block:build`.'
    : 'was generated from your `theme/verify-shell.html` — stylesheets and mount scripts were injected in the correct cascade order into the real DOM shape you captured from the live app.'}

${warnings.length ? `## Warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`;
}

export async function blockBuild() {
  const projectPath = process.cwd();
  const { namespace, iconLibrary } = readFlowmoConfig(projectPath);

  const components = discoverComponents(projectPath);
  if (components.length === 0) {
    console.log(picocolors.yellow('No components found under components/business/**/index.js — nothing to bundle.'));
    return;
  }

  const screens = discoverScreenStylesheets(projectPath);
  const sharedFiles = discoverSharedFiles(projectPath);
  const { built, warnings } = await buildComponents(namespace, components);

  if (built.length === 0) {
    console.log(picocolors.yellow('No component exported a "render" function or a "class ... extends Component" — nothing to bundle.'));
    for (const w of warnings) console.log(picocolors.dim(`  ${w}`));
    return;
  }

  const css = buildCssManifest(built, screens);
  const interactionsSrc = path.join(projectPath, 'scripts/prototype-interactions.js');
  const hasInteractions = fs.existsSync(interactionsSrc);

  const verify = buildVerifyHtml({ projectPath, namespace, iconLibrary, css, components: built, hasInteractions });
  warnings.push(...verify.warnings);

  const readme = buildReadme({ namespace, css, components: built, hasInteractions, verify, warnings });
  const sharedJs = buildSharedBundle(namespace, projectPath, sharedFiles);

  const outDir = path.join(projectPath, 'dist/outsystems');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');
  fs.writeFileSync(path.join(outDir, `${namespace}-Shared.js`), sharedJs);

  for (const c of built) {
    const dir = path.join(outDir, c.componentName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${c.componentName}.js`), c.js);
    if (c.cssFile) {
      const cssContent = fs.readFileSync(c.cssFile, 'utf-8');
      fs.writeFileSync(path.join(dir, `${c.componentName}.css`), versionBanner(cssContent) + cssContent);
    }
  }

  // theme.css and screen CSS — copy into dist alongside their version banner.
  const themeCss = css.find((s) => s.distRel === 'theme.css');
  if (themeCss) {
    const content = fs.readFileSync(path.join(projectPath, themeCss.sourceRel), 'utf-8');
    fs.writeFileSync(path.join(outDir, 'theme.css'), versionBanner(content) + content);
  }
  const screenEntries = css.filter((s) => s.distRel && s.distRel.startsWith('screens/'));
  if (screenEntries.length) fs.mkdirSync(path.join(outDir, 'screens'), { recursive: true });
  for (const s of screenEntries) {
    const content = fs.readFileSync(path.join(projectPath, s.sourceRel), 'utf-8');
    fs.writeFileSync(path.join(outDir, s.distRel), versionBanner(content) + content);
  }

  if (hasInteractions) {
    const content = fs.readFileSync(interactionsSrc, 'utf-8');
    fs.writeFileSync(path.join(outDir, `${namespace}-Interactions.js`), versionBanner(content) + content);
  }
  fs.writeFileSync(path.join(outDir, 'verify.html'), verify.html);
  fs.writeFileSync(path.join(outDir, 'README.md'), readme);

  console.log(picocolors.green(`✓ Built dist/outsystems/ for ${picocolors.bold(namespace)}`));
  console.log(picocolors.dim(`  ${namespace}-Shared.js`));
  for (const c of built) console.log(picocolors.dim(`  ${c.componentName}/${c.componentName}.js${c.cssFile ? ` + ${c.componentName}.css` : ''}  (${c.kind})`));
  if (hasInteractions) console.log(picocolors.dim(`  ${namespace}-Interactions.js`));
  console.log(picocolors.dim(`  verify.html          (${verify.generic ? 'generic fallback — see README' : 'from theme/verify-shell.html'})`));
  console.log(picocolors.dim(`  README.md`));
  if (warnings.length) {
    console.log();
    for (const w of warnings) console.log(picocolors.yellow(`  ⚠ ${w}`));
  }
}
