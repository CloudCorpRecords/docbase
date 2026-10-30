/**
 * docbase core: argument validation, mapping of the 22 public tools to
 * MongoDB command documents, schema inference from sampled documents,
 * log limiting, and a `mongosh` subprocess executor.
 *
 * No MongoDB driver is bundled. The default executor runs the command
 * document through the `mongosh` command-line client with
 * `db.getSiblingDB(<db>).runCommand(<command>)`, mirroring pgport's
 * psql pattern: when `mongosh` is missing or no connection string is
 * configured, calls fail with a plain error that says so — docbase
 * never invents results.
 */
import { execFile } from "node:child_process";
import type { BuiltCommand, MongoExecutor } from "./types.js";

export const VERSION = "0.1.0";

export const NO_EXECUTOR_MESSAGE =
  "No MongoDB connection configured: docbase has no command executor. " +
  "Inject an executor, or use the default mongosh executor with a connection string.";

export const NO_CONNECTION_MESSAGE =
  "No MongoDB connection configured: pass a mongodb:// connection string to " +
  "`docbase mcp`, set MDB_MCP_CONNECTION_STRING, or pass connectionString to the connect tool.";

export const TOOL_NAMES = [
  "connect",
  "list-databases",
  "list-collections",
  "collection-schema",
  "collection-indexes",
  "collection-storage-size",
  "find",
  "aggregate",
  "count",
  "insert-many",
  "update-many",
  "delete-many",
  "create-collection",
  "drop-collection",
  "drop-database",
  "rename-collection",
  "create-index",
  "drop-index",
  "explain",
  "export",
  "db-stats",
  "mongodb-logs",
] as const;

// ---------------------------------------------------------------------------
// Argument validation helpers
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reqString(args: Record<string, unknown>, key: string, tool: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${tool}: '${key}' is required and must be a non-empty string`);
  }
  return value;
}

function optString(args: Record<string, unknown>, key: string, tool: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${tool}: '${key}' must be a non-empty string when provided`);
  }
  return value;
}

function reqObject(args: Record<string, unknown>, key: string, tool: string): Record<string, unknown> {
  const value = args[key];
  if (!isPlainObject(value)) {
    throw new Error(`${tool}: '${key}' is required and must be an object`);
  }
  return value;
}

function optObject(args: Record<string, unknown>, key: string, tool: string): Record<string, unknown> | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`${tool}: '${key}' must be an object when provided`);
  }
  return value;
}

function reqArray(args: Record<string, unknown>, key: string, tool: string): unknown[] {
  const value = args[key];
  if (!Array.isArray(value)) {
    throw new Error(`${tool}: '${key}' is required and must be an array`);
  }
  return value;
}

function optArray(args: Record<string, unknown>, key: string, tool: string): unknown[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${tool}: '${key}' must be an array when provided`);
  }
  return value;
}

function optPositiveInt(args: Record<string, unknown>, key: string, tool: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${tool}: '${key}' must be a positive number when provided`);
  }
  return Math.floor(value);
}

function checkConnectionString(value: string, tool: string): string {
  if (!value.startsWith("mongodb://") && !value.startsWith("mongodb+srv://")) {
    throw new Error(
      `${tool}: 'connectionString' must start with mongodb:// or mongodb+srv://`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Index-name derivation for create-index
// ---------------------------------------------------------------------------

/**
 * Derive the conventional index name from a keys document:
 * `{ name: 1, age: -1, bio: "text" }` becomes `name_1_age_-1_bio_text`.
 */
export function indexNameFromKeys(keys: Record<string, unknown>): string {
  return Object.entries(keys)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join("_");
}

// ---------------------------------------------------------------------------
// Tool -> command mapping
// ---------------------------------------------------------------------------

/**
 * Validate one tool call's arguments and map it to the MongoDB command
 * document that performs it. Pure: no I/O, so the whole mapping surface
 * is unit-testable. Server-level commands (ping, listDatabases, getLog,
 * renameCollection) run against the `admin` database; everything else
 * runs against the caller's `database`.
 */
export function buildCommand(toolName: string, args: Record<string, unknown>): BuiltCommand {
  const a = args ?? {};
  switch (toolName) {
    case "connect": {
      const connectionString = optString(a, "connectionString", toolName);
      if (connectionString !== undefined) checkConnectionString(connectionString, toolName);
      const built: BuiltCommand = { database: "admin", command: { ping: 1 } };
      if (connectionString !== undefined) built.connectionString = connectionString;
      return built;
    }
    case "list-databases":
      return { database: "admin", command: { listDatabases: 1 } };
    case "list-collections": {
      const database = reqString(a, "database", toolName);
      return { database, command: { listCollections: 1 } };
    }
    case "collection-schema": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      // Schema is inferred client-side from a random sample of documents.
      return {
        database,
        command: { aggregate: collection, pipeline: [{ $sample: { size: 25 } }], cursor: {} },
      };
    }
    case "collection-indexes": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      return { database, command: { listIndexes: collection, cursor: {} } };
    }
    case "collection-storage-size": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      return { database, command: { collStats: collection, scale: 1 } };
    }
    case "find": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const command: Record<string, unknown> = {
        find: collection,
        filter: optObject(a, "filter", toolName) ?? {},
      };
      const projection = optObject(a, "projection", toolName);
      if (projection !== undefined) command.projection = projection;
      const sort = optObject(a, "sort", toolName);
      if (sort !== undefined) command.sort = sort;
      const limit = optPositiveInt(a, "limit", toolName);
      if (limit !== undefined) command.limit = limit;
      return { database, command };
    }
    case "aggregate": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const pipeline = reqArray(a, "pipeline", toolName);
      for (const stage of pipeline) {
        if (!isPlainObject(stage)) {
          throw new Error(`${toolName}: every 'pipeline' stage must be an object`);
        }
      }
      return { database, command: { aggregate: collection, pipeline, cursor: {} } };
    }
    case "count": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      return {
        database,
        command: { count: collection, query: optObject(a, "query", toolName) ?? {} },
      };
    }
    case "insert-many": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const documents = reqArray(a, "documents", toolName);
      if (documents.length === 0) {
        throw new Error(`${toolName}: 'documents' must contain at least one document`);
      }
      for (const doc of documents) {
        if (!isPlainObject(doc)) {
          throw new Error(`${toolName}: every entry in 'documents' must be an object`);
        }
      }
      return { database, command: { insert: collection, documents, ordered: true } };
    }
    case "update-many": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const filter = reqObject(a, "filter", toolName);
      const update = reqObject(a, "update", toolName);
      return {
        database,
        command: {
          update: collection,
          updates: [{ q: filter, u: update, multi: true, upsert: false }],
        },
      };
    }
    case "delete-many": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const filter = reqObject(a, "filter", toolName);
      return {
        database,
        command: { delete: collection, deletes: [{ q: filter, limit: 0 }] },
      };
    }
    case "create-collection": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      return { database, command: { create: collection } };
    }
    case "drop-collection": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      return { database, command: { drop: collection } };
    }
    case "drop-database": {
      const database = reqString(a, "database", toolName);
      return { database, command: { dropDatabase: 1 } };
    }
    case "rename-collection": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const newName = reqString(a, "newName", toolName);
      return {
        database: "admin",
        command: {
          renameCollection: `${database}.${collection}`,
          to: `${database}.${newName}`,
          dropTarget: false,
        },
      };
    }
    case "create-index": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const keys = reqObject(a, "keys", toolName);
      if (Object.keys(keys).length === 0) {
        throw new Error(`${toolName}: 'keys' must name at least one field`);
      }
      return {
        database,
        command: {
          createIndexes: collection,
          indexes: [{ key: keys, name: indexNameFromKeys(keys) }],
        },
      };
    }
    case "drop-index": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const indexName = reqString(a, "indexName", toolName);
      return { database, command: { dropIndexes: collection, index: indexName } };
    }
    case "explain": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      const method = optArray(a, "method", toolName);
      const methodArgs = optObject(a, "methodArgs", toolName);
      const operation =
        method !== undefined && method.length > 0 ? String(method[0]) : "find";
      const inner: Record<string, unknown> = { [operation]: collection, ...(methodArgs ?? {}) };
      if (method === undefined) inner.filter = {};
      return { database, command: { explain: inner, verbosity: "queryPlanner" } };
    }
    case "export": {
      const database = reqString(a, "database", toolName);
      const collection = reqString(a, "collection", toolName);
      optString(a, "exportTitle", toolName);
      return {
        database,
        command: { find: collection, filter: optObject(a, "filter", toolName) ?? {} },
      };
    }
    case "db-stats": {
      const database = reqString(a, "database", toolName);
      return { database, command: { dbStats: 1, scale: 1 } };
    }
    case "mongodb-logs": {
      optPositiveInt(a, "limit", toolName);
      const type = optString(a, "type", toolName);
      return { database: "admin", command: { getLog: type ?? "global" } };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/**
 * Pull the document list out of a command reply: a bare array, a cursor
 * reply (`{ cursor: { firstBatch: [...] } }`), or a `{ documents: [...] }`
 * / `{ results: [...] }` wrapper. Anything else yields no documents.
 */
export function extractDocs(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result.filter(isPlainObject);
  }
  if (isPlainObject(result)) {
    const cursor = result.cursor;
    if (isPlainObject(cursor) && Array.isArray(cursor.firstBatch)) {
      return cursor.firstBatch.filter(isPlainObject);
    }
    if (Array.isArray(result.documents)) return result.documents.filter(isPlainObject);
    if (Array.isArray(result.results)) return result.results.filter(isPlainObject);
  }
  return [];
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Infer a top-level field -> types map from sampled documents.
 * Field order follows first appearance; type lists are sorted.
 */
export function inferSchema(docs: Array<Record<string, unknown>>): {
  fields: Record<string, string[]>;
  sampledDocuments: number;
} {
  const seen = new Map<string, Set<string>>();
  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      if (value === undefined) continue;
      let types = seen.get(key);
      if (!types) {
        types = new Set<string>();
        seen.set(key, types);
      }
      types.add(typeName(value));
    }
  }
  const fields: Record<string, string[]> = {};
  for (const [key, types] of seen) fields[key] = [...types].sort();
  return { fields, sampledDocuments: docs.length };
}

/** Apply the mongodb-logs limit to a getLog reply (`{ log: [...] }`). */
export function applyLogLimit(result: unknown, limit?: number): unknown {
  if (limit === undefined) return result;
  if (isPlainObject(result) && Array.isArray(result.log)) {
    return { ...result, log: result.log.slice(0, limit) };
  }
  if (Array.isArray(result)) return result.slice(0, limit);
  return result;
}

// ---------------------------------------------------------------------------
// Connection-string resolution
// ---------------------------------------------------------------------------

/** Explicit argument wins, then MDB_MCP_CONNECTION_STRING. */
export function resolveConnectionString(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromArg = explicit?.trim();
  if (fromArg) return fromArg;
  const fromEnv = env.MDB_MCP_CONNECTION_STRING?.trim();
  if (fromEnv) return fromEnv;
  return undefined;
}

// ---------------------------------------------------------------------------
// mongosh executor
// ---------------------------------------------------------------------------

/**
 * Render the `mongosh --eval` script for one command: run the command
 * document against the target database and print the reply as JSON.
 * Both the database name and the command are embedded via
 * JSON.stringify, so no caller text is ever interpolated raw.
 */
export function buildEvalScript(database: string, command: Record<string, unknown>): string {
  return (
    `JSON.stringify(db.getSiblingDB(${JSON.stringify(database)})` +
    `.runCommand(${JSON.stringify(command)}))`
  );
}

/** Parse mongosh stdout: JSON when possible, otherwise a raw wrapper. */
export function parseMongoshOutput(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { raw: trimmed };
  }
}

/**
 * Default executor: runs command documents through the `mongosh`
 * binary. A missing `mongosh` (ENOENT) and a missing connection string
 * both surface as clear errors — results are never faked.
 */
export class MongoshExecutor implements MongoExecutor {
  constructor(private readonly connectionString?: string) {
    if (connectionString !== undefined) checkConnectionString(connectionString, "connect");
  }

  async execute(
    toolName: string,
    database: string,
    command: Record<string, unknown>,
    options?: { connectionString?: string },
  ): Promise<unknown> {
    const connectionString = options?.connectionString ?? this.connectionString;
    if (!connectionString) {
      throw new Error(NO_CONNECTION_MESSAGE);
    }
    const script = buildEvalScript(database, command);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "mongosh",
        [connectionString, "--quiet", "--eval", script],
        { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
        (err, out, stderr) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
              reject(
                new Error(
                  "mongosh executable not found: the `mongosh` command-line client is not " +
                    "installed or not on PATH, so docbase cannot run the command. Install " +
                    "MongoDB Shell and retry. (spawn mongosh ENOENT)",
                ),
              );
              return;
            }
            const detail = (stderr || "").trim() || err.message;
            reject(new Error(`mongosh command failed (${toolName}): ${detail}`));
            return;
          }
          resolve(out);
        },
      );
    });
    return parseMongoshOutput(stdout);
  }
}

export function createMongoshExecutor(connectionString?: string): MongoExecutor {
  return new MongoshExecutor(resolveConnectionString(connectionString));
}

// ---------------------------------------------------------------------------
// Core class
// ---------------------------------------------------------------------------

export class DocBase {
  constructor(private readonly executor?: MongoExecutor | null) {}

  /**
   * Validate and run one tool call. Most tools pass the executor's
   * reply through untouched; `collection-schema` infers field types
   * from the sampled documents, `mongodb-logs` applies its limit to
   * the getLog reply, and `export` wraps the matching documents under
   * the requested export title.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const built = buildCommand(toolName, args ?? {});
    if (!this.executor) {
      throw new Error(NO_EXECUTOR_MESSAGE);
    }
    const raw = await this.executor.execute(
      toolName,
      built.database,
      built.command,
      built.connectionString ? { connectionString: built.connectionString } : undefined,
    );
    if (toolName === "collection-schema") {
      const schema = inferSchema(extractDocs(raw));
      return {
        database: built.database,
        collection: String((args ?? {}).collection ?? ""),
        fields: schema.fields,
        sampledDocuments: schema.sampledDocuments,
      };
    }
    if (toolName === "mongodb-logs") {
      const limit =
        typeof (args ?? {}).limit === "number"
          ? Math.floor((args as Record<string, unknown>).limit as number)
          : undefined;
      return applyLogLimit(raw, limit);
    }
    if (toolName === "export") {
      const a = args ?? {};
      return {
        exportTitle:
          typeof a.exportTitle === "string" && a.exportTitle ? a.exportTitle : a.collection,
        database: built.database,
        collection: a.collection,
        documents: extractDocs(raw),
      };
    }
    return raw;
  }
}

/**
 * Wire a DocBase from an optional connection string: the mongosh
 * executor is always created (it validates lazily at call time), so
 * the server starts and answers tools/list with nothing behind it,
 * and only a real call reports a missing string or a missing binary.
 */
export function createDocBase(connectionString?: string): DocBase {
  return new DocBase(createMongoshExecutor(connectionString));
}
