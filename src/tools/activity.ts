/**
 * Activity browsing tools for Basecamp MCP server
 *
 * Uses the Basecamp recordings API to provide activity browsing:
 * listing recent changes across projects with filtering by type,
 * date range, person, project, and text search.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { CHARACTER_LIMIT, DEFAULT_LIMIT } from "../constants.js";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

/** Default recording types to fetch when no type filter is specified */
const DEFAULT_RECORDING_TYPES = [
  "Todo",
  "Message",
  "Document",
  "Comment",
  "Upload",
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
};

/**
 * Parse a "since" value into a Date object.
 *
 * Supports:
 * - Relative durations: "24h", "7d", "2w"
 * - Keywords: "today", "yesterday"
 * - ISO 8601 dates: "2024-01-15", "2024-01-15T10:00:00Z"
 */
function parseSince(value: string): Date {
  const now = new Date();
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  // Relative durations: Nh, Nd, Nw
  const hourMatch = lower.match(/^(\d+)h$/);
  if (hourMatch) {
    return new Date(
      now.getTime() - Number.parseInt(hourMatch[1], 10) * 3600000,
    );
  }

  const dayMatch = lower.match(/^(\d+)d$/);
  if (dayMatch) {
    return new Date(
      now.getTime() - Number.parseInt(dayMatch[1], 10) * 86400000,
    );
  }

  const weekMatch = lower.match(/^(\d+)w$/);
  if (weekMatch) {
    return new Date(
      now.getTime() - Number.parseInt(weekMatch[1], 10) * 7 * 86400000,
    );
  }

  // Keywords
  if (lower === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (lower === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ISO 8601 / date string
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid since value: "${value}". ` +
        'Use ISO 8601 (e.g., "2024-01-15"), relative duration (e.g., "24h", "7d", "2w"), ' +
        'or keyword ("today", "yesterday").',
    );
  }
  return parsed;
}

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

All filters except query support multiple values for OR-matching.

Examples:
  - "What happened in the last 24 hours?" → since: "24h"
  - "Show recent todos in project 12345" → project_ids: [12345], type: ["todo"]
  - "What did Alice and Bob do this week?" → person_ids: [111, 222], since: "7d"
  - "Find messages mentioning launch across projects 1 and 2" → project_ids: [1, 2], type: ["message"], query: "launch"
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
              "Omit to fetch all common types (todo, message, document, comment, upload).",
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
          .string()
          .optional()
          .describe("Case-insensitive text search against recording titles."),
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

        // Fetch recordings for each type in parallel via the client library
        const fetchPromises = types.map((type) =>
          asyncPagedToArray({
            fetchPage: client.recordings.list,
            request: {
              query: { type, ...baseQuery },
            },
          }),
        );

        const results = await Promise.all(fetchPromises);
        let filtered = results.flat();

        // Filter by since date
        if (params.since) {
          const sinceDate = parseSince(params.since);
          const sortField = params.sort || "created_at";
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

        // Filter by text search (case-insensitive substring match on title)
        if (params.query) {
          const lowerQuery = params.query.toLowerCase();
          filtered = filtered.filter((r) =>
            r.title.toLowerCase().includes(lowerQuery),
          );
        }

        // Sort merged results
        const sortField = params.sort || "created_at";
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
          creator: r.creator
            ? {
                id: r.creator.id,
                name: r.creator.name,
                email: r.creator.email_address,
              }
            : null,
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
