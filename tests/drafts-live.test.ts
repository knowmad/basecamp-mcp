/**
 * Live draft lifecycle: create as draft, edit without publishing, list drafts,
 * publish once, refuse a second publish.
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

type Recording = {
  id: number;
  title?: string;
  subject?: string;
  content: string;
  status: string;
  inherits_status: boolean;
};

type Draft = { id: number; type: string; title: string };

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

async function draftIds(): Promise<Draft[]> {
  return mcp.json<Draft[]>("basecamp_list_drafts", { limit: 100 });
}

describe("message drafts and publishing (live)", () => {
  it("creates a draft by default, edits it without publishing, then publishes once", async () => {
    const subject = `MCP draft lifecycle ${Date.now()}`;

    // CREATE with no status → draft
    const created = await mcp.text("basecamp_create_message", {
      message_board_id: messageBoardId,
      subject,
      content: "<div>Draft body.</div>",
    });
    expect(created).toContain("Status: drafted");
    const id = extractId(created);
    toTrash.push(id);

    const draft = await mcp.json<Recording>("basecamp_get_message", {
      message_id: id,
    });
    expect(draft.status).toBe("drafted");
    expect(typeof draft.inherits_status).toBe("boolean");

    // LIST DRAFTS → present as a message
    const drafts = await draftIds();
    expect(drafts.some((d) => d.id === id && d.type === "message")).toBe(true);

    // EDIT → still a draft
    const updated = await mcp.text("basecamp_update_message", {
      message_id: id,
      content_append: "<div>Edited.</div>",
    });
    expect(updated).toContain("Status: drafted");
    const afterEdit = await mcp.json<Recording>("basecamp_get_message", {
      message_id: id,
    });
    expect(afterEdit.status).toBe("drafted");
    expect(afterEdit.content).toContain("Edited.");

    // PUBLISH → active, content preserved
    const published = await mcp.text("basecamp_publish_message", {
      message_id: id,
    });
    expect(published).toContain("Message published.");
    const live = await mcp.json<Recording>("basecamp_get_message", {
      message_id: id,
    });
    expect(live.status).toBe("active");
    expect(live.content).toContain("Draft body.");
    expect(live.content).toContain("Edited.");

    // PUBLISH AGAIN → refused, nothing changed
    const again = await mcp.text("basecamp_publish_message", {
      message_id: id,
    });
    expect(again).toContain("Not published");

    expect((await draftIds()).some((d) => d.id === id)).toBe(false);
  });
});

describe("document drafts and publishing (live)", () => {
  it("keeps title and content across partial edits, stays drafted, then publishes once", async () => {
    const title = `MCP doc draft lifecycle ${Date.now()}`;

    const created = await mcp.text("basecamp_create_document", {
      vault_id: vaultId,
      title,
      content: "<div>Doc draft body.</div>",
    });
    expect(created).toContain("Status: drafted");
    const id = extractId(created);
    toTrash.push(id);

    expect(
      (await draftIds()).some((d) => d.id === id && d.type === "document"),
    ).toBe(true);

    // TITLE-ONLY edit must not clear content (document updates replace).
    const newTitle = `${title} (renamed)`;
    await mcp.text("basecamp_update_document", {
      document_id: id,
      title: newTitle,
    });
    let doc = await mcp.json<Recording>("basecamp_get_document", {
      document_id: id,
    });
    expect(doc.title).toBe(newTitle);
    expect(doc.content).toContain("Doc draft body.");
    expect(doc.status).toBe("drafted");

    // CONTENT-ONLY edit must not clear the title.
    await mcp.text("basecamp_update_document", {
      document_id: id,
      content_append: "<div>Doc edited.</div>",
    });
    doc = await mcp.json<Recording>("basecamp_get_document", {
      document_id: id,
    });
    expect(doc.title).toBe(newTitle);
    expect(doc.content).toContain("Doc edited.");
    expect(doc.status).toBe("drafted");

    // PUBLISH → active, title and content preserved
    const published = await mcp.text("basecamp_publish_document", {
      document_id: id,
    });
    expect(published).toContain("Document published.");
    doc = await mcp.json<Recording>("basecamp_get_document", {
      document_id: id,
    });
    expect(doc.status).toBe("active");
    expect(doc.title).toBe(newTitle);
    expect(doc.content).toContain("Doc draft body.");
    expect(doc.content).toContain("Doc edited.");

    const again = await mcp.text("basecamp_publish_document", {
      document_id: id,
    });
    expect(again).toContain("Not published");
  });
});
