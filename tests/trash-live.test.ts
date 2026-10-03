import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeBasecampClient } from "../src/utils/auth.js";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveDockId,
  trashRecordings,
} from "./utils";

let mcp: McpTestClient;
let projectId: number;
let todosetId: number;
let messageBoardId: number;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const todoset = await resolveDockId(mcp, projectId, "todoset");
  const board = await resolveDockId(mcp, projectId, "message_board");
  if (todoset == null || board == null) {
    throw new Error(
      `Sandbox project ${projectId} needs a todoset and a message board for trash tests.`,
    );
  }
  todosetId = todoset;
  messageBoardId = board;
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("Basecamp trash via MCP tools (live)", () => {
  it("trashes a todo list with its todos, finds it, and restores it", async () => {
    const listText = await mcp.text("basecamp_create_todolist", {
      todoset_id: todosetId,
      name: `MCP trash list ${Date.now()}`,
    });
    const listId = extractId(listText);
    toTrash.push(listId);
    const todoText = await mcp.text("basecamp_create_todo", {
      todolist_id: listId,
      title: "Todo in a trashed list",
    });
    const todoId = extractId(todoText);

    const client = await initializeBasecampClient();
    const listedIds = async () =>
      (
        await mcp.json<{ todoLists: Array<{ id: number }> }>(
          "basecamp_get_todoset",
          { todoset_id: todosetId },
        )
      ).todoLists.map((list) => list.id);

    const trashText = await mcp.text("basecamp_trash", {
      recording_id: listId,
    });
    expect(trashText).toContain("Moved to the trash!");
    expect((await client.todolists.get(listId)).status).toBe("trashed");
    expect((await client.todos.get(todoId)).status).toBe("trashed");
    expect(await listedIds()).not.toContain(listId);

    // The restore tool tells the LLM to find trashed items in this way.
    const trashed = await mcp.json<{ recordings: Array<{ id: number }> }>(
      "basecamp_list_recordings",
      {
        project_ids: [projectId],
        type: ["todolist"],
        status: "trashed",
      },
    );
    expect(trashed.recordings.some((r) => r.id === listId)).toBe(true);

    const restoreText = await mcp.text("basecamp_restore", {
      recording_id: listId,
    });
    expect(restoreText).toContain("Restored!");
    expect((await client.todolists.get(listId)).status).toBe("active");
    expect((await client.todos.get(todoId)).status).toBe("active");
    expect(await listedIds()).toContain(listId);
  });

  it("trashes and restores a comment", async () => {
    const messageText = await mcp.text("basecamp_create_message", {
      message_board_id: messageBoardId,
      subject: `MCP trash host ${Date.now()}`,
      content: "<div>Host message for the trash test.</div>",
      status: "active",
    });
    const messageId = extractId(messageText);
    toTrash.push(messageId);
    const commentText = await mcp.text("basecamp_create_comment", {
      recording_id: messageId,
      content: "<p>Comment to trash.</p>",
    });
    const commentId = extractId(commentText);

    const client = await initializeBasecampClient();
    await mcp.text("basecamp_trash", { recording_id: commentId });
    expect((await client.comments.get(commentId)).status).toBe("trashed");

    await mcp.text("basecamp_restore", { recording_id: commentId });
    expect((await client.comments.get(commentId)).status).toBe("active");
  });

  it("returns an error for an unknown ID", async () => {
    const result = await mcp.call("basecamp_trash", { recording_id: 1 });
    expect(result.content[0].text ?? "").not.toContain("Moved to the trash");
    expect(result.content[0].text ?? "").toMatch(/not found/i);
  });
});
