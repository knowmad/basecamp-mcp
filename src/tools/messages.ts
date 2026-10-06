/**
 * Message Board tools for Basecamp MCP server
 *
 * Includes special patch support for updating messages without passing full content
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import {
  applyContentOperations,
  ContentOperationFields,
  htmlRules,
  validateContentOperations,
} from "../utils/contentOperations.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import {
  expandPersonMentions,
  expandPersonMentionsInOperations,
} from "../utils/mentions.js";
import { paginate } from "../utils/pagination.js";
import { serializePerson } from "../utils/serializers.js";

/** One entry from GET /my/drafts.json (shape per bc3-api sections/drafts.md). */
type Draft = {
  id: number;
  type: string;
  title: string;
  app_url: string;
  bucket?: { id: number; name: string } | null;
  parent?: { id: number; title: string } | null;
  excerpt?: string;
  created_at?: string;
  updated_at?: string;
  scheduled_posting_at?: string | null;
};

export function registerMessageTools(server: McpServer): void {
  // basecamp_get_message
  server.registerTool(
    "basecamp_get_message",
    {
      title: "Get Basecamp Message",
      description: `Retrieve a single message from a Basecamp message board. "status" is "drafted" for an unpublished draft (not posted, nobody notified) or "active" once published.`,
      inputSchema: {
        message_id: BasecampIdSchema.describe("Message ID to retrieve"),
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
        const msg = await client.messages.get(params.message_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: msg.id,
                  subject: msg.title,
                  content: msg.content || "",
                  status: msg.status,
                  inherits_status: msg.inherits_status,
                  author: serializePerson(msg.creator),
                  created_at: msg.created_at,
                  updated_at: msg.updated_at,
                  url: msg.app_url,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );

  // basecamp_list_messages
  server.registerTool(
    "basecamp_list_messages",
    {
      title: "List Basecamp Messages",
      description: `List messages in a Basecamp message board (a single project). For cross-project or time-based browsing across content types, use basecamp_list_recordings instead.`,
      inputSchema: {
        message_board_id: BasecampIdSchema.describe("Message board ID"),
        filter: z
          .string()
          .optional()
          .describe(
            "Optional regular expression to filter messages by title or content",
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
        const messages = await client.messages.list(params.message_board_id);

        // Apply filter if provided
        let filteredMessages = [...messages];
        if (params.filter) {
          const regex = new RegExp(params.filter, "i");
          filteredMessages = messages.filter(
            (m) => regex.test(m.title) || regex.test(m.content || ""),
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                filteredMessages.map((m) => ({
                  id: m.id,
                  title: m.title,
                  status: m.status,
                  inherits_status: m.inherits_status,
                  creator: serializePerson(m.creator),
                  created_at: m.created_at,
                })),
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );

  // basecamp_list_drafts
  server.registerTool(
    "basecamp_list_drafts",
    {
      title: "List My Basecamp Drafts",
      description: `List the current user's unpublished drafts across their active projects, most recently updated first: messages, documents, uploads, client approvals, and client correspondences. Every item returned is a draft (not posted, nobody notified). Not exhaustive: Google documents, cloud files, and schedule entries can also be drafted but are not listed here.`,
      inputSchema: {
        limit: z
          .number()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(
            `Maximum number of drafts to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT}).`,
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
        const limit = params.limit || DEFAULT_LIMIT;

        // SDK 0.7.3 has no drafts wrapper; page the endpoint directly.
        const drafts: Draft[] = [];
        for await (const draft of paginate<Draft>(
          client,
          "/my/drafts.json",
          {},
        )) {
          drafts.push(draft);
          if (drafts.length >= limit) break;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                drafts.map((d) => ({
                  id: d.id,
                  type: d.type,
                  title: d.title,
                  bucket: d.bucket
                    ? { id: d.bucket.id, name: d.bucket.name }
                    : null,
                  parent: d.parent
                    ? { id: d.parent.id, title: d.parent.title }
                    : null,
                  excerpt: d.excerpt,
                  updated_at: d.updated_at,
                  scheduled_posting_at: d.scheduled_posting_at,
                  url: d.app_url,
                })),
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );

  // basecamp_list_message_types
  server.registerTool(
    "basecamp_list_message_types",
    {
      title: "List Basecamp Message Types",
      description: `List available message types/categories for a Basecamp project`,
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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

        // NOTE: The SDK's client.messageTypes.list() targets the account-level
        // /categories.json endpoint, which 404s — message types (categories)
        // are project-scoped. Hit the bucket-scoped endpoint via the low-level
        // client instead. (This path isn't in the SDK's typed schema, hence the
        // cast.)
        const { data, error } = await (
          client.GET as unknown as (
            path: string,
            init: { params: { path: { bucketId: number } } },
          ) => Promise<{
            data?: Array<{
              id: number;
              name: string;
              icon: string;
              created_at: string;
              updated_at: string;
            }>;
            error?: unknown;
          }>
        )("/buckets/{bucketId}/categories.json", {
          params: { path: { bucketId: params.bucket_id } },
        });

        if (error || !data) {
          throw new Error("Failed to fetch message types");
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                data.map((mt) => ({
                  id: mt.id,
                  name: mt.name,
                  icon: mt.icon,
                  created_at: mt.created_at,
                  updated_at: mt.updated_at,
                })),
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );

  // basecamp_create_message
  server.registerTool(
    "basecamp_create_message",
    {
      title: "Create Basecamp Message",
      description: `Create a new message in a Basecamp message board.`,
      inputSchema: {
        message_board_id: BasecampIdSchema,
        subject: z.string().min(1).max(500).describe("Message subject/title"),
        content: z
          .string()
          .optional()
          .describe(`HTML message content. ${htmlRules}`),
        message_type_id: BasecampIdSchema.optional().describe(
          "Optional message type/category ID",
        ),
        status: z
          .enum(["active", "drafted"])
          .default("active")
          .describe(
            `Message status. Use "active" to publish, "drafted" to save as an unpublished draft.`,
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await initializeBasecampClient();
        const message = await client.messages.create(params.message_board_id, {
          subject: params.subject,
          content:
            params.content === undefined
              ? undefined
              : await expandPersonMentions(client, params.content),
          categoryId: params.message_type_id,
          status: params.status,
        });

        return {
          content: [
            {
              type: "text",
              text: `Message created successfully!\n\nID: ${message.id}\nSubject: ${message.title}\nStatus: ${message.status}\nURL: ${message.app_url}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );

  server.registerTool(
    "basecamp_update_message",
    {
      title: "Update Basecamp Message",
      description: `Update a message. Use partial content operations when possible to save on token usage. ${htmlRules}`,
      inputSchema: {
        message_id: BasecampIdSchema,
        subject: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe("New message subject"),
        message_type_id: BasecampIdSchema.optional().describe(
          "Optional message type/category ID",
        ),
        ...ContentOperationFields,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Validate at least one operation is provided
        validateContentOperations(params, ["subject", "message_type_id"]);

        const client = await initializeBasecampClient();
        const operations = await expandPersonMentionsInOperations(
          client,
          params,
        );
        let finalContent: string | undefined;

        // Check if we need to fetch current content for partial operations
        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps || params.content !== undefined) {
          // Fetch current message if needed for partial operations
          if (hasPartialOps) {
            const current = await client.messages.get(params.message_id);
            const currentContent = current.content || "";
            finalContent = applyContentOperations(currentContent, operations);
          } else {
            // Full content replacement
            finalContent = operations.content;
          }
        }

        const message = await client.messages.update(params.message_id, {
          ...(params.subject ? { subject: params.subject } : {}),
          ...(finalContent !== undefined ? { content: finalContent } : {}),
          ...(params.message_type_id
            ? { categoryId: params.message_type_id }
            : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: `Message updated successfully!\n\nID: ${message.id}\nSubject: ${message.title}\nStatus: ${message.status}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );
}
