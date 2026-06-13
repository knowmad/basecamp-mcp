/**
 * Integration test harness.
 *
 * Stands up the real MCP server (every tool registered via `buildServer`) and
 * drives it through an in-memory MCP client. Tool calls therefore exercise the
 * full production path: JSON-schema/zod input validation in the MCP layer, the
 * registered handler, and a LIVE Basecamp API request via the official SDK.
 *
 * These are live tests — they require valid credentials:
 *   - BASECAMP_CLIENT_ID / BASECAMP_CLIENT_SECRET in the environment (.env)
 *   - ~/.config/basecamp-mcp/credentials.json (refreshToken + accountId)
 * and a sandbox project id in BASECAMP_BUCKET_ID for mutating suites.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/index.js";
import { initializeBasecampClient } from "../src/utils/auth.js";

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value == null || value === "") {
    throw new Error(`Environment variable ${key} is required but missing.`);
  }
  return value;
}

/** Extract the numeric id from a tool's "...\nID: 123\n..." confirmation text. */
export function extractId(text: string): number {
  const match = text.match(/ID:\s*(\d+)/);
  if (!match) {
    throw new Error(`Could not find an ID in tool response: ${text}`);
  }
  return Number(match[1]);
}

export type ToolContent = Array<{
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}>;

export type ToolResult = {
  content: ToolContent;
  isError?: boolean;
};

export type McpTestClient = {
  client: Client;
  /** Invoke an MCP tool and return its raw CallToolResult. */
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** Invoke a tool and return the first text block. Fails the call on error. */
  text(name: string, args?: Record<string, unknown>): Promise<string>;
  /** Invoke a tool whose first text block is JSON, returning the parsed value. */
  json<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
};

/**
 * Several tools catch errors internally and return the message as plain text
 * rather than setting `isError`. Treat the well-known prefixes from
 * `handleBasecampError` as failures so lifecycle assertions don't silently
 * pass on an error string.
 */
function assertNotError(name: string, result: ToolResult): void {
  if (result.isError) {
    const text = result.content.find((c) => c.type === "text")?.text ?? "";
    throw new Error(`Tool ${name} returned an error: ${text}`);
  }
  const text = result.content.find((c) => c.type === "text")?.text ?? "";
  if (/^(Error|Basecamp API error|Not logged in|Failed)\b/i.test(text.trim())) {
    throw new Error(`Tool ${name} returned an error: ${text}`);
  }
}

function firstText(result: ToolResult): string {
  const block = result.content.find((c) => c.type === "text");
  if (!block || block.text === undefined) {
    throw new Error("Tool result has no text content block");
  }
  return block.text;
}

export async function createTestClient(): Promise<McpTestClient> {
  const server = buildServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "basecamp-mcp-tests", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const call = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult> => {
    const result = (await client.callTool({
      name,
      arguments: args,
    })) as ToolResult;
    return result;
  };

  return {
    client,
    call,
    async text(name, args = {}) {
      const result = await call(name, args);
      assertNotError(name, result);
      return firstText(result);
    },
    async json<T = unknown>(name: string, args: Record<string, unknown> = {}) {
      const result = await call(name, args);
      assertNotError(name, result);
      return JSON.parse(firstText(result)) as T;
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Resolve the kanban card-table id for a project from its dock, mirroring the
 * discovery the basecamp-client suite did. Returns null if the project has no
 * kanban board enabled.
 */
export async function resolveCardTableId(
  mcp: McpTestClient,
  projectId: number,
): Promise<number | null> {
  const project = await mcp.json<{
    dock?: Array<{ name: string; id: number; enabled?: boolean }>;
  }>("basecamp_get_project", { project_id: projectId });

  const entry = (project.dock ?? []).find(
    (item) => item.name === "kanban_board" && item.enabled !== false,
  );
  return entry ? entry.id : null;
}

/**
 * Trash recordings created during a test. There is no MCP tool that deletes
 * recordings, so teardown talks to the Basecamp SDK directly. Best-effort:
 * swallows individual failures so cleanup of later ids still runs.
 */
export async function trashRecordings(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const client = await initializeBasecampClient();
  for (const id of ids) {
    try {
      await client.recordings.trash(id);
    } catch {
      // Already gone / not trashable — ignore so remaining ids still clean up.
    }
  }
}

/** Resolve the first todoset id for a project from its dock. */
export async function resolveDockId(
  mcp: McpTestClient,
  projectId: number,
  dockName: string,
): Promise<number | null> {
  const project = await mcp.json<{
    dock?: Array<{ name: string; id: number; enabled?: boolean }>;
  }>("basecamp_get_project", { project_id: projectId });

  const entry = (project.dock ?? []).find(
    (item) => item.name === dockName && item.enabled !== false,
  );
  return entry ? entry.id : null;
}
