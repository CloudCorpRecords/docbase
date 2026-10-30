# docbase

docbase gives an agent — or you, at a terminal — a complete set of
MongoDB database tools: browse databases and collections, run find
queries and aggregation pipelines, insert, update, and delete
documents, manage indexes and collections, read database statistics
and server logs, and ask the server to explain a query plan.

There is no bundled MongoDB driver. Every tool call is first mapped to
a plain MongoDB command document (`{ find: ... }`, `{ aggregate: ... }`,
`{ createIndexes: ... }`), and the default executor runs that document
through the `mongosh` command-line client with
`db.runCommand(...)`. A machine that wants live answers therefore needs
`mongosh` on its `PATH` and a reachable MongoDB instance. Without
either, the server still starts and lists its tools; only the call
itself reports the problem, in plain language.

## Install

```bash
npx @reneturcios/docbase call list-databases
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/docbase
```

The container defaults to the MCP server (see below). Note the stock
image bundles no `mongosh` binary, so containerised live queries need
a `mongosh` provided on the host or mounted into the image.

## CLI

```bash
# Run one tool; the JSON-args argument is optional for no-arg tools
docbase call list-databases
docbase call find '{"database":"shop","collection":"users","filter":{"active":true},"limit":5}'
docbase call db-stats '{"database":"shop"}'

# Start the MCP server (connection string optional, see below)
docbase mcp mongodb://alice@localhost:27017/shop

docbase --version
```

Exit codes: `0` on success, `1` when the tool call, the connection, or
`mongosh` itself fails (the error says which), `2` for usage errors.

The connection string is a normal MongoDB URL (`mongodb://` or
`mongodb+srv://`). For both `mcp` and `call` it can be left off the
command line and supplied through the `MDB_MCP_CONNECTION_STRING`
environment variable. The `connect` tool also accepts a
`connectionString` argument, which is validated and used for that
call's ping.

## How a call flows

1. Arguments are validated (required database/collection names,
   object-shaped filters, non-empty document arrays, and so on).
   Invalid calls fail before anything reaches an executor.
2. The call is mapped to its command document — for example
   `update-many` becomes
   `{ update: <collection>, updates: [{ q: filter, u: update, multi: true }] }`.
3. The executor runs the document. Three tools post-process the reply:
   `collection-schema` samples 25 documents (`$sample`) and infers a
   field-to-types map from them; `mongodb-logs` runs `getLog` and
   applies the requested `limit` to the returned lines; `export` runs
   a find and returns the matching documents under the requested
   export title.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/docbase mcp mongodb://alice@localhost:27017/shop
```

MCP client configuration:

```json
{
  "mcpServers": {
    "docbase": {
      "command": "npx",
      "args": ["-y", "@reneturcios/docbase", "mcp"],
      "env": { "MDB_MCP_CONNECTION_STRING": "mongodb://alice@localhost:27017/shop" }
    }
  }
}
```

### Tools

| Tool | Required | Optional | What it does |
| --- | --- | --- | --- |
| `connect` | — | `connectionString` | Ping the instance (validates a supplied connection string) |
| `list-databases` | — | — | List all databases (`listDatabases`) |
| `list-collections` | `database` | — | List a database's collections |
| `collection-schema` | `database`, `collection` | — | Infer field types from a 25-document sample |
| `collection-indexes` | `database`, `collection` | — | List a collection's indexes |
| `collection-storage-size` | `database`, `collection` | — | Collection storage statistics (`collStats`) |
| `find` | `database`, `collection` | `filter`, `projection`, `limit`, `sort` | Run a find query |
| `aggregate` | `database`, `collection`, `pipeline` | — | Run an aggregation pipeline |
| `count` | `database`, `collection` | `query` | Count matching documents |
| `insert-many` | `database`, `collection`, `documents` | — | Insert documents (ordered) |
| `update-many` | `database`, `collection`, `filter`, `update` | — | Update all matching documents |
| `delete-many` | `database`, `collection`, `filter` | — | Delete all matching documents |
| `create-collection` | `database`, `collection` | — | Create a collection |
| `drop-collection` | `database`, `collection` | — | Drop a collection |
| `drop-database` | `database` | — | Drop a database |
| `rename-collection` | `database`, `collection`, `newName` | — | Rename a collection (same database) |
| `create-index` | `database`, `collection`, `keys` | — | Create an index; the name is derived from the keys |
| `drop-index` | `database`, `collection`, `indexName` | — | Drop an index by name |
| `explain` | `database`, `collection` | `method`, `methodArgs` | Explain a query plan (`queryPlanner` verbosity) |
| `export` | `database`, `collection` | `exportTitle`, `filter` | Return matching documents under an export title |
| `db-stats` | `database` | — | Database statistics (`dbStats`) |
| `mongodb-logs` | — | `limit`, `type` | Read server log lines (`getLog`, default `global`) |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network, no live database
npm run dev     # run the CLI from source via tsx
```

All command construction, validation, schema inference, and log
limiting are covered by tests that drive the core through a fake
executor — no MongoDB server and no `mongosh` binary are needed to run
the suite.

## License

MIT — see `LICENSE`.
