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

### `flowmo block:build`

Bundles `components/business/**/index.js` into a single non-module script OutSystems can host as
a Script resource, plus a cascade-accurate `verify.html` and a paste README, into
`dist/outsystems/` (gitignored — re-run rather than editing).

```bash
npx flowmo block:build
```

OutSystems can't host ES modules, so each component's `export function render(props)` is stripped
and wrapped in its own IIFE on `window.<Namespace>.render<ComponentName>`. CSS is never built —
`components/<name>/index.css` targets that component's Block Style Sheet, `theme/theme.css`
targets the module Theme, and `screens/<name>/index.css` targets that Screen's Style Sheet, so the
generated README just tells you what pastes where.

**Config** (optional, in `package.json`):
```json
{
  "flowmo": {
    "namespace": "EFM",
    "iconLibrary": "phosphor"
  }
}
```
`namespace` defaults to a PascalCase form of the package name; `iconLibrary` (`"font-awesome"` or
`"phosphor"`) is used only for the generic `verify.html` fallback's icon CDN link.

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
  <div data-flowmo-mount="JobNavRail"></div>
  <div data-flowmo-mount="JobContextCard"></div>
  <!-- one data-flowmo-mount="ComponentName" per Block you're verifying -->
  <!-- flowmo:scripts -->
</body>
</html>
```

**Interactions:** if `scripts/prototype-interactions.js` exists, it's copied to
`dist/outsystems/<Namespace>-interactions.js` and wired in as a second Script resource — a demo
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
