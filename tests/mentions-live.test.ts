import { mentionedPersonIds } from "@37signals/basecamp";
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
let messageBoardId: number;
let todosetId: number;
let myId: number;
let mySgid: string;
let messageId: number;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  const projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const board = await resolveDockId(mcp, projectId, "message_board");
  const todoset = await resolveDockId(mcp, projectId, "todoset");
  if (board == null || todoset == null) {
    throw new Error(
      `Sandbox project ${projectId} needs a message board and a todoset for mention tests.`,
    );
  }
  messageBoardId = board;
  todosetId = todoset;

  const me = await mcp.json<{ id: number; attachable_sgid: string }>(
    "basecamp_get_me",
  );
  myId = me.id;
  mySgid = me.attachable_sgid;

  const createText = await mcp.text("basecamp_create_message", {
    message_board_id: messageBoardId,
    subject: `MCP mentions host ${Date.now()}`,
    content: "<div>Host message for the mention tests.</div>",
    status: "active",
  });
  messageId = extractId(createText);
  toTrash.push(messageId);
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("Mentions by person ID (live)", () => {
  it("mentions a person in a new comment, in the middle of a sentence", async () => {
    const text = await mcp.text("basecamp_create_comment", {
      recording_id: messageId,
      content: `<p>Thanks <bc-attachment person-id="${myId}"></bc-attachment> for the fix.</p>`,
    });
    const commentId = extractId(text);
    toTrash.push(commentId);

    const client = await initializeBasecampClient();
    const content = (await client.comments.get(commentId)).content ?? "";
    expect(mentionedPersonIds(content)).toEqual([myId]);
    // The mention stays where the tag was.
    expect(content.indexOf("Thanks")).toBeLessThan(
      content.indexOf("<bc-attachment"),
    );
    expect(content).toContain("for the fix.");
    expect(content).not.toMatch(/[\s<]person-id=/);
  });

  it("accepts a self-closing tag and single quotes, and mentions each person one time", async () => {
    const text = await mcp.text("basecamp_create_todo", {
      todolist_id: await createList(),
      title: `MCP mention todo ${Date.now()}`,
      content: `<div>Ask <bc-attachment person-id='${myId}'/> and <bc-attachment person-id="${myId}"></bc-attachment>.</div>`,
    });
    const todoId = extractId(text);

    const client = await initializeBasecampClient();
    const description = (await client.todos.get(todoId)).description ?? "";
    expect(mentionedPersonIds(description)).toEqual([myId]);
    expect(description).not.toMatch(/[\s<]person-id=/);
  });

  it("expands mentions in content_append and in search_replace, not in find", async () => {
    await mcp.text("basecamp_update_message", {
      message_id: messageId,
      content_append: `<div>Owner: <bc-attachment person-id="${myId}"></bc-attachment></div>`,
    });

    const client = await initializeBasecampClient();
    let content = (await client.messages.get(messageId)).content ?? "";
    expect(mentionedPersonIds(content)).toEqual([myId]);

    await mcp.text("basecamp_update_message", {
      message_id: messageId,
      search_replace: [
        {
          find: "Host message",
          replace: `Host message from <bc-attachment person-id="${myId}"></bc-attachment>`,
        },
      ],
    });
    content = (await client.messages.get(messageId)).content ?? "";
    expect(content).toContain("Host message from");
    expect(content).not.toMatch(/[\s<]person-id=/);
    expect(mentionedPersonIds(content)).toEqual([myId]);
  });

  it("returns an error and writes nothing when the ID is not a person", async () => {
    const client = await initializeBasecampClient();
    const before = (await client.comments.list(messageId)).length;

    const result = await mcp.call("basecamp_create_comment", {
      recording_id: messageId,
      content: '<p>Hi <bc-attachment person-id="1"></bc-attachment></p>',
    });
    const text = result.content[0].text ?? "";
    expect(text).toContain("Cannot mention person 1");
    expect(text).toContain("Nothing was written");

    expect((await client.comments.list(messageId)).length).toBe(before);
  });

  it("keeps a mention that uses an sgid", async () => {
    const text = await mcp.text("basecamp_create_comment", {
      recording_id: messageId,
      content: `<p>Hi <bc-attachment sgid="${mySgid}" content-type="application/vnd.basecamp.mention"></bc-attachment></p>`,
    });
    const commentId = extractId(text);
    toTrash.push(commentId);

    const client = await initializeBasecampClient();
    const content = (await client.comments.get(commentId)).content ?? "";
    expect(mentionedPersonIds(content)).toEqual([myId]);
  });
});

/** Create a todo list for a test, and trash it in teardown. */
async function createList(): Promise<number> {
  const text = await mcp.text("basecamp_create_todolist", {
    todoset_id: todosetId,
    name: `MCP mention list ${Date.now()}`,
  });
  const id = extractId(text);
  toTrash.push(id);
  return id;
}
