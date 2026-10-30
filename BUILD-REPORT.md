# docbase — Build Report

MCP Rebuild 100. Clean-room rebuild of the "mongodb" MCP server
(mongodb-js/mongodb-mcp-server), built from the public tool spec in
`harness/fixtures/mongodb-tools-original.json` only. The fixture was
created for this build: it is docs-derived from the public tool
listings (Docker MCP Catalog / Glama) for the original server — tool
names, short public descriptions, parameter types, and required sets —
marked `"_source": docs-derived ... not hand-probed`. Local build
only — nothing pushed or published.

Identity: repo `docbase`, npm `@reneturcios/docbase`,
MCP name `io.github.CloudCorpRecords/docbase`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `docbase: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "MongoDB tools: query, aggregate, index,
  and administer collections and databases." = **81 chars** (≤100 ✓);
  npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/docbase:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT `node /app/dist/cli.js`,
  CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/docbase"`
- `tsconfig.json` (byte-identical to the fleet template, 318 bytes),
  `.gitignore`, `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios),
  `README.md` (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`mcp [connection-string]`,
  `call <tool> [json-args]`, `--version`; exit 2 usage / 1 call error),
  `src/mcp.ts`, `src/types.ts`, `src/mongo.ts` (core logic,
  `VERSION = "0.1.0"`)
- `test/mongo.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to docbase)

## Implementation notes

- All 22 spec tools, exactly as spec'd, served with explicit
  inputSchema literals — including `explain` with optional
  `method` (array) / `methodArgs` (object) and `find` with
  `filter` / `projection` / `limit` / `sort`. No per-property
  descriptions, no extra keys.
- **Low-level Server API, with reason:** `src/mcp.ts` registers the
  tools via `Server` from `@modelcontextprotocol/sdk/server/index.js`
  with explicit inputSchema literals, not McpServer+zod — the
  high-level path injects `$schema` / `additionalProperties` and caps
  parity at 50% (standing rule from Wave 1). Zod still validates every
  `tools/call` argument set internally.
- Core (`src/mongo.ts`): `buildCommand(toolName, args)` validates the
  arguments (required non-empty strings, plain-object filters/keys,
  non-empty document arrays of objects, object pipeline stages,
  positive limits, mongodb:// or mongodb+srv:// connection strings)
  and maps each tool to a genuine MongoDB command document —
  `{find: ...}`, `{aggregate: ..., cursor: {}}`,
  `{insert: ..., ordered: true}`,
  `{update: ..., updates: [{q, u, multi: true, upsert: false}]}`,
  `{delete: ..., deletes: [{q, limit: 0}]}`,
  `{createIndexes: ..., indexes: [{key, name}]}` with the index name
  derived from the keys (`{name: 1, age: -1}` -> `name_1_age_-1`),
  `{renameCollection: "db.coll", to: "db.new", dropTarget: false}`
  run against `admin`, `{getLog: ...}`, `{collStats: ...}`,
  `{dbStats: 1}`, `{listDatabases: 1}`, `{ping: 1}`, and the rest.
  The mapping is pure and fully unit-tested.
- Injectable executor: `MongoExecutor.execute(toolName, database,
  command, options?)`. `DocBase.callTool` validates + builds first,
  then dispatches; fake-executor tests cover all 22 dispatches, the
  built command for each, error propagation, and the no-executor path.
- Post-processing, where a bare command reply is not the tool's
  answer: `collection-schema` samples 25 documents
  (`{aggregate, pipeline: [{$sample: {size: 25}}]}`) and infers a
  top-level field -> types map (`inferSchema`); `mongodb-logs` applies
  its `limit` to the `getLog` reply's lines; `export` runs a find and
  returns the matching documents under the export title.
- Default executor (`MongoshExecutor`): no MongoDB driver is bundled.
  It runs `execFile("mongosh", [conn, "--quiet", "--eval", script])`
  where the script is
  `JSON.stringify(db.getSiblingDB(<db>).runCommand(<command>))` with
  the database and command embedded via JSON.stringify (no raw
  interpolation). The connection string comes from the `mcp`/`call`
  argument or `MDB_MCP_CONNECTION_STRING`; the `connect` tool's own
  `connectionString` argument is validated and passed through as a
  per-call override. A missing `mongosh` (ENOENT) and a missing
  connection string both surface as clear `isError` text results —
  data is never faked. Verified live below.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced (cli.js with `#!/usr/bin/env node` shebang, mongo.js,
mcp.js, index.js, types.js, plus .d.ts/.js.map).

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 48
ℹ pass 48
ℹ fail 0
```
Covers: the command-document mapping for all 22 tools (a case table
asserting target database + deep-equal command per tool, plus proof
the case table covers exactly the 22 spec tools), connect's
connection-string override, validation rejections (missing/empty
required strings, array-as-filter, missing update document, empty
documents, non-object document, non-object pipeline stage, empty
index keys, negative limit, non-MongoDB connection string, unknown
tool), DocBase dispatch of all 22 tools through a fake executor with
pass-through replies, executor error propagation, no-executor error
(after validation), schema inference from a fake cursor reply,
extractDocs shapes, log limiting, export wrapping (explicit and
default title), index-name derivation, eval-script construction,
mongosh-output parsing, and connection-string resolution precedence.

### 3. MCP + CLI smoke (live, this VM)
```
initialize -> serverInfo: {"name":"docbase","version":"0.1.0"}
tools/list -> exactly the 22 spec tools with spec-identical schemas (see parity)
tools/call list-databases with NO connection configured ->
  isError: "No MongoDB connection configured: pass a mongodb://
  connection string to `docbase mcp`, set MDB_MCP_CONNECTION_STRING,
  or pass connectionString to the connect tool."
tools/call find with mongodb://localhost:27017/shop ->
  isError: "mongosh executable not found: the `mongosh` command-line
  client is not installed or not on PATH, so docbase cannot run the
  command. Install MongoDB Shell and retry. (spawn mongosh ENOENT)"
CLI: --version -> 0.1.0 (exit 0); no args -> Usage (exit 2);
  call find '{"database":"shop","collection":"users"}' with no
  connection configured -> same no-connection error (exit 1)
mongosh availability check in this VM: `which mongosh` -> not found (exit 1)
```

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/mongodb-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/docbase/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/docbase/parity-out
verdict=PASS parity_pct=100.0 original_tools=22 rebuild_tools=22 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
`parity-out/parity.json` on disk confirms: verdict PASS,
parity_pct 100.0, identical_tools 22, schema_diffs {}.
`fixture_results: SKIPPED-TOOLS-FILE-MODE` — expected harness
semantics for a tools-file original, not an error.

## Lockfile status

`package-lock.json` was copied from pgport with identity fields
edited; clean lockfile regen required before publish. Edited fields
(verified on disk): top-level `name`, root package `name`, and root
package `bin` key pgport -> docbase (dependencies are identical
ranges, so the tree is unchanged). Per the fleet lesson in
TEMPLATE.md §2 item 6, a lockfile must be generated clean (no
`node_modules` present) before first publish — **clean regeneration
is deferred to the publish wave**; do not publish from this lockfile
as-is. `node_modules` in this build dir is a `cp -a` copy of pgport's
(byte-identical, verified with `diff -rq`; local build only,
gitignored).

## Blockers / honest gaps

- **No live MongoDB / no mongosh in this VM:** `mongosh` is not
  installed (`which mongosh` exit 1; executor path reports
  `spawn mongosh ENOENT`) and no MongoDB server exists here, so the
  mongosh executor's happy path — a real command returning a real
  reply — could not be exercised. Its script construction and output
  parsing are unit-tested, and its failure paths are verified live
  above.
- **Behaviour parity unproven:** parity claimed here is tool/schema
  parity only (22/22 tools, 100.0%), per the ground-truth fixture's own
  `_source` note. The fixture is docs-derived from public listings,
  not hand-probed against a live original. Behaviour against a live
  MongoDB is NOT claimed.
- **Simplifications, stated plainly:** `collection-schema` infers
  top-level field types from a 25-document `$sample` (the original
  samples and infers with its own internal logic; nested-path detail
  may differ). `export` returns the matching documents under the
  export title in the tool reply rather than materialising a
  downloadable file resource. `mongodb-logs`' `type` selects the
  `getLog` component (default `global`); arbitrary component names a
  server does not know will error server-side.
- Container gap (same class as pgport/repoport): the node:20-alpine
  runtime image bundles no `mongosh` binary, so containerised docbase
  cannot run live commands unless mongosh is provided; the workflow
  smoke covers initialize/usage only. Container build not exercised
  locally.
- Build-environment note: the VM's intermittent exec write guard
  (EPERM) zeroed an earlier scaffold copy and blocked `tsc` emit for
  ~40 minutes mid-build; all artifacts were re-copied/rebuilt and
  re-verified byte-for-byte after the guard lifted. Final state above
  is post-recovery and fully verified.
- mcpaudit / mcpvet / shipcheck pre-publish gate not run — that
  belongs to the publish wave, not claimed here.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and the
standing Wave 2 remediation pattern applied to later waves, and
`publish/GATE-POLICY.md`. This is an authorized deviation from the
parity-faithful state: descriptions were added to every tool parameter
that lacked one, in the `src/mcp.ts` schema literals only —
parameter names, types, required lists and enums are unchanged.
There are no shared schema consts for the served tools in this unit,
so every insertion point serves exactly one parameter occurrence.
The standing schema-only parity gap (no live MongoDB in the VM) is
unchanged.

- Descriptions added: 55 insertion points, covering all 55 served
  parameter occurrences across 21 of the 22 tools (the remaining
  tool, `list-databases`, has no parameters).
- Rebuild: `npm run build` (tsc) exit 0; `tsc --noEmit` exit 0; full
  test suite 48/48 pass.
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 52.3** — all
  55 schema diffs are description additions
  (`*.description: present in rebuild but not in original`; 0
  structural diffs), across 21 schema-differing tools, with the 1
  no-parameter tool identical. Structural parity proven
  independently: stripping `description` keys from both the
  post-remediation tools/list and the pre-remediation tools/list
  deep-equals (strip-both-equal: true; pre-descriptions 22,
  post-descriptions 77, added-descriptions 55, changed-descriptions
  0, removed-descriptions 0, non-property-additions 0, EQUAL: True).
  Adjudication: the description-only diffs are the authorized
  remediation itself; structural parity is unchanged. Full record:
  `publish/parity-remediation/docbase/parity.json` and
  `publish/parity-remediation/docbase/strip-proof.txt`.
- Re-gate: not run in this remediation pass — that belongs to the
  publish gate lane, not claimed here.
