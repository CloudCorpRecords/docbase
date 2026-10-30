/**
 * docbase types.
 *
 * The core talks to MongoDB only through an injectable executor, so
 * every behaviour except the real `mongosh` subprocess can be tested
 * with a fake executor and no live database.
 */

/** Per-call options handed to the executor alongside the command. */
export interface MongoExecuteOptions {
  /**
   * Connection string override for this one call. The `connect` tool
   * uses it so a caller-supplied string is what gets pinged; when it is
   * absent the executor falls back to its configured string.
   */
  connectionString?: string;
}

/**
 * Anything that can run one MongoDB command document against one
 * database and return the server's reply. The default implementation
 * shells out to `mongosh`; tests inject a fake.
 */
export interface MongoExecutor {
  execute(
    toolName: string,
    database: string,
    command: Record<string, unknown>,
    options?: MongoExecuteOptions,
  ): Promise<unknown>;
}

/** A validated tool call, mapped to a MongoDB command document. */
export interface BuiltCommand {
  /** Database the command runs against (`admin` for server-level tools). */
  database: string;
  /** The MongoDB command document, e.g. `{ find: "users", filter: {} }`. */
  command: Record<string, unknown>;
  /** Connection-string override carried by the `connect` tool, if any. */
  connectionString?: string;
}
