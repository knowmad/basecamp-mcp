/**
 * Activity browsing tools for Basecamp MCP server
 *
 * Uses the Basecamp recordings API to provide activity browsing:
 * listing recent changes across projects with filtering by type,
 * date range, person, project, and text search.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedIterator } from "basecamp-client";
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
          const items: Awaited<
            ReturnType<typeof client.recordings.list>
          >["body"][number][] = [];

          for await (const item of asyncPagedIterator({
            fetchPage: client.recordings.list,
            request: {
              query: { type, ...baseQuery },
            },
          })) {
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

  server.registerTool(
    "basecamp_list_campfire_messages",
    {
      title: "List Campfire Messages",
      description: `Browse chat messages from Basecamp Campfires. Campfires are real-time chat rooms within projects.

Use this tool to:
- See recent chat activity across all campfires or specific ones
- Find messages from specific people
- Search message content for keywords
- Review chat history since a specific date or time period

All filters support multiple values for OR-matching.

Examples:
  - "What's been discussed in chat today?" → since: "today"
  - "Show messages from Alice and Bob" → person_ids: [111, 222]
  - "Find chat messages mentioning deploy or release" → query: ["deploy", "release"]
  - "Recent messages in campfire 12345" → campfire_ids: [12345]`,
      inputSchema: {
        campfire_ids: z
          .array(BasecampIdSchema)
          .optional()
          .describe(
            "Filter to specific campfires by ID. Supports multiple IDs for OR-matching. Omit to browse all campfires.",
          ),
        person_ids: z
          .array(BasecampIdSchema)
          .optional()
          .describe(
            "Filter by sender person IDs. Supports multiple IDs for OR-matching. Use basecamp_list_people to find person IDs.",
          ),
        query: z
          .array(z.string())
          .optional()
          .describe(
            "Case-insensitive text search against message content. Supports multiple terms for OR-matching.",
          ),
        since: z
          .string()
          .optional()
          .describe(
            'Show messages since this time. Accepts ISO 8601 dates (e.g., "2024-01-15"), ' +
              'relative durations ("24h", "7d", "2w"), or keywords ("today", "yesterday").',
          ),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe(
            `Maximum number of messages to return (default: ${DEFAULT_LIMIT}, max: 100).`,
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

        // Parse since date upfront if provided
        const sinceDate = params.since ? parseSince(params.since) : null;

        // Determine which campfires to fetch from
        let campfiresToFetch: Array<{
          bucketId: number;
          campfireId: number;
          campfireName: string;
          projectName: string;
        }> = [];

        if (params.campfire_ids && params.campfire_ids.length > 0) {
          // Fetch all campfires to get bucket IDs for the requested campfire IDs
          const allCampfires: Awaited<
            ReturnType<typeof client.campfires.list>
          >["body"][number][] = [];

          for await (const campfire of asyncPagedIterator({
            fetchPage: client.campfires.list,
            request: {},
          })) {
            allCampfires.push(campfire);
          }

          const campfireIdSet = new Set(params.campfire_ids);
          campfiresToFetch = allCampfires
            .filter((c) => campfireIdSet.has(c.id))
            .map((c) => ({
              bucketId: c.bucket.id,
              campfireId: c.id,
              campfireName: c.title,
              projectName: c.bucket.name,
            }));

          if (campfiresToFetch.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "No campfires found matching the provided IDs.",
                      provided_ids: params.campfire_ids,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
        } else {
          // Fetch all campfires, filtering by updated_at if since is provided
          for await (const campfire of asyncPagedIterator({
            fetchPage: client.campfires.list,
            request: {},
          })) {
            // Skip campfires that haven't been updated since the filter date
            if (sinceDate) {
              const campfireUpdatedAt = new Date(campfire.updated_at);
              if (campfireUpdatedAt < sinceDate) {
                continue;
              }
            }
            campfiresToFetch.push({
              bucketId: campfire.bucket.id,
              campfireId: campfire.id,
              campfireName: campfire.title,
              projectName: campfire.bucket.name,
            });
          }

          if (campfiresToFetch.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { messages: [], total_fetched: 0, returned: 0 },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
        }

        // Fetch lines from each campfire in parallel
        const fetchPromises = campfiresToFetch.map(
          async ({ bucketId, campfireId, campfireName, projectName }) => {
            const lines: Array<
              Awaited<
                ReturnType<typeof client.campfires.listLines>
              >["body"][number] & {
                campfire_name: string;
                project_name: string;
              }
            > = [];

            for await (const line of asyncPagedIterator({
              fetchPage: client.campfires.listLines,
              request: {
                params: { bucketId, campfireId },
              },
            })) {
              // API returns newest first - early termination if since is set
              if (sinceDate) {
                const lineDate = new Date(line.created_at);
                if (lineDate < sinceDate) {
                  break;
                }
              }
              lines.push({
                ...line,
                campfire_name: campfireName,
                project_name: projectName,
              });
            }
            return lines;
          },
        );

        const results = await Promise.all(fetchPromises);
        let allLines = results.flat();

        // Filter by person IDs (OR-match)
        if (params.person_ids && params.person_ids.length > 0) {
          const personIdSet = new Set(params.person_ids);
          allLines = allLines.filter(
            (line) => line.creator && personIdSet.has(line.creator.id),
          );
        }

        // Filter by text search (case-insensitive substring match on content, OR-matching)
        if (params.query && params.query.length > 0) {
          const lowerQueries = params.query.map((q) => q.toLowerCase());
          allLines = allLines.filter((line) => {
            const lowerContent = line.content.toLowerCase();
            return lowerQueries.some((q) => lowerContent.includes(q));
          });
        }

        // Sort all messages by created_at desc (newest first)
        allLines.sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return dateB - dateA;
        });

        // Apply limit
        const limit = params.limit || DEFAULT_LIMIT;
        const total = allLines.length;
        allLines = allLines.slice(0, limit);

        // Serialize response
        const serialized = allLines.map((line) => ({
          id: line.id,
          content: line.content,
          created_at: line.created_at,
          url: line.app_url,
          creator: line.creator
            ? {
                id: line.creator.id,
                name: line.creator.name,
                email: line.creator.email_address,
              }
            : null,
          campfire: {
            id: line.parent?.id,
            name: line.campfire_name,
          },
          project: {
            id: line.bucket.id,
            name: line.project_name,
          },
        }));

        const result: Record<string, unknown> = {
          messages: serialized,
          total_fetched: total,
          returned: serialized.length,
        };

        if (total > limit) {
          result.truncated = true;
          result.truncation_message = `Showing ${limit} of ${total} messages. Increase limit or narrow filters to see more.`;
        }

        let jsonStr = JSON.stringify(result, null, 2);

        // Handle response size limit
        if (jsonStr.length > CHARACTER_LIMIT) {
          const reducedLimit = Math.floor(serialized.length / 2);
          const reduced = serialized.slice(0, reducedLimit);
          jsonStr = JSON.stringify(
            {
              messages: reduced,
              total_fetched: total,
              returned: reduced.length,
              truncated: true,
              truncation_message: `Response truncated to ${reduced.length} messages due to size limits. Use more specific filters or a smaller limit.`,
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
