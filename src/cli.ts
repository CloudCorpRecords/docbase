#!/usr/bin/env node
/**
 * docbase CLI.
 *
 *   docbase mcp [connection-string]
 *   docbase call <tool> [json-args]
 *   docbase --version
 *
 * Exit codes: 0 success, 1 tool/connection error, 2 usage error.
 * For `mcp` and `call`, the connection string may be omitted when
 * MDB_MCP_CONNECTION_STRING is set; the server still starts and lists
 * its tools without one, and only real calls fail.
 */
import { createDocBase, TOOL_NAMES, VERSION } from "./mongo.js";

function usage(): never {
  console.error(`Usage:
  docbase mcp [connection-string]
  docbase call <tool> [json-args]
  docbase --version

Tools: ${TOOL_NAMES.join(", ")}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  try {
    if (cmd === "call") {
      const [tool, jsonArgs] = rest;
      if (!tool) usage();
      let args: Record<string, unknown> = {};
      if (jsonArgs !== undefined) {
        const parsed: unknown = JSON.parse(jsonArgs);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          console.error("error: json-args must be a JSON object");
          process.exit(2);
        }
        args = parsed as Record<string, unknown>;
      }
      const docbase = createDocBase();
      const result = await docbase.callTool(tool, args);
      console.log(JSON.stringify(result, null, 2));
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
