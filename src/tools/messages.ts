/**
 * Message Board tools for Basecamp MCP server
 *
 * Includes special patch support for updating messages without passing full content
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import {
  applyContentOperations,
  ContentOperationFields,
  validateContentOperations,
} from "../utils/contentOperations.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

export function registerMessageTools(server: McpServer): void {
  // basecamp_get_message
  server.registerTool(
    "basecamp_get_message",
    {
      title: "Get Basecamp Message",
      description: `Retrieve a single message from a Basecamp message board.`,
      inputSchema: {
        bucket_id: BasecampIdSchema.describe(
          "Project/bucket ID containing the message",
        ),
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
        const response = await client.messages.get({
          params: { bucketId: params.bucket_id, messageId: params.message_id },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error(`Failed to fetch message: ${response.status}`);
        }

        const msg = response.body;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: msg.id,
                  subject: msg.title,
                  content: msg.content || "",
                  author: {
                    id: msg.creator?.id,
                    name: msg.creator?.name || "Unknown",
                  },
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
      description: `List messages in a Basecamp message board`,
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
        message_board_id: BasecampIdSchema.describe("Message board ID"),
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
        const messages = await asyncPagedToArray({
          fetchPage: client.messages.list,
          request: {
            params: {
              bucketId: params.bucket_id,
              messageBoardId: params.message_board_id,
            },
            query: {},
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                messages.map((m) => ({
                  id: m.id,
                  title: m.title,
                  creator: m.creator?.name || "Unknown",
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

  // basecamp_create_message
  server.registerTool(
    "basecamp_create_message",
    {
      title: "Create Basecamp Message",
      description: `Create a new message in a Basecamp message board.`,
      inputSchema: {
        bucket_id: BasecampIdSchema,
        message_board_id: BasecampIdSchema,
        subject: z.string().min(1).max(500).describe("Message subject/title"),
        content: z
          .string()
          .optional()
          .describe("Message content (HTML supported)"),
        status: z
          .enum(["active", "draft"])
          .default("active")
          .describe("Message status"),
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
        const response = await client.messages.create({
          params: {
            bucketId: params.bucket_id,
            messageBoardId: params.message_board_id,
          },
          body: {
            subject: params.subject,
            content: params.content,
            status: params.status,
          },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error(`Failed to create message`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Message created successfully!\n\nID: ${response.body.id}\nSubject: ${response.body.title}\nURL: ${response.body.app_url}`,
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
      description: `Update a message. At least one field (subject, content, or partial content operations) must be provided. Returns updated message.`,
      inputSchema: {
        bucket_id: BasecampIdSchema,
        message_id: BasecampIdSchema,
        subject: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe("New message subject"),
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
        validateContentOperations(params, ["subject"]);

        const client = await initializeBasecampClient();
        let finalContent: string | undefined;

        // Check if we need to fetch current content for partial operations
        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps || params.content !== undefined) {
          // Fetch current message if needed for partial operations
          if (hasPartialOps) {
            const currentResponse = await client.messages.get({
              params: {
                bucketId: params.bucket_id,
                messageId: params.message_id,
              },
            });

            if (currentResponse.status !== 200 || !currentResponse.body) {
              throw new Error(
                `Failed to fetch current message for partial update: ${currentResponse.status}`,
              );
            }

            const currentContent = currentResponse.body.content || "";
            finalContent = applyContentOperations(currentContent, params);
          } else {
            // Full content replacement
            finalContent = params.content;
          }
        }

        const response = await client.messages.update({
          params: { bucketId: params.bucket_id, messageId: params.message_id },
          body: {
            ...(params.subject ? { subject: params.subject } : {}),
            ...(finalContent !== undefined ? { content: finalContent } : {}),
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error(`Failed to update message`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Message updated successfully!\n\nID: ${response.body.id}\nSubject: ${response.body.title}`,
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
