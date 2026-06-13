/**
 * Activity feed tool for Basecamp MCP server.
 *
 * Uses the Basecamp recordings API to provide a cross-project activity feed:
 * listing recent changes across projects with filtering by type, date range,
 * person, project, and text search. Campfire chat browsing lives in
 * `campfires.ts` — chat lines are not recordings and share only the shared
 * pagination/since helpers.
 */

import type { Recording } from "@37signals/basecamp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHARACTER_LIMIT, DEFAULT_LIMIT } from "../constants.js";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { paginate } from "../utils/pagination.js";
import { parseSince } from "../utils/parseSince.js";
import { serializeCreator } from "../utils/serializers.js";

/** Default recording types to fetch when no type filter is specified */
const DEFAULT_RECORDING_TYPES = [
  "Todo",
  "Message",
  "Document",
  "Comment",
  "Upload",
  "Kanban::Card",
];

/** Map of friendly type aliases to canonical Basecamp API type names */
const TYPE_ALIASES: Record<string, string> = {
  todo: "Todo",
  todos: "Todo",
  message: "Message",
  messages: "Message",
  msg: "Message",
  document: "Document",
  doc: "Document",
  docs: "Document",
  comment: "Comment",
  comments: "Comment",
  upload: "Upload",
  uploads: "Upload",
  file: "Upload",
  files: "Upload",
  todolist: "Todolist",
  question: "Question::Answer",
  answer: "Question::Answer",
  event: "Schedule::Entry",
  schedule: "Schedule::Entry",
  vault: "Vault",
  card: "Kanban::Card",
  cards: "Kanban::Card",
  kanban: "Kanban::Card",
  step: "Kanban::Step",
  steps: "Kanban::Step",
};

/**
 * Resolve an array of type strings (possibly using aliases)
 * to deduplicated canonical Basecamp API type names.
 */
function resolveTypes(types: string[]): string[] {
  const resolved = new Set<string>();
  for (const t of types) {
    const lower = t.trim().toLowerCase();
    resolved.add(TYPE_ALIASES[lower] || t.trim());
  }
  return [...resolved];
}

/**
 * Register all activity-related tools with the MCP server
 */
export function registerActivityTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_recordings",
    {
      title: "List Basecamp Activity (Recordings)",
      description: `Browse recent activity across Basecamp by listing recordings. Recordings represent all content in Basecamp: todos, messages, documents, comments, uploads, and more.

Use this tool to:
- See what's been happening across all projects or specific projects
- Find recent activity by one or more people
- Review changes since a specific date or time period
- Filter activity by content type (todos, messages, documents, etc.)
- Search activity by title text

When to use this vs. the per-resource list tools: use the per-project list tools (basecamp_list_messages, basecamp_list_todos, basecamp_list_documents, basecamp_list_comments, basecamp_list_kanban_cards) to browse items WITHIN a single project; use basecamp_list_recordings for CROSS-project, time-based, or multi-type activity browsing.

All filters support multiple values for OR-matching.

Examples:
  - "What happened in the last 24 hours?" → since: "24h"
  - "Show recent todos in project 12345" → project_ids: [12345], type: ["todo"]
  - "What did Alice and Bob do this week?" → person_ids: [111, 222], since: "7d"
  - "Find messages mentioning launch across projects 1 and 2" → project_ids: [1, 2], type: ["message"], query: ["launch"]
  - "Find items about design or UX" → query: ["design", "UX"]
  - "List all messages across projects" → type: ["message"]`,
      inputSchema: {
        project_ids: z
          .array(BasecampIdSchema)
          .optional()
          .describe(
            "Filter to specific projects (bucket IDs). Supports multiple IDs for OR-matching. Omit to browse across all projects.",
          ),
        type: z
          .array(z.string())
          .optional()
          .describe(
            'Recording type filter. Options: "todo", "message", "document", "comment", "upload", ' +
              '"todolist", "question", "schedule", "vault". ' +
              "Supports multiple values for OR-matching. " +
              "Omit to fetch all common types (todo, message, document, comment, upload, card).",
          ),
        since: z
          .string()
          .optional()
          .describe(
            'Show activity since this time. Accepts ISO 8601 dates (e.g., "2024-01-15"), ' +
              'relative durations ("24h", "7d", "2w"), or keywords ("today", "yesterday").',
          ),
        person_ids: z
          .array(BasecampIdSchema)
          .optional()
          .describe(
            "Filter by creator person IDs. Supports multiple IDs for OR-matching. Use basecamp_list_people to find person IDs.",
          ),
        query: z
          .array(z.string())
          .optional()
          .describe(
            "Case-insensitive text search against recording titles. Supports multiple terms for OR-matching.",
          ),
        sort: z
          .enum(["created_at", "updated_at"])
          .optional()
          .describe('Sort field: "created_at" (default) or "updated_at".'),
        direction: z
          .enum(["desc", "asc"])
          .optional()
          .describe(
            'Sort direction: "desc" (default, newest first) or "asc" (oldest first).',
          ),
        status: z
          .enum(["active", "archived", "trashed"])
          .optional()
          .describe(
            'Recording status filter: "active" (default), "archived", or "trashed".',
          ),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe(
            `Maximum number of recordings to return (default: ${DEFAULT_LIMIT}, max: 100).`,
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await initializeBasecampClient();

        // Determine which types to fetch
        const types = params.type
          ? resolveTypes(params.type)
          : DEFAULT_RECORDING_TYPES;

        // Build shared query params
        const baseQuery: Record<string, string | undefined> = {};
        if (params.project_ids && params.project_ids.length > 0) {
          baseQuery.bucket = params.project_ids.join(",");
        }
        if (params.sort) {
          baseQuery.sort = params.sort;
        }
        if (params.direction) {
          baseQuery.direction = params.direction;
        }
        if (params.status) {
          baseQuery.status = params.status;
        }

        // Parse since date upfront if provided
        const sinceDate = params.since ? parseSince(params.since) : null;
        const sortField = params.sort || "created_at";

        // Fetch recordings for each type in parallel, with early termination if since is set
        const fetchPromises = types.map(async (type) => {
          const items: Recording[] = [];

          for await (const item of paginate<Recording>(
            client,
            "/projects/recordings.json",
            { query: { type, ...baseQuery } },
          )) {
            // If filtering by date and results are sorted desc (default),
            // stop once we hit records older than the cutoff
            if (sinceDate && params.direction !== "asc") {
              const itemDate = new Date(
                sortField === "updated_at" ? item.updated_at : item.created_at,
              );
              if (itemDate < sinceDate) {
                break;
              }
            }
            items.push(item);
          }
          return items;
        });

        const results = await Promise.all(fetchPromises);
        let filtered = results.flat();

        // If direction is asc, we couldn't do early termination, so filter now
        if (sinceDate && params.direction === "asc") {
          filtered = filtered.filter((r) => {
            const date = new Date(
              sortField === "updated_at" ? r.updated_at : r.created_at,
            );
            return date >= sinceDate;
          });
        }

        // Filter by person IDs (OR-match)
        if (params.person_ids && params.person_ids.length > 0) {
          const personIdSet = new Set(params.person_ids);
          filtered = filtered.filter(
            (r) => r.creator && personIdSet.has(r.creator.id),
          );
        }

        // Filter by text search (case-insensitive substring match on title, OR-matching)
        if (params.query && params.query.length > 0) {
          const lowerQueries = params.query.map((q) => q.toLowerCase());
          filtered = filtered.filter((r) => {
            const lowerTitle = r.title.toLowerCase();
            return lowerQueries.some((q) => lowerTitle.includes(q));
          });
        }

        // Sort merged results
        const sortDir = params.direction || "desc";
        filtered.sort((a, b) => {
          const dateA = new Date(
            sortField === "updated_at" ? a.updated_at : a.created_at,
          ).getTime();
          const dateB = new Date(
            sortField === "updated_at" ? b.updated_at : b.created_at,
          ).getTime();
          return sortDir === "desc" ? dateB - dateA : dateA - dateB;
        });

        // Apply limit
        const limit = params.limit || DEFAULT_LIMIT;
        const total = filtered.length;
        filtered = filtered.slice(0, limit);

        // Serialize response
        const serialized = filtered.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          url: r.app_url,
          creator: serializeCreator(r.creator),
          project: r.bucket
            ? {
                id: r.bucket.id,
                name: r.bucket.name,
              }
            : null,
          ...(r.parent
            ? {
                parent: {
                  id: r.parent.id,
                  title: r.parent.title,
                  type: r.parent.type,
                },
              }
            : {}),
        }));

        const result: Record<string, unknown> = {
          recordings: serialized,
          total_fetched: total,
          returned: serialized.length,
        };

        if (total > limit) {
          result.truncated = true;
          result.truncation_message = `Showing ${limit} of ${total} recordings. Increase limit or narrow filters to see more.`;
        }

        let jsonStr = JSON.stringify(result, null, 2);

        // Handle response size limit
        if (jsonStr.length > CHARACTER_LIMIT) {
          const reducedLimit = Math.floor(serialized.length / 2);
          const reduced = serialized.slice(0, reducedLimit);
          jsonStr = JSON.stringify(
            {
              recordings: reduced,
              total_fetched: total,
              returned: reduced.length,
              truncated: true,
              truncation_message: `Response truncated to ${reduced.length} recordings due to size limits. Use more specific filters or a smaller limit.`,
            },
            null,
            2,
          );
        }

        return {
          content: [{ type: "text", text: jsonStr }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );
}
