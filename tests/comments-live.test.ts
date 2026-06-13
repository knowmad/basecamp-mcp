import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveDockId,
  trashRecordings,
} from "./utils";

type Comment = {
  id: number;
  creator: { id: number; name: string } | null;
  content: string;
  created_at: string;
};

let mcp: McpTestClient;
let projectId: number;
let messageBoardId: number;
let parentId: number;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const boardId = await resolveDockId(mcp, projectId, "message_board");
  if (boardId == null) {
    throw new Error(
      `Sandbox project ${projectId} has no message board enabled; cannot seed a parent recording for comment tests.`,
    );
  }
  messageBoardId = boardId;

  // Seed a parent recording (a message) to comment on.
  const createText = await mcp.text("basecamp_create_message", {
    message_board_id: messageBoardId,
    subject: `MCP comments parent ${Date.now()}`,
    content: "<div>Parent message for the MCP comments lifecycle test.</div>",
  });
  expect(createText).toContain("Message created successfully!");
  parentId = extractId(createText);
  toTrash.push(parentId);
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("Basecamp comments via MCP tools (live)", () => {
  it("creates, lists, and updates comments on a recording", async () => {
    const marker = Date.now();
    const initialBody = `Automated comment ${marker}`;

    // CREATE
    const createText = await mcp.text("basecamp_create_comment", {
      recording_id: parentId,
      content: `<div>${initialBody}</div>`,
    });
    expect(createText).toContain("Comment posted!");
    const commentId = extractId(createText);
    toTrash.push(commentId);

    // LIST: created comment present, content matches
    const comments = await mcp.json<Comment[]>("basecamp_list_comments", {
      recording_id: parentId,
    });
    expect(Array.isArray(comments)).toBe(true);
    const created = comments.find((c) => c.id === commentId);
    expect(created).toBeDefined();
    expect(created?.content).toContain(initialBody);

    // UPDATE: full content replacement
    const replacedBody = `Replaced comment ${marker}`;
    const updateText = await mcp.text("basecamp_update_comment", {
      comment_id: commentId,
      content: `<div>${replacedBody}</div>`,
    });
    expect(updateText).toContain("Comment updated successfully!");
    expect(extractId(updateText)).toBe(commentId);

    const afterReplace = await mcp.json<Comment[]>("basecamp_list_comments", {
      recording_id: parentId,
    });
    const replaced = afterReplace.find((c) => c.id === commentId);
    expect(replaced?.content).toContain(replacedBody);
    expect(replaced?.content).not.toContain(initialBody);

    // UPDATE: partial content op (append). Fetches current content first,
    // appends, then writes back.
    const appended = ` appended-${marker}`;
    const appendText = await mcp.text("basecamp_update_comment", {
      comment_id: commentId,
      content_append: appended,
    });
    expect(appendText).toContain("Comment updated successfully!");

    const afterAppend = await mcp.json<Comment[]>("basecamp_list_comments", {
      recording_id: parentId,
    });
    const appendedComment = afterAppend.find((c) => c.id === commentId);
    // Both the previously-replaced body and the appended fragment survive.
    expect(appendedComment?.content).toContain(replacedBody);
    expect(appendedComment?.content).toContain(`appended-${marker}`);

    // UPDATE: partial content op (search_replace) operating on current content.
    const searchReplaceText = await mcp.text("basecamp_update_comment", {
      comment_id: commentId,
      search_replace: [
        { find: replacedBody, replace: `Final comment ${marker}` },
      ],
    });
    expect(searchReplaceText).toContain("Comment updated successfully!");

    const afterSearchReplace = await mcp.json<Comment[]>(
      "basecamp_list_comments",
      { recording_id: parentId },
    );
    const finalComment = afterSearchReplace.find((c) => c.id === commentId);
    expect(finalComment?.content).toContain(`Final comment ${marker}`);
    expect(finalComment?.content).not.toContain(replacedBody);
  });
});
