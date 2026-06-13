import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveDockId,
  trashRecordings,
} from "./utils";

type Message = {
  id: number;
  subject: string;
  content: string;
  author?: { id: number; name: string } | null;
  created_at?: string;
  updated_at?: string;
  url?: string;
};

type MessageListItem = {
  id: number;
  title: string;
};

type Category = { id: number; name: string };

let mcp: McpTestClient;
let projectId: number;
let messageBoardId: number;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const resolved = await resolveDockId(mcp, projectId, "message_board");
  if (resolved == null) {
    throw new Error(
      `Sandbox project ${projectId} has no message board enabled; cannot run message tests.`,
    );
  }
  messageBoardId = resolved;
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("Basecamp message board via MCP tools (live)", () => {
  // basecamp_list_message_types intentionally still takes bucket_id (the SDK's
  // messageTypes.list() 404s; a low-level /buckets/{id}/categories.json is used).
  it("lists message types (categories) for the project", async () => {
    const categories = await mcp.json<Category[]>(
      "basecamp_list_message_types",
      { bucket_id: projectId },
    );
    expect(Array.isArray(categories)).toBe(true);
    if (categories.length > 0) {
      expect(typeof categories[0].id).toBe("number");
      expect(typeof categories[0].name).toBe("string");
    }
  });

  it("creates (active), reads, lists, and updates a message", async () => {
    // Capture a category id if the project has any, to exercise category handling.
    const categories = await mcp.json<Category[]>(
      "basecamp_list_message_types",
      { bucket_id: projectId },
    );
    const categoryId = categories[0]?.id;

    const subject = `MCP message lifecycle ${Date.now()}`;
    const content =
      "<div>Automated message for the MCP message-board lifecycle test.</div>";

    // CREATE (active/visible)
    const createText = await mcp.text("basecamp_create_message", {
      message_board_id: messageBoardId,
      subject,
      content,
      status: "active",
      ...(categoryId ? { message_type_id: categoryId } : {}),
    });
    expect(createText).toContain("Message created successfully!");
    expect(createText).toContain("ID:");
    const messageId = extractId(createText);
    toTrash.push(messageId);

    // READ — subject + content round-trip. When the message has a category,
    // Basecamp prefixes the category icon (emoji) to the returned title, so we
    // assert the subject is contained rather than strictly equal.
    const message = await mcp.json<Message>("basecamp_get_message", {
      message_id: messageId,
    });
    expect(message.id).toBe(messageId);
    expect(message.subject).toContain(subject);
    expect(message.content).toContain("Automated message for the MCP");

    // LIST — created message is present (proves it is active/visible)
    const messages = await mcp.json<MessageListItem[]>(
      "basecamp_list_messages",
      {
        message_board_id: messageBoardId,
      },
    );
    expect(
      messages.some((m) => m.id === messageId && m.title.includes(subject)),
    ).toBe(true);

    // UPDATE — full subject + content replacement
    const newSubject = `${subject} (updated)`;
    const newContent = "<div>Updated body via full replacement.</div>";
    const updateText = await mcp.text("basecamp_update_message", {
      message_id: messageId,
      subject: newSubject,
      content: newContent,
    });
    expect(updateText.toLowerCase()).toContain("updated successfully");

    const afterUpdate = await mcp.json<Message>("basecamp_get_message", {
      message_id: messageId,
    });
    expect(afterUpdate.subject).toContain(newSubject);
    expect(afterUpdate.content).toContain("Updated body via full replacement");

    // UPDATE — partial content op (append) without resending full body
    const appendText = await mcp.text("basecamp_update_message", {
      message_id: messageId,
      content_append: "<div>Appended paragraph.</div>",
    });
    expect(appendText.toLowerCase()).toContain("updated successfully");

    const afterAppend = await mcp.json<Message>("basecamp_get_message", {
      message_id: messageId,
    });
    // Both the prior body and the appended fragment must be present.
    expect(afterAppend.content).toContain("Updated body via full replacement");
    expect(afterAppend.content).toContain("Appended paragraph.");

    // UPDATE — partial content op (search_replace)
    const replaceText = await mcp.text("basecamp_update_message", {
      message_id: messageId,
      search_replace: [
        { find: "Appended paragraph.", replace: "Replaced paragraph." },
      ],
    });
    expect(replaceText.toLowerCase()).toContain("updated successfully");

    const afterReplace = await mcp.json<Message>("basecamp_get_message", {
      message_id: messageId,
    });
    expect(afterReplace.content).toContain("Replaced paragraph.");
    expect(afterReplace.content).not.toContain("Appended paragraph.");
  });
});
