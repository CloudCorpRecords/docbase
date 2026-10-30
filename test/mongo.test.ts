import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyLogLimit,
  buildCommand,
  buildEvalScript,
  DocBase,
  extractDocs,
  indexNameFromKeys,
  inferSchema,
  NO_CONNECTION_MESSAGE,
  NO_EXECUTOR_MESSAGE,
  parseMongoshOutput,
  resolveConnectionString,
  TOOL_NAMES,
} from "../src/mongo.js";
import type { MongoExecuteOptions, MongoExecutor } from "../src/types.js";

interface RecordedCall {
  toolName: string;
  database: string;
  command: Record<string, unknown>;
  options?: MongoExecuteOptions;
}

function fakeExecutor(result: unknown): MongoExecutor & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async execute(toolName, database, command, options) {
      calls.push({ toolName, database, command, options });
      return result;
    },
  };
}

describe("buildCommand mapping (all 22 tools)", () => {
  const cases: Array<{
    tool: string;
    args: Record<string, unknown>;
    database: string;
    command: Record<string, unknown>;
  }> = [
    { tool: "connect", args: {}, database: "admin", command: { ping: 1 } },
    {
      tool: "connect",
      args: { connectionString: "mongodb://localhost:27017/shop" },
      database: "admin",
      command: { ping: 1 },
    },
    { tool: "list-databases", args: {}, database: "admin", command: { listDatabases: 1 } },
    {
      tool: "list-collections",
      args: { database: "shop" },
      database: "shop",
      command: { listCollections: 1 },
    },
    {
      tool: "collection-schema",
      args: { database: "shop", collection: "users" },
      database: "shop",
      command: { aggregate: "users", pipeline: [{ $sample: { size: 25 } }], cursor: {} },
    },
    {
      tool: "collection-indexes",
      args: { database: "shop", collection: "users" },
      database: "shop",
      command: { listIndexes: "users", cursor: {} },
    },
    {
      tool: "collection-storage-size",
      args: { database: "shop", collection: "users" },
      database: "shop",
      command: { collStats: "users", scale: 1 },
    },
    {
      tool: "find",
      args: { database: "shop", collection: "users" },
      database: "shop",
      command: { find: "users", filter: {} },
    },
    {
      tool: "find",
      args: {
        database: "shop",
        collection: "users",
        filter: { active: true },
        projection: { name: 1 },
        sort: { name: 1 },
        limit: 5,
      },
      database: "shop",
      command: {
        find: "users",
        filter: { active: true },
        projection: { name: 1 },
        sort: { name: 1 },
        limit: 5,
      },
    },
    {
      tool: "aggregate",
      args: { database: "shop", collection: "orders", pipeline: [{ $match: { total: { $gt: 10 } } }, { $count: "n" }] },
      database: "shop",
      command: {
        aggregate: "orders",
        pipeline: [{ $match: { total: { $gt: 10 } } }, { $count: "n" }],
        cursor: {},
      },
    },
    {
      tool: "count",
      args: { database: "shop", collection: "users" },
      database: "shop",
      command: { count: "users", query: {} },
    },
    {
      tool: "count",
      args: { database: "shop", collection: "users", query: { active: true } },
      database: "shop",
      command: { count: "users", query: { active: true } },
    },
    {
      tool: "insert-many",
      args: { database: "shop", collection: "users", documents: [{ name: "Ada" }, { name: "Grace" }] },
      database: "shop",
      command: { insert: "users", documents: [{ name: "Ada" }, { name: "Grace" }], ordered: true },
    },
    {
      tool: "update-many",
      args: {
        database: "shop",
        collection: "users",
        filter: { active: false },
        update: { $set: { active: true } },
      },
      database: "shop",
      command: {
        update: "users",
        updates: [{ q: { active: false }, u: { $set: { active: true } }, multi: true, upsert: false }],
      },
    },
    {
      tool: "delete-many",
      args: { database: "shop", collection: "users", filter: { stale: true } },
      database: "shop",
      command: { delete: "users", deletes: [{ q: { stale: true }, limit: 0 }] },
    },
    {
      tool: "create-collection",
      args: { database: "shop", collection: "events" },
      database: "shop",
      command: { create: "events" },
    },
    {
      tool: "drop-collection",
      args: { database: "shop", collection: "events" },
      database: "shop",
      command: { drop: "events" },
    },
    {
      tool: "drop-database",
      args: { database: "shop" },
      database: "shop",
      command: { dropDatabase: 1 },
    },
    {
      tool: "rename-collection",
      args: { database: "shop", collection: "users", newName: "customers" },
      database: "admin",
      command: {
        renameCollection: "shop.users",
        to: "shop.customers",
        dropTarget: false,
      },
    },
    {
      tool: "create-index",
      args: { database: "shop", collection: "users", keys: { email: 1 } },
      database: "shop",
      command: { createIndexes: "users", indexes: [{ key: { email: 1 }, name: "email_1" }] },
    },
    {
      tool: "drop-index",
      args: { database: "shop", collection: "users", indexName: "email_1" },
      database: "shop",
      command: { dropIndexes: "users", index: "email_1" },
    },
    {
      tool: "explain",
      args: { database: "shop", collection: "users" },
      database: "shop",
      command: { explain: { find: "users", filter: {} }, verbosity: "queryPlanner" },
    },
    {
      tool: "explain",
      args: {
        database: "shop",
        collection: "users",
        method: ["aggregate"],
        methodArgs: { pipeline: [{ $match: {} }] },
      },
      database: "shop",
      command: {
        explain: { aggregate: "users", pipeline: [{ $match: {} }] },
        verbosity: "queryPlanner",
      },
    },
    {
      tool: "export",
      args: { database: "shop", collection: "users", filter: { active: true } },
      database: "shop",
      command: { find: "users", filter: { active: true } },
    },
    {
      tool: "db-stats",
      args: { database: "shop" },
      database: "shop",
      command: { dbStats: 1, scale: 1 },
    },
    {
      tool: "mongodb-logs",
      args: {},
      database: "admin",
      command: { getLog: "global" },
    },
    {
      tool: "mongodb-logs",
      args: { type: "startupWarnings", limit: 10 },
      database: "admin",
      command: { getLog: "startupWarnings" },
    },
  ];

  it("covers exactly the 22 spec tools", () => {
    assert.equal(TOOL_NAMES.length, 22);
    const covered = new Set(cases.map((c) => c.tool));
    assert.deepEqual([...covered].sort(), [...TOOL_NAMES].sort());
  });

  for (const c of cases) {
    it(`maps ${c.tool} to its command document`, () => {
      const built = buildCommand(c.tool, c.args);
      assert.equal(built.database, c.database);
      assert.deepEqual(built.command, c.command);
    });
  }

  it("connect carries the connection string as an executor option", () => {
    const built = buildCommand("connect", {
      connectionString: "mongodb+srv://cluster.example.net/shop",
    });
    assert.equal(built.connectionString, "mongodb+srv://cluster.example.net/shop");
  });
});

describe("buildCommand validation", () => {
  it("rejects missing or empty required strings", () => {
    assert.throws(() => buildCommand("find", { collection: "users" }), /'database' is required/);
    assert.throws(
      () => buildCommand("find", { database: "  ", collection: "users" }),
      /'database' is required/,
    );
    assert.throws(() => buildCommand("db-stats", {}), /'database' is required/);
  });

  it("rejects wrongly-typed object arguments", () => {
    assert.throws(
      () => buildCommand("find", { database: "s", collection: "c", filter: [] }),
      /'filter' must be an object/,
    );
    assert.throws(
      () => buildCommand("update-many", { database: "s", collection: "c", filter: {} }),
      /'update' is required and must be an object/,
    );
  });

  it("rejects bad insert-many payloads", () => {
    assert.throws(
      () => buildCommand("insert-many", { database: "s", collection: "c", documents: [] }),
      /at least one document/,
    );
    assert.throws(
      () => buildCommand("insert-many", { database: "s", collection: "c", documents: [42] }),
      /must be an object/,
    );
  });

  it("rejects bad aggregate pipelines, empty index keys, and bad limits", () => {
    assert.throws(
      () => buildCommand("aggregate", { database: "s", collection: "c", pipeline: ["$match"] }),
      /stage must be an object/,
    );
    assert.throws(
      () => buildCommand("create-index", { database: "s", collection: "c", keys: {} }),
      /at least one field/,
    );
    assert.throws(
      () => buildCommand("find", { database: "s", collection: "c", limit: -1 }),
      /'limit' must be a positive number/,
    );
  });

  it("rejects non-MongoDB connection strings and unknown tools", () => {
    assert.throws(
      () => buildCommand("connect", { connectionString: "postgres://localhost/db" }),
      /mongodb:\/\//,
    );
    assert.throws(() => buildCommand("nope", {}), /Unknown tool: nope/);
  });
});

describe("DocBase.callTool dispatch", () => {
  it("passes the built command through the fake executor and returns its reply", async () => {
    const executor = fakeExecutor({ n: 3, ok: 1 });
    const base = new DocBase(executor);
    const out = await base.callTool("count", { database: "shop", collection: "users" });
    assert.deepEqual(out, { n: 3, ok: 1 });
    assert.equal(executor.calls.length, 1);
    assert.equal(executor.calls[0].toolName, "count");
    assert.equal(executor.calls[0].database, "shop");
    assert.deepEqual(executor.calls[0].command, { count: "users", query: {} });
  });

  it("dispatches every one of the 22 tools to the executor", async () => {
    const executor = fakeExecutor({ ok: 1 });
    const base = new DocBase(executor);
    const sampleArgs: Record<string, Record<string, unknown>> = {
      connect: {},
      "list-databases": {},
      "list-collections": { database: "shop" },
      "collection-schema": { database: "shop", collection: "users" },
      "collection-indexes": { database: "shop", collection: "users" },
      "collection-storage-size": { database: "shop", collection: "users" },
      find: { database: "shop", collection: "users" },
      aggregate: { database: "shop", collection: "users", pipeline: [] },
      count: { database: "shop", collection: "users" },
      "insert-many": { database: "shop", collection: "users", documents: [{ a: 1 }] },
      "update-many": { database: "shop", collection: "users", filter: {}, update: { $set: { a: 2 } } },
      "delete-many": { database: "shop", collection: "users", filter: {} },
      "create-collection": { database: "shop", collection: "events" },
      "drop-collection": { database: "shop", collection: "events" },
      "drop-database": { database: "shop" },
      "rename-collection": { database: "shop", collection: "users", newName: "customers" },
      "create-index": { database: "shop", collection: "users", keys: { email: 1 } },
      "drop-index": { database: "shop", collection: "users", indexName: "email_1" },
      explain: { database: "shop", collection: "users" },
      export: { database: "shop", collection: "users" },
      "db-stats": { database: "shop" },
      "mongodb-logs": {},
    };
    for (const name of TOOL_NAMES) {
      await base.callTool(name, sampleArgs[name]);
    }
    assert.deepEqual(
      executor.calls.map((c) => c.toolName),
      [...TOOL_NAMES],
    );
  });

  it("propagates executor errors", async () => {
    const failing: MongoExecutor = {
      async execute() {
        throw new Error("connection to localhost:27017 refused");
      },
    };
    const base = new DocBase(failing);
    await assert.rejects(() => base.callTool("list-databases", {}), /refused/);
  });

  it("errors clearly when no executor is configured, after validation", async () => {
    const base = new DocBase(null);
    await assert.rejects(() => base.callTool("list-databases", {}), new RegExp(NO_EXECUTOR_MESSAGE.split(":")[0]));
    // Validation runs first: a bad call reports the argument problem.
    await assert.rejects(() => base.callTool("find", {}), /'database' is required/);
  });

  it("connect forwards the connection string override to the executor", async () => {
    const executor = fakeExecutor({ ok: 1 });
    const base = new DocBase(executor);
    await base.callTool("connect", { connectionString: "mongodb://db.internal:27017/app" });
    assert.equal(executor.calls[0].options?.connectionString, "mongodb://db.internal:27017/app");
  });
});

describe("collection-schema inference", () => {
  it("infers field types from the sampled cursor reply", async () => {
    const executor = fakeExecutor({
      cursor: {
        firstBatch: [
          { _id: "1", name: "Ada", age: 36, tags: ["a"], misc: null },
          { _id: "2", name: "Grace", age: "unknown", admin: true },
        ],
      },
      ok: 1,
    });
    const base = new DocBase(executor);
    const out = (await base.callTool("collection-schema", {
      database: "shop",
      collection: "users",
    })) as { database: string; collection: string; fields: Record<string, string[]>; sampledDocuments: number };
    assert.equal(out.database, "shop");
    assert.equal(out.collection, "users");
    assert.equal(out.sampledDocuments, 2);
    assert.deepEqual(out.fields, {
      _id: ["string"],
      name: ["string"],
      age: ["number", "string"],
      tags: ["array"],
      misc: ["null"],
      admin: ["boolean"],
    });
  });

  it("inferSchema and extractDocs handle their shapes directly", () => {
    assert.deepEqual(extractDocs([{ a: 1 }]), [{ a: 1 }]);
    assert.deepEqual(extractDocs({ documents: [{ b: 2 }] }), [{ b: 2 }]);
    assert.deepEqual(extractDocs({ ok: 1 }), []);
    assert.deepEqual(inferSchema([]), { fields: {}, sampledDocuments: 0 });
  });
});

describe("mongodb-logs and export post-processing", () => {
  it("applies the limit to a getLog reply", async () => {
    const executor = fakeExecutor({ log: ["one", "two", "three"], totalLinesWritten: 3, ok: 1 });
    const base = new DocBase(executor);
    const out = (await base.callTool("mongodb-logs", { limit: 2 })) as { log: string[] };
    assert.deepEqual(out.log, ["one", "two"]);
    assert.deepEqual(applyLogLimit({ log: ["a"] }, undefined), { log: ["a"] });
  });

  it("export wraps matching documents under the export title", async () => {
    const executor = fakeExecutor({ cursor: { firstBatch: [{ a: 1 }], id: 0, ns: "shop.users" }, ok: 1 });
    const base = new DocBase(executor);
    const named = (await base.callTool("export", {
      database: "shop",
      collection: "users",
      exportTitle: "active-users",
    })) as { exportTitle: string; documents: unknown[] };
    assert.equal(named.exportTitle, "active-users");
    assert.deepEqual(named.documents, [{ a: 1 }]);
    const unnamed = (await base.callTool("export", {
      database: "shop",
      collection: "users",
    })) as { exportTitle: string };
    assert.equal(unnamed.exportTitle, "users");
  });
});

describe("helpers", () => {
  it("indexNameFromKeys follows the field_direction convention", () => {
    assert.equal(indexNameFromKeys({ email: 1 }), "email_1");
    assert.equal(indexNameFromKeys({ name: 1, age: -1, bio: "text" }), "name_1_age_-1_bio_text");
  });

  it("buildEvalScript embeds the database and command as JSON", () => {
    const script = buildEvalScript("shop", { find: "users", filter: { active: true } });
    assert.match(script, /db\.getSiblingDB\("shop"\)\.runCommand\(/);
    assert.match(script, /"find":"users"/);
    assert.match(script, /"active":true/);
  });

  it("parseMongoshOutput parses JSON and falls back to a raw wrapper", () => {
    assert.deepEqual(parseMongoshOutput('{"ok":1,"n":2}'), { ok: 1, n: 2 });
    assert.deepEqual(parseMongoshOutput("not json at all"), { raw: "not json at all" });
    assert.deepEqual(parseMongoshOutput("  \n"), {});
  });

  it("resolveConnectionString prefers the explicit argument over the env", () => {
    const env = { MDB_MCP_CONNECTION_STRING: "mongodb://env-host/db" } as NodeJS.ProcessEnv;
    assert.equal(resolveConnectionString("mongodb://arg-host/db", env), "mongodb://arg-host/db");
    assert.equal(resolveConnectionString(undefined, env), "mongodb://env-host/db");
    assert.equal(resolveConnectionString(undefined, {} as NodeJS.ProcessEnv), undefined);
  });

  it("the no-connection message names the env var", () => {
    assert.match(NO_CONNECTION_MESSAGE, /MDB_MCP_CONNECTION_STRING/);
  });
});
