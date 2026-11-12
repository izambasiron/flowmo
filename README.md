# flowmo

A lightning-fast, zero-infrastructure SQL engine for AI-assisted OutSystems prototyping.

Flowmo gives AI agents a local offline environment to generate and validate Advanced SQL queries in milliseconds — acting as a safe sandbox before anything touches an OutSystems environment.

Powered by [PGLite](https://pglite.dev/) (WASM PostgreSQL) — no containers, no servers, no cloud dependencies.

## Quick Start

Scaffold a new project with [`create-flowmo`](https://www.npmjs.com/package/create-flowmo), then install `flowmo` inside it:

```bash
npx create-flowmo
```

You'll be prompted for a project name, target platform, and app type. Then:

```bash
cd my-prototype
npm install
```

The generated project already has `flowmo` listed as a dependency and the `database/` folder pre-configured.

## Commands

### `flowmo db:setup`

Reads `database/schema.sql`, drops the existing schema, and provisions the local database from scratch.

```bash
npx flowmo db:setup
```

Run this any time you change your schema.

### `flowmo db:seed [file …]`

Inserts seed data into the local database. Accepts an optional list of seed files to run in order.

```bash
# Auto-discover: loads database/seeds/ directory (alphabetical) or falls back to database/seeds.sql
npx flowmo db:seed

# Explicit list — executed in the order given
npx flowmo db:seed database/seeds/01_users.sql database/seeds/02_products.sql
```

**Seed file resolution (no args):**
1. `database/seeds/` directory exists → all `.sql` files, alphabetical order
2. `database/seeds.sql` → single file fallback

Prefix files with numbers (`01_`, `02_`) to control load order when using the directory.

### `flowmo db:reset [--seed [file …]]`

Drops and recreates the schema (equivalent to `db:setup`), then optionally seeds.

```bash
# Recreate schema only
npx flowmo db:reset

# Recreate schema + auto-discover seeds
npx flowmo db:reset --seed

# Recreate schema + explicit seed list
npx flowmo db:reset --seed database/seeds/01_users.sql database/seeds/02_products.sql
```

The `--seed` flag follows the same resolution rules as `db:seed` — files after `--seed` are used as-is; no files after `--seed` triggers auto-discovery.

### `flowmo db:query <file|sql> [params-json]`

Executes a `.sql` or `.advance.sql` file against the local database and prints results as an ASCII table. Alternatively, pass an inline SQL string directly — no file needed.

**Inline SQL:**
```bash
npx flowmo db:query "SELECT * FROM users"
npx flowmo db:query "SELECT COUNT(*) FROM orders WHERE is_active = 1"
```

Inline mode is param-free. For parameterised queries, use a file.

**Standard SQL:**
```bash
npx flowmo db:query database/queries/get_users.sql
```

**OutSystems Advanced SQL** (`.advance.sql`) with parameters:
```bash
npx flowmo db:query database/queries/get_user.advance.sql '{"UserId": 1, "Status": true}'
```

The Advanced SQL parser handles OutSystems syntax automatically:

| OutSystems syntax | Translated to |
|---|---|
| `{Entity}.[Attribute]` | `entity.attribute` |
| `{Entity}` | `entity` |
| `@ParamName` | `$1`, `$2`, … |

**Example `.advance.sql`:**
```sql
SELECT {Users}.[Name], {Users}.[Email]
FROM {Users}
WHERE {Users}.[Id] = @UserId AND {Users}.[IsActive] = @Status
```

**Output:**
```
┌─────────┬──────────────────┐
│ Name    │ Email            │
├─────────┼──────────────────┤
│ Izam B. │ izam@example.com │
└─────────┴──────────────────┘
(1 row)
```

### `flowmo screen:create <dir-name>`

Scaffolds a new screen: `index.visual.html` (wired to the layout component of your choice),
`queries.js`, `index.test.js`, `README.md`, and a `mockups/` folder.

```bash
npx flowmo screen:create project-detail --layout side --ticket PROJ-354 --title "Project Detail"
```

| Flag | Default | |
|---|---|---|
| `--layout` | `top` | `top`, `side`, `base`, or `blank` |
| `--ticket` | _(none)_ | reference shown in the generated README |
| `--title` | derived from `<dir-name>` | display title |
| `--module` | _(none)_ | OutSystems module name, shown in the generated README |
| `--force` | off | overwrite an existing `screens/<dir-name>/` |

The scaffolded `<head>` links the icon CDN from `{ "flowmo": { "iconLibrary" } }` in `package.json`
(`"font-awesome"`, the default, or `"phosphor"`) — set once via `create-flowmo`'s scaffold prompt,
or by hand in an existing project, instead of swapping the link after every new screen.

### `flowmo block:build`

Bundles each component under `components/business/**` into its **own** paste-ready folder —
`dist/outsystems/<ComponentName>/<ComponentName>.js` + `.css` — plus a shared
`<Namespace>-Shared.js`, a cascade-accurate `verify.html`, and a paste README, into
`dist/outsystems/` (gitignored — re-run rather than editing).

```bash
npx flowmo block:build
```

OutSystems can't host ES modules, so each component gets its `export` stripped and wrapped in its
own IIFE. One folder per component, not one shared bundle: Service Studio doesn't diff or merge a
pasted Script resource, so keeping each component in its own file means two developers working on
different components never touch the same generated file. CSS isn't transformed, but it **is**
copied into `dist/outsystems/` (each component's own `<Name>.css`, `theme.css`, each screen's own
CSS under `screens/`) so the whole paste payload is one self-contained folder — the generated
README tells you what pastes where. Every generated file starts with a `flowmo:build <hash> ·
<timestamp>` drift-detection banner.

**Two component contracts, both supported:**

- **`class` (recommended for new components)** — `export class Name extends Component` (import
  `Component` from `components/shared/Component.js`, which ships in every scaffold). One contract,
  two levels of ceremony: override just `render()` for a presentational component, or also
  `validate()`/`attachEvents()`/`update()` for an interactive one — validation, events, and
  interaction state all live in the component; OutSystems just receives clean events. See
  `create-flowmo`'s `outsystems-ui` skill, `references/business-components.md`, for the full
  contract, the state-preservation rule, and the exact `OnReady`/`OnParametersChanged`/`OnDestroy`
  mapping (a `window.<Namespace>.instances` registry, not a Block Local Variable — there's no
  `$block` object a JS node can use for that, confirmed against a live ODC app).
- **`function` (legacy)** — `export function render(props)`, unchanged from earlier releases.
  Still fully supported so existing components don't need to migrate all at once; not the
  recommended shape for new components.

`block:build` detects which contract each component uses and bundles/documents it accordingly —
a project can mix both during a migration. The console output and generated README both show each
component's contract.

**Config** (optional, in `package.json`):
```json
{
  "flowmo": {
    "namespace": "Bistro",
    "iconLibrary": "phosphor"
  }
}
```
`namespace` defaults to a PascalCase form of the package name; `iconLibrary` (`"font-awesome"` or
`"phosphor"`) is used only for the generic `verify.html` fallback's icon CDN link.

**Shared code:** anything under `components/shared/*.js` (besides `Component.js`, which is special
— see below) bundles once into `<Namespace>-Shared.js`, exposed as `window.<Namespace>.Shared.*`. A
component imports it the normal way — `import { esc } from '../../shared/esc.js';` — and
`block:build` rewrites that import to a global reference in the bundled output; local dev keeps the
real ES import. `Component` itself is exposed directly as `window.<Namespace>.Component`, not
nested under `.Shared` — `class X extends Component` evaluates at parse time, so
`<Namespace>-Shared.js` must be attached above every component's Script resource, and
`block:build` always emits it as the one Script resource every component depends on.

Shared files may import each other with a relative named import (`import { esc } from
'./esc.js';`): they're concatenated into one scope, so `block:build` drops those imports and emits
each file after the files it imports. Any other import in a shared file stops the build. In a
component, an import that isn't a named import from `components/shared/`, an `export default`, or
a folder named `shared` or `component` (which would overwrite `window.<Namespace>.Shared` /
`.Component`) is reported and that component is skipped. A `flowmo.namespace` that isn't a valid
JavaScript identifier stops the build.

Two shared files that import each other are bundled anyway, with a warning: a function used across
the cycle works, but a class the other file uses while loading (`extends`, a static field) fails if
it's defined later, as it would with real ES modules.

`block:build` reads imports and exports line by line, not with a JavaScript parser. Inside a
multi-line string (a template literal), don't start a line with `import` or `export`: it would be
treated as a real import or export, and could be removed from the string or stop the build.

**Demo data:** add `components/business/<name>/demo.js` (default export) so a Block can render a
real layout before any aggregate is wired up. Without it, that component's demo data is `{}`.

**`verify.html` fidelity:** if `theme/verify-shell.html` exists — a hand-authored file with the
real DOM/body-classes sampled from your live app, elements marked `data-flowmo-mount="Name"`, and
`<!-- flowmo:stylesheets -->` / `<!-- flowmo:scripts -->` placeholders — `block:build` injects the
correctly-ordered stylesheets and mount script into it, and warns (without failing) if a mount
name doesn't match any built component, or if a built component isn't mounted anywhere in the
shell — a component the shell forgot to mount would otherwise never be exercised by `verify.html`
at all, silently. Without a shell, it falls back to a generic minimal harness: still loads Block
CSS → `outsystems-ui.css` → Theme → Screen in the real cascade order (see `outsystems-ui`'s
`architectural-heuristics.md` in `create-flowmo`), so it still catches cascade/specificity bugs,
but it won't catch anything that depends on the real live DOM shape.

To get full fidelity, capture your live app's real DOM (view-source or your browser devtools) into
`theme/verify-shell.html`, e.g.:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <!-- your live app's real fonts/icon-library <link>s go here -->
  <!-- flowmo:stylesheets -->
</head>
<!-- copy the real body classes and DOM structure from your live app here -->
<body class="desktop landscape osx chrome">
  <div data-flowmo-mount="OrderRail"></div>
  <div data-flowmo-mount="MenuCard"></div>
  <!-- one data-flowmo-mount="ComponentName" per Block you're verifying -->
  <!-- flowmo:scripts -->
</body>
</html>
```

**Interactions:** if `scripts/prototype-interactions.js` exists, it's copied to
`dist/outsystems/<Namespace>-Interactions.js` and wired in as a second Script resource — a demo
aid, not the final implementation. Each interaction it drives should eventually become a real
platform widget.

## Project Structure

A scaffolded Flowmo project looks like this:

```
my-prototype/
├── database/
│   ├── schema.sql          # DDL — your single source of truth
│   ├── seeds.sql           # Dummy data (single file)
│   ├── seeds/              # OR: split seeds by table (01_users.sql, 02_products.sql …)
│   └── queries/            # .sql and .advance.sql files
├── logic/                  # .flowchart.md server action flows
├── screens/                # .visual.html UI prototypes
├── theme/                  # OutSystems UI CSS
└── .flowmo/                # Local database (auto-generated, gitignored)
    └── database/
```

## The Agentic Bridge (ODC to Flowmo)

Flowmo is built for **vibe coding**. Local iteration gives you a tight feedback loop — no deployments, no cloud round-trips, no risk to your real data. Agents use local Flowmo projects to move fast:

1. **Get the schema**: The Flowmo Forge component ([ODC](https://www.outsystems.com/forge/component-overview/24452/flowmo-odc) · [O11](https://www.outsystems.com/forge/component-overview/24446/flowmo-o11)) includes a **Schema Builder** that generates a PostgreSQL `CREATE TABLE` script from your live OutSystems entities. Copy and paste the output into your `database/schema.sql` as your starting point.
2. **AI Generation**: Ask your AI assistant to extend the schema or generate seed data based on your app's data model.
3. **Instant Validation**: The agent runs `npx flowmo db:setup` and `db:seed` to provision the local PGLite database.
4. **Query Verification**: The agent then executes `npx flowmo db:query` against `.advance.sql` files to double-check their logic.
5. **Platform Sync**: Once the "vibe" is correct locally, you can confidently recreate the entities and queries in OutSystems Service Studio.

The Flowmo Agent Skills (scaffolded by `create-flowmo`) ensure your AI assistant follows OutSystems performance and syntax rules throughout this process.

### Optional: driving the bridge with the OutSystems MCP

The OutSystems MCP is early access — not GA, and not every ODC tenant has it yet. If your AI assistant has a live connection to it this session, steps 1 and 5 above can be automated instead of done by hand:

1. **Pull the schema**: Ask your agent to call `context_entities` (`app: "<App>"`, `owned_only: false` — to pull in the full FK dependency closure) and pipe the merged result into `flowmo schema:pull` — this writes `database/schema.os.sql` and reports any foreign keys it couldn't resolve.
2. **AI Generation → Instant Validation → Query Verification**: same as steps 2–4 above, working against `schema.local.sql` for anything not yet in OutSystems.
3. **Platform Sync**: run `flowmo mentor:prompt` to turn the validated `schema.local.sql`/`.advance.sql` files into a ready-to-review prompt, and hand it to `mentor_start` instead of retyping into Service Studio.
4. **Confirm it landed**: don't trust the publish confirmation alone — re-pull `context_entities` and run `flowmo schema:verify` against the fresh JSON to confirm each entity is `confirmed`, `missing`, or has an `attribute mismatch`. This checks one direction only — that everything in `schema.local.sql` landed remotely, not whether OutSystems has extra columns you didn't ask for.

This is a parallel path, not a replacement — the Forge-component workflow above always works, with or without MCP access.

## VS Code Ecosystem

Flowmo CLI works alongside the Flowmo VS Code extensions:

- **[Flowmo Visual Inspector](https://marketplace.visualstudio.com/items?itemName=flowmo.flowmo-visual-inspector)** — Live layer panel and element inspector for `.visual.html` screens.
- **[Flowmo Flowchart Editor](https://marketplace.visualstudio.com/items?itemName=flowmo.flowmo-flowchart-editor)** — Drag-and-drop node editor for `.flowchart.md` server action flows.
- **[PGlite Explorer](https://marketplace.visualstudio.com/search?term=pglite&target=VSCode)** (third-party) — Browse your `.flowmo/database` tables and run queries directly in VS Code.

Install the Visual Inspector and Flowchart Editor together with the **[Flowmo Extension Pack](https://marketplace.visualstudio.com/items?itemName=flowmo.flowmo-extension-pack)**.

## Links and Support

- Web: [flowmo.lol](https://flowmo.lol)
- Issues: [GitHub Issues](https://github.com/izambasiron/flowmo/issues)
- Email: [support@flowmo.lol](mailto:support@flowmo.lol)
- Support model: best-effort, no response-time guarantee

## License

MIT
