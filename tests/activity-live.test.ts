import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, type McpTestClient, requireEnv } from "./utils";

/**
 * Live coverage for the Activity dock (src/tools/activity.ts).
 *
 * Exercises the heavily-rewritten custom `paginate()` generator, person-id
 * normalization, the since/early-termination path, and type-alias resolution.
 * Assertions are INVARIANTS, not exact counts — the shared sandbox account's
 * data shifts over time, and empty result sets are tolerated everywhere.
 */

type Recording = {
  id: number;
  type: string;
  title: string;
  status?: string;
  created_at: string;
  updated_at: string;
  url: string;
  creator?: { id: number; name?: string; email?: string } | null;
  project?: { id: number; name?: string } | null;
  parent?: { id: number; title: string; type: string };
};

type RecordingsResult = {
  recordings: Recording[];
  total_fetched: number;
  returned: number;
  truncated?: boolean;
};

let mcp: McpTestClient;
let projectId: number;

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));
});

afterAll(async () => {
  await mcp?.close();
});

/** Assert the common recordings envelope shape. */
function expectRecordingsShape(result: RecordingsResult): void {
  expect(Array.isArray(result.recordings)).toBe(true);
  expect(typeof result.total_fetched).toBe("number");
  expect(typeof result.returned).toBe("number");
  expect(result.returned).toBe(result.recordings.length);
}

describe("Basecamp activity via MCP tools (live)", () => {
  it("lists recent recordings (no type/project filter) with the expected shape", async () => {
    // Bounded with a tight `since` so the default-desc early-termination keeps
    // this otherwise-unfiltered, cross-project fetch fast against large accounts.
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        since: "14d",
      },
    );
    expectRecordingsShape(result);

    for (const r of result.recordings) {
      expect(typeof r.id).toBe("number");
      expect(typeof r.type).toBe("string");
      expect(typeof r.title).toBe("string");
      expect(typeof r.created_at).toBe("string");
      expect(typeof r.url).toBe("string");
    }
  });

  it("honors a single type filter (todo alias resolves to Todo)", async () => {
    // Scoped to the sandbox project: a bare type filter can't early-terminate,
    // so the `bucket` server-side filter keeps the fetch bounded (and fast).
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        project_ids: [projectId],
        type: ["todo"],
        limit: 20,
      },
    );
    expectRecordingsShape(result);
    // Type alias resolution: "todo" -> canonical "Todo".
    for (const r of result.recordings) {
      expect(r.type).toBe("Todo");
    }
  });

  it("honors a multi-type filter (each result is one of the requested types)", async () => {
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        project_ids: [projectId],
        type: ["message", "document"],
        limit: 20,
      },
    );
    expectRecordingsShape(result);
    for (const r of result.recordings) {
      expect(["Message", "Document"]).toContain(r.type);
    }
  });

  it("scopes results to the sandbox project when project_ids is set", async () => {
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        project_ids: [projectId],
        limit: 20,
      },
    );
    expectRecordingsShape(result);
    for (const r of result.recordings) {
      if (r.project) {
        expect(r.project.id).toBe(projectId);
      }
    }
  });

  it("respects limit + since, flags truncation, and applies the desc cutoff", async () => {
    const limit = 3;
    const since = "30d";
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        since,
        limit,
      },
    );
    expectRecordingsShape(result);
    expect(result.returned).toBeLessThanOrEqual(limit);

    if (result.total_fetched > limit) {
      expect(result.truncated).toBe(true);
    }

    // Default sort is created_at desc; the since path early-terminates, so every
    // returned recording must be at/after the cutoff.
    const cutoff = Date.now() - 30 * 86400000;
    for (const r of result.recordings) {
      expect(new Date(r.created_at).getTime()).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it("orders ascending by updated_at when direction is asc", async () => {
    // `asc` disables the date early-termination path entirely, so the only way
    // to bound the fetch is the server-side project (`bucket`) filter.
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        project_ids: [projectId],
        type: ["todo"],
        sort: "updated_at",
        direction: "asc",
        limit: 25,
      },
    );
    expectRecordingsShape(result);

    const times = result.recordings.map((r) =>
      new Date(r.updated_at).getTime(),
    );
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it("filters titles case-insensitively by query term", async () => {
    const term = "a";
    // Scoped to the sandbox project: a query filter alone fetches every default
    // type account-wide (which previously timed out). The filter path is still
    // exercised; an empty scoped result passes the per-item assertion vacuously.
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        project_ids: [projectId],
        query: [term],
        limit: 20,
      },
    );
    expectRecordingsShape(result);
    for (const r of result.recordings) {
      expect(r.title.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("normalizes creator person ids to numbers (paginate normalization)", async () => {
    // Cross-project (no project filter) to maximize the variety of creators the
    // low-level GET path normalizes; a tight `since` keeps the fetch bounded.
    const result = await mcp.json<RecordingsResult>(
      "basecamp_list_recordings",
      {
        since: "30d",
        limit: 50,
      },
    );
    expectRecordingsShape(result);
    for (const r of result.recordings) {
      if (r.creator) {
        // normalizePersonIds coerces string ids from the low-level GET path.
        expect(typeof r.creator.id).toBe("number");
      }
    }
  });
});
