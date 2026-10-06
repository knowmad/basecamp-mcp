/**
 * Offline contract tests for the publish tools. These only list the registered
 * tools (no Basecamp API calls), so they run without credentials.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, type McpTestClient } from "./utils";

type Tool = {
  name: string;
  description?: string;
  inputSchema: {
    properties?: Record<string, { default?: unknown; enum?: unknown[] }>;
  };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

let mcp: McpTestClient;
let tools: Map<string, Tool>;

beforeAll(async () => {
  mcp = await createTestClient();
  const { tools: list } = await mcp.client.listTools();
  tools = new Map((list as Tool[]).map((t) => [t.name, t]));
});

afterAll(async () => {
  await mcp?.close();
});

function tool(name: string): Tool {
  const t = tools.get(name);
  if (!t) throw new Error(`Tool ${name} is not registered`);
  return t;
}

describe("publish tool contracts (offline)", () => {
  it.each(["basecamp_publish_message", "basecamp_publish_document"])(
    "%s is destructive and says it notifies and cannot be undone",
    (name) => {
      const t = tool(name);
      expect(t.annotations?.destructiveHint).toBe(true);
      expect(t.annotations?.readOnlyHint).toBe(false);
      expect(t.description).toMatch(/notifies its subscribers, exactly once/);
      expect(t.description).toMatch(/cannot be undone/);
    },
  );

  it("basecamp_publish_message takes only message_id", () => {
    const props = Object.keys(
      tool("basecamp_publish_message").inputSchema.properties ?? {},
    );
    expect(props).toEqual(["message_id"]);
  });

  it.each(["basecamp_update_message", "basecamp_update_document"])(
    "%s offers no way to set status",
    (name) => {
      const props = tool(name).inputSchema.properties ?? {};
      expect(Object.keys(props)).not.toContain("status");
    },
  );

  it.each(["basecamp_create_message", "basecamp_create_document"])(
    "%s defaults status to drafted",
    (name) => {
      const status = tool(name).inputSchema.properties?.status;
      expect(status?.default).toBe("drafted");
      expect(tool(name).description).toMatch(/cannot be undone/);
    },
  );
});
