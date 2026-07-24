/**
 * Campfire (chat) browsing tool for Basecamp MCP server.
 *
 * Campfires are real-time chat rooms within projects. Chat lines are NOT
 * recordings, so this lives separately from the activity/recordings feed; it
 * only shares the cross-cutting pagination/since helpers.
 */

import type { CampfireLine } from "@37signals/basecamp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHARACTER_LIMIT, DEFAULT_LIMIT } from "../constants.js";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { paginate } from "../utils/pagination.js";
import { parseSince } from "../utils/parseSince.js";
import { serializeCreator } from "../utils/serializers.js";

/**
 * Register campfire (chat) browsing tools with the MCP server
 */
export function registerCampfireTools(server: McpServer): void {
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
          campfireId: number;
          campfireName: string;
          projectName: string;
        }> = [];

        if (params.campfire_ids && params.campfire_ids.length > 0) {
          // Fetch all campfires to resolve the requested campfire IDs
          const allCampfires = await client.campfires.list();

          const campfireIdSet = new Set(params.campfire_ids);
          campfiresToFetch = allCampfires
            .filter((c) => campfireIdSet.has(c.id))
            .map((c) => ({
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
          const allCampfires = await client.campfires.list();
          for (const campfire of allCampfires) {
            // Skip campfires that haven't been updated since the filter date
            if (sinceDate) {
              const campfireUpdatedAt = new Date(campfire.updated_at);
              if (campfireUpdatedAt < sinceDate) {
                continue;
              }
            }
            campfiresToFetch.push({
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
          async ({ campfireId, campfireName, projectName }) => {
            const lines: Array<
              CampfireLine & {
                campfire_name: string;
                project_name: string;
              }
            > = [];

            for await (const line of paginate<CampfireLine>(
              client,
              "/chats/{campfireId}/lines.json",
              { path: { campfireId } },
            )) {
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
            const lowerContent = (line.content || "").toLowerCase();
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
          creator: serializeCreator(line.creator),
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
