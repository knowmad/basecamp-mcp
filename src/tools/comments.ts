/**
 * Comment tools for Basecamp MCP server
 * Comments work on ANY recording (messages, todos, cards, etc.)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

const ListCommentsSchema = z.object({

  bucket_id: BasecampIdSchema,
  recording_id: BasecampIdSchema.describe("ID of the resource (message, todo, card, etc.)"),

}).strict();

const CreateCommentSchema = z.object({

  bucket_id: BasecampIdSchema,
  recording_id: BasecampIdSchema,
  content: z.string().min(1).describe("Comment content (HTML supported)"),

}).strict();

export function registerCommentTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_comments",
    {
      title: "List Basecamp Comments",
      description: "List comments on any Basecamp resource (message, todo, card, etc.). Works universally on all recording types.",
      inputSchema: ListCommentsSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof ListCommentsSchema>) => {
      try {
        const client = await initializeBasecampClient();

        const comments = await asyncPagedToArray({
          fetchPage: client.comments.list,
          request: {
            params: { bucketId: params.bucket_id, recordingId: params.recording_id },
            query: {},
          }
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(comments.map(c => ({
              id: c.id,
              author: c.creator?.name,
              content: c.content,
              created_at: c.created_at,
            })), null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_create_comment",
    {
      title: "Create Basecamp Comment",
      description: "Add a comment to any Basecamp resource (message, todo, card, etc.).",
      inputSchema: CreateCommentSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: z.infer<typeof CreateCommentSchema>) => {
      try {
        const client = await initializeBasecampClient();
        const response = await client.comments.create({
          params: { bucketId: params.bucket_id, recordingId: params.recording_id },
          body: { content: params.content },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create comment");
        }

        return {
          content: [{ type: "text", text: `Comment posted!\n\nID: ${response.body.id}` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );
}
