import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, type McpTestClient, requireEnv } from "./utils";

let mcp: McpTestClient;

beforeAll(async () => {
  mcp = await createTestClient();
});

afterAll(async () => {
  await mcp?.close();
});

describe("MCP harness (live)", () => {
  it("lists tools through the MCP protocol", async () => {
    const { tools } = await mcp.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("basecamp_list_projects");
    expect(names).toContain("basecamp_create_kanban_card");
    expect(names).toContain("basecamp_list_recordings");
  });

  it("authenticates and reaches the live API via basecamp_whoami", async () => {
    const me = await mcp.json<{ name: string; account_id: string }>(
      "basecamp_whoami",
    );
    expect(typeof me.name).toBe("string");
    expect(me.name.length).toBeGreaterThan(0);
    expect(me.account_id).toBeTruthy();
  });

  it("can load the sandbox project and its dock", async () => {
    const projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));
    const project = await mcp.json<{ id: number; dock: unknown[] }>(
      "basecamp_get_project",
      { project_id: projectId },
    );
    expect(project.id).toBe(projectId);
    expect(Array.isArray(project.dock)).toBe(true);
  });
});
