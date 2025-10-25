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
import { handleBasecampError } from "../utils/errorHandlers.js";

// Get message schema
const GetMessageSchema = z.object({
  bucket_id: BasecampIdSchema.describe("Project/bucket ID containing the message"),
  message_id: BasecampIdSchema.describe("Message ID to retrieve"),

}).strict();

// List messages schema
const ListMessagesSchema = z.object({
  bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
  message_board_id: BasecampIdSchema.describe("Message board ID"),
}).strict();

// Create message schema
const CreateMessageSchema = z.object({

  bucket_id: BasecampIdSchema,
  message_board_id: BasecampIdSchema,
  subject: z.string().min(1).max(500).describe("Message subject/title"),
  content: z.string().optional().describe("Message content (HTML supported)"),
  status: z.enum(["active", "draft"]).default("active").describe("Message status"),

}).strict();

// Update message (PATCH support - all fields optional)
const UpdateMessagePatchSchema = z.object({

  bucket_id: BasecampIdSchema,
  message_id: BasecampIdSchema,
  subject: z.string().min(1).max(500).optional().describe("New message subject"),
  content: z.string().optional().describe("New message content (HTML supported)"),

}).strict();

export function registerMessageTools(server: McpServer): void {
  // basecamp_get_message
  server.registerTool(
    "basecamp_get_message",
    {
      title: "Get Basecamp Message",
      description: `Retrieve a single message from a Basecamp message board.`,
      inputSchema: GetMessageSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof GetMessageSchema>) => {
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
          content: [{
            type: "text",
            text: JSON.stringify({
              id: msg.id,
              subject: msg.title,
              content: msg.content || "",
              author: { id: msg.creator?.id, name: msg.creator?.name || "Unknown" },
              created_at: msg.created_at,
              updated_at: msg.updated_at,
              url: msg.app_url,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  // basecamp_list_messages
  server.registerTool(
    "basecamp_list_messages",
    {
      title: "List Basecamp Messages",
      description: `List messages in a Basecamp message board`,
      inputSchema: ListMessagesSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof ListMessagesSchema>) => {
      try {
        const client = await initializeBasecampClient();
        const messages = await asyncPagedToArray({
          fetchPage: client.messages.list,
          request: {
            params: { bucketId: params.bucket_id, messageBoardId: params.message_board_id },
            query: {},
          }
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(messages.map(m => ({
              id: m.id,
              title: m.title,
              author: m.creator?.name || "Unknown",
              created_at: m.created_at,
            })), null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  // basecamp_create_message
  server.registerTool(
    "basecamp_create_message",
    {
      title: "Create Basecamp Message",
      description: `Create a new message in a Basecamp message board.`,
      inputSchema: CreateMessageSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: z.infer<typeof CreateMessageSchema>) => {
      try {
        const client = await initializeBasecampClient();
        const response = await client.messages.create({
          params: { bucketId: params.bucket_id, messageBoardId: params.message_board_id },
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
          content: [{
            type: "text",
            text: `Message created successfully!\n\nID: ${response.body.id}\nSubject: ${response.body.title}\nURL: ${response.body.app_url}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_update_message_patch",
    {
      title: "Update Basecamp Message",
      description: `Update a message. At least one field (subject or content) must be provided. Returns updated message.`,
      inputSchema: UpdateMessagePatchSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: z.infer<typeof UpdateMessagePatchSchema>) => {
      try {
        if (!params.subject && !params.content) {
          throw new Error("At least one field (subject or content) must be provided");
        }

        const client = await initializeBasecampClient();
        const response = await client.messages.update({
          params: { bucketId: params.bucket_id, messageId: params.message_id },
          body: {
            ...(params.subject ? { subject: params.subject } : {}),
            ...(params.content !== undefined ? { content: params.content } : {}),
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error(`Failed to update message`);
        }

        return {
          content: [{
            type: "text",
            text: `Message updated successfully!\n\nID: ${response.body.id}\nSubject: ${response.body.title}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );
}
