/**
 * Live publish lifecycle: create a draft, publish it once, refuse a second
 * publish.
 *
 * Publishing notifies real people, so this suite refuses to run unless the
 * BASECAMP_BUCKET_ID project's name contains "sandbox". Never point it at a
 * client project.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveDockId,
  trashRecordings,
} from "./utils";

type Recording = { id: number; title?: string; content: string };

let mcp: McpTestClient;
let projectId: number;
let messageBoardId: number;
let vaultId: number;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const project = await mcp.json<{ name: string }>("basecamp_get_project", {
    project_id: projectId,
  });
  if (!/sandbox/i.test(project.name)) {
    throw new Error(
      `Refusing to run: project ${projectId} ("${project.name}") is not named as a sandbox. This suite publishes, which notifies people.`,
    );
  }

  const board = await resolveDockId(mcp, projectId, "message_board");
  const vault = await resolveDockId(mcp, projectId, "vault");
  if (board == null || vault == null) {
    throw new Error(
      `Sandbox project ${projectId} needs both a message board and Docs & Files enabled.`,
    );
  }
  messageBoardId = board;
  vaultId = vault;
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("basecamp_publish_message (live)", () => {
  it("publishes a draft once, keeps its content, and refuses a second publish", async () => {
    const created = await mcp.text("basecamp_create_message", {
      message_board_id: messageBoardId,
      subject: `MCP publish message ${Date.now()}`,
      content: "<div>Draft body.</div>",
      status: "drafted",
    });
    const id = extractId(created);
    toTrash.push(id);

    // Editing a draft must not publish it: the publish below would refuse.
    await mcp.text("basecamp_update_message", {
      message_id: id,
      content_append: "<div>Edited.</div>",
    });

    const published = await mcp.text("basecamp_publish_message", {
      message_id: id,
    });
    expect(published).toContain("Message published.");
    expect(published).toContain("Status: active");

    const live = await mcp.json<Recording>("basecamp_get_message", {
      message_id: id,
    });
    expect(live.content).toContain("Draft body.");
    expect(live.content).toContain("Edited.");

    const again = await mcp.text("basecamp_publish_message", {
      message_id: id,
    });
    expect(again).toContain("Not published");
  });
});

describe("basecamp_publish_document (live)", () => {
  it("publishes a draft once, keeps title and content, and refuses a second publish", async () => {
    const title = `MCP publish document ${Date.now()}`;
    const created = await mcp.text("basecamp_create_document", {
      vault_id: vaultId,
      title,
      content: "<div>Doc draft body.</div>",
      status: "drafted",
    });
    const id = extractId(created);
    toTrash.push(id);

    const published = await mcp.text("basecamp_publish_document", {
      document_id: id,
    });
    expect(published).toContain("Document published.");
    expect(published).toContain("Status: active");

    const doc = await mcp.json<Recording>("basecamp_get_document", {
      document_id: id,
    });
    expect(doc.title).toBe(title);
    expect(doc.content).toContain("Doc draft body.");

    const again = await mcp.text("basecamp_publish_document", {
      document_id: id,
    });
    expect(again).toContain("Not published");
  });
});
