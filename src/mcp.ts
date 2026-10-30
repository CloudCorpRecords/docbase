/**
 * docbase MCP server. Tools: the 22 MongoDB database tools.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects two keys that are not
 * in this tool's public spec ("$schema" and "additionalProperties"),
 * which breaks exact tool-list/schema parity with the spec. This file
 * therefore serves tools/list with the spec's exact input schemas as
 * explicit literals, while zod still validates every tools/call
 * argument set.
 *
 * The connection string comes from the argument after `mcp`
 * (`docbase mcp mongodb://...`) or from MDB_MCP_CONNECTION_STRING.
 * No connection is opened at startup: the server answers tools/list
 * with nothing behind it, and only a tools/call touches the executor —
 * which is where a missing connection or a missing `mongosh` binary
 * surfaces as an isError result instead of invented data.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createDocBase, VERSION } from "./mongo.js";

const Obj = z.record(z.string(), z.unknown());
const Arr = z.array(z.unknown());

const ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  connect: z.object({ connectionString: z.string().optional() }),
  "list-databases": z.object({}),
  "list-collections": z.object({ database: z.string() }),
  "collection-schema": z.object({ database: z.string(), collection: z.string() }),
  "collection-indexes": z.object({ database: z.string(), collection: z.string() }),
  "collection-storage-size": z.object({ database: z.string(), collection: z.string() }),
  find: z.object({
    database: z.string(),
    collection: z.string(),
    filter: Obj.optional(),
    projection: Obj.optional(),
    limit: z.number().optional(),
    sort: Obj.optional(),
  }),
  aggregate: z.object({
    database: z.string(),
    collection: z.string(),
    pipeline: z.array(z.unknown()),
  }),
  count: z.object({
    database: z.string(),
    collection: z.string(),
    query: Obj.optional(),
  }),
  "insert-many": z.object({
    database: z.string(),
    collection: z.string(),
    documents: z.array(z.unknown()),
  }),
  "update-many": z.object({
    database: z.string(),
    collection: z.string(),
    filter: Obj,
    update: Obj,
  }),
  "delete-many": z.object({
    database: z.string(),
    collection: z.string(),
    filter: Obj,
  }),
  "create-collection": z.object({ database: z.string(), collection: z.string() }),
  "drop-collection": z.object({ database: z.string(), collection: z.string() }),
  "drop-database": z.object({ database: z.string() }),
  "rename-collection": z.object({
    database: z.string(),
    collection: z.string(),
    newName: z.string(),
  }),
  "create-index": z.object({
    database: z.string(),
    collection: z.string(),
    keys: Obj,
  }),
  "drop-index": z.object({
    database: z.string(),
    collection: z.string(),
    indexName: z.string(),
  }),
  explain: z.object({
    database: z.string(),
    collection: z.string(),
    method: Arr.optional(),
    methodArgs: Obj.optional(),
  }),
  export: z.object({
    database: z.string(),
    collection: z.string(),
    exportTitle: z.string().optional(),
    filter: Obj.optional(),
  }),
  "db-stats": z.object({ database: z.string() }),
  "mongodb-logs": z.object({
    limit: z.number().optional(),
    type: z.string().optional(),
  }),
};

const TOOLS = [
  {
    name: "connect",
    description: "Connect to a MongoDB instance",
    inputSchema: {
      type: "object" as const,
      properties: {
        connectionString: { description: "MongoDB connection string (mongodb:// or mongodb+srv://) to connect with; overrides the configured connection for this call.", type: "string" },
      },
      required: [],
    },
  },
  {
    name: "list-databases",
    description: "List all databases in the connected MongoDB instance",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list-collections",
    description: "List collections in a MongoDB database",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database whose collections to list.", type: "string" },
      },
      required: ["database"],
    },
  },
  {
    name: "collection-schema",
    description: "Describe the schema for a collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection whose schema to describe.", type: "string" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "collection-indexes",
    description: "List indexes for a collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection whose indexes to list.", type: "string" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "collection-storage-size",
    description: "Get the storage size of a collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection whose storage size to report.", type: "string" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "find",
    description: "Run a find query against a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection to query.", type: "string" },
        filter: { description: "MongoDB query filter document matching the documents to return.", type: "object" },
        projection: { description: "Projection document controlling which fields are returned in each document.", type: "object" },
        limit: { description: "Maximum number of documents to return; must be positive.", type: "number" },
        sort: { description: "Sort document mapping each field to its sort direction (1 for ascending, -1 for descending).", type: "object" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "aggregate",
    description: "Run an aggregation pipeline against a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection to run the aggregation pipeline against.", type: "string" },
        pipeline: { description: "Aggregation pipeline stages, each an object such as a $match or $group stage, applied in order.", type: "array" },
      },
      required: ["database", "collection", "pipeline"],
    },
  },
  {
    name: "count",
    description: "Count documents in a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection whose documents to count.", type: "string" },
        query: { description: "Query filter document selecting the documents to count.", type: "object" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "insert-many",
    description: "Insert documents into a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection to insert the documents into.", type: "string" },
        documents: { description: "Documents to insert; a non-empty array of objects.", type: "array" },
      },
      required: ["database", "collection", "documents"],
    },
  },
  {
    name: "update-many",
    description: "Update documents in a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection whose documents to update.", type: "string" },
        filter: { description: "Filter document selecting the documents to update.", type: "object" },
        update: { description: "Update document to apply to the matching documents, for example using update operators such as $set.", type: "object" },
      },
      required: ["database", "collection", "filter", "update"],
    },
  },
  {
    name: "delete-many",
    description: "Delete documents from a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection whose documents to delete.", type: "string" },
        filter: { description: "Filter document selecting the documents to delete; all matching documents are deleted.", type: "object" },
      },
      required: ["database", "collection", "filter"],
    },
  },
  {
    name: "create-collection",
    description: "Create a new collection in a MongoDB database",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database in which to create the collection.", type: "string" },
        collection: { description: "Name of the new collection to create.", type: "string" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "drop-collection",
    description: "Drop a collection from a MongoDB database",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection to drop.", type: "string" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "drop-database",
    description: "Drop a MongoDB database",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database to drop.", type: "string" },
      },
      required: ["database"],
    },
  },
  {
    name: "rename-collection",
    description: "Rename a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Current name of the collection to rename.", type: "string" },
        newName: { description: "New name for the collection, within the same database.", type: "string" },
      },
      required: ["database", "collection", "newName"],
    },
  },
  {
    name: "create-index",
    description: "Create an index on a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection to create the index on.", type: "string" },
        keys: { description: "Index keys document mapping each field to its index direction or type (for example 1, -1, or \"text\"); must name at least one field.", type: "object" },
      },
      required: ["database", "collection", "keys"],
    },
  },
  {
    name: "drop-index",
    description: "Drop an index from a MongoDB collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection to drop the index from.", type: "string" },
        indexName: { description: "Name of the index to drop from the collection.", type: "string" },
      },
      required: ["database", "collection", "indexName"],
    },
  },
  {
    name: "explain",
    description: "Get the execution plan for a MongoDB query",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection the explained operation runs against.", type: "string" },
        method: { description: "Array naming the operation method to explain; the first entry is used and find is used when this is omitted.", type: "array" },
        methodArgs: { description: "Arguments document for the explained method, merged into the operation being explained.", type: "object" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "export",
    description: "Export a MongoDB collection to a file",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database containing the collection.", type: "string" },
        collection: { description: "Name of the collection to export.", type: "string" },
        exportTitle: { description: "Title for the export; the collection name is used when this is omitted.", type: "string" },
        filter: { description: "Filter document selecting the documents to export.", type: "object" },
      },
      required: ["database", "collection"],
    },
  },
  {
    name: "db-stats",
    description: "Get statistics for a MongoDB database",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: { description: "Name of the MongoDB database whose statistics to return.", type: "string" },
      },
      required: ["database"],
    },
  },
  {
    name: "mongodb-logs",
    description: "Retrieve MongoDB log entries",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { description: "Maximum number of log lines to return; must be positive.", type: "number" },
        type: { description: "Log type or component to retrieve; global is used when this is omitted.", type: "string" },
      },
      required: [],
    },
  },
];

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

// argv looks like: [node, cli.js, "mcp", maybe-connection-string].
const argv = process.argv.slice(2);
const mcpIndex = argv.indexOf("mcp");
const explicit = mcpIndex >= 0 ? argv[mcpIndex + 1] : undefined;
const docbase = createDocBase(explicit);

const server = new Server(
  { name: "docbase", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const schema = ARG_SCHEMAS[name];
  if (!schema) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  try {
    const parsed = schema.parse(args ?? {}) as Record<string, unknown>;
    const result = await docbase.callTool(name, parsed);
    return textResult(result);
  } catch (err) {
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
