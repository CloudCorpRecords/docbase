# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- MCP server with 22 MongoDB tools: `connect`, `list-databases`,
  `list-collections`, `collection-schema`, `collection-indexes`,
  `collection-storage-size`, `find`, `aggregate`, `count`,
  `insert-many`, `update-many`, `delete-many`, `create-collection`,
  `drop-collection`, `drop-database`, `rename-collection`,
  `create-index`, `drop-index`, `explain`, `export`, `db-stats`, and
  `mongodb-logs`.
- CLI: `docbase call <tool> [json-args]` runs one tool and prints its
  result as JSON; `docbase mcp [connection-string]` starts the stdio
  MCP server. The connection string can also come from
  `MDB_MCP_CONNECTION_STRING`.
- Core maps every tool call to a MongoDB command document
  (`{find: ...}`, `{aggregate: ...}`, `{createIndexes: ...}`, ...) and
  runs it through an injectable executor; the default executor shells
  out to `mongosh` with `db.runCommand`. No MongoDB driver is bundled.
- `collection-schema` infers field types from a 25-document sample;
  `mongodb-logs` reads the `getLog` command and applies the requested
  limit client-side.
