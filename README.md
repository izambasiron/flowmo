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

Flowmo is built for **vibe coding**. Because ODC restricts direct database access, agents use local Flowmo projects to iterate safely:

1. **AI Generation**: Ask your AI assistant to generate a PostgreSQL `CREATE TABLE` and some seed data based on your ODC data model.
2. **Instant Validation**: The agent runs `npx flowmo db:setup` and `db:seed` to provision the local PGLite database.
3. **Query Verification**: The agent then executes `npx flowmo db:query` against `.advance.sql` files to double-check their logic.
4. **Platform Sync**: Once the "vibe" is correct locally, you can confidently recreate the entities and queries in OutSystems Service Studio.

The Flowmo Agent Skills (scaffolded by `create-flowmo`) ensure your AI assistant follows OutSystems performance and syntax rules throughout this process.

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
