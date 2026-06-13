import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestClient,
  type McpTestClient,
  requireEnv,
  resolveDockId,
} from "./utils";

/**
 * Live coverage for the Campfire (chat) dock (src/tools/campfires.ts).
 *
 * Scopes every call to the sandbox project's own campfire (its "chat" dock) via
 * `campfire_ids`, plus a `since` window, so the line pagination stays bounded —
 * an unscoped "list every message in every campfire" call can be enormous. The
 * sandbox project must be ACTIVE: the tool resolves `campfire_ids` against
 * `campfires.list()`, which only returns campfires from active projects.
 */

type CampfireMessage = {
  id: number;
  content?: string | null;
  created_at: string;
  url?: string;
  creator?: { id: number; name?: string; email?: string } | null;
  campfire?: { id?: number; name?: string };
  project?: { id?: number; name?: string };
};

type MessagesResult = {
  messages: CampfireMessage[];
  total_fetched: number;
  returned: number;
  truncated?: boolean;
};

let mcp: McpTestClient;
let campfireId: number;

beforeAll(async () => {
  mcp = await createTestClient();
  const projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const chatId = await resolveDockId(mcp, projectId, "chat");
  if (chatId == null) {
    throw new Error(
      `Sandbox project ${projectId} has no campfire (chat) dock; cannot run campfire tests.`,
    );
  }
  campfireId = chatId;
});

afterAll(async () => {
  await mcp?.close();
});

function expectMessagesShape(result: MessagesResult): void {
  expect(Array.isArray(result.messages)).toBe(true);
  expect(typeof result.total_fetched).toBe("number");
  expect(typeof result.returned).toBe("number");
  expect(result.returned).toBe(result.messages.length);
}

describe("Basecamp campfire messages via MCP tools (live)", () => {
  it("lists messages for a specific campfire with the expected shape", async () => {
    const result = await mcp.json<MessagesResult>(
      "basecamp_list_campfire_messages",
      { campfire_ids: [campfireId], since: "365d", limit: 20 },
    );
    expectMessagesShape(result);

    for (const m of result.messages) {
      expect(typeof m.id).toBe("number");
      expect(typeof m.created_at).toBe("string");
      // normalizePersonIds coerces string sender ids from the low-level path.
      if (m.creator) {
        expect(typeof m.creator.id).toBe("number");
      }
      // Scoped to a single campfire — every line belongs to it.
      if (m.campfire?.id !== undefined) {
        expect(m.campfire.id).toBe(campfireId);
      }
    }
  });

  it("respects a small limit", async () => {
    const limit = 2;
    // `since` bounds the line pagination; the arbitrary first campfire could
    // otherwise have a very long history. The limit assertion holds regardless.
    const result = await mcp.json<MessagesResult>(
      "basecamp_list_campfire_messages",
      { campfire_ids: [campfireId], since: "365d", limit },
    );
    expect(result.returned).toBeLessThanOrEqual(limit);
    if (result.total_fetched > limit) {
      expect(result.truncated).toBe(true);
    }
  });

  it("applies the since cutoff (newest-first early termination)", async () => {
    const result = await mcp.json<MessagesResult>(
      "basecamp_list_campfire_messages",
      { campfire_ids: [campfireId], since: "7d" },
    );
    expectMessagesShape(result);

    const cutoff = Date.now() - 7 * 86400000;
    for (const m of result.messages) {
      expect(new Date(m.created_at).getTime()).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it("returns a clear error for an unknown campfire id", async () => {
    const result = await mcp.json<{ error?: string }>(
      "basecamp_list_campfire_messages",
      { campfire_ids: [1] },
    );
    expect(result.error).toBeTruthy();
  });
});
