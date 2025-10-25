/**
 * Comment tools for Basecamp MCP server
 * Comments work on ANY recording (messages, todos, cards, etc.)
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

export function registerCommentTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_comments",
    {
      title: "List Basecamp Comments",
      description:
        "List comments on any Basecamp resource (message, todo, card, etc.). Works universally on all recording types.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        recording_id: BasecampIdSchema.describe(
          "ID of the resource (message, todo, card, etc.)",
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

        const comments = await asyncPagedToArray({
          fetchPage: client.comments.list,
          request: {
            params: {
              bucketId: params.bucket_id,
              recordingId: params.recording_id,
            },
            query: {},
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                comments.map((c) => ({
                  id: c.id,
                  author: c.creator?.name,
                  content: c.content,
                  created_at: c.created_at,
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

  server.registerTool(
    "basecamp_create_comment",
    {
      title: "Create Basecamp Comment",
      description:
        "Add a comment to any Basecamp resource (message, todo, card, etc.).",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        recording_id: BasecampIdSchema,
        content: z.string().min(1).describe("Comment content (HTML supported)"),
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
        const response = await client.comments.create({
          params: {
            bucketId: params.bucket_id,
            recordingId: params.recording_id,
          },
          body: { content: params.content },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create comment");
        }

        return {
          content: [
            {
              type: "text",
              text: `Comment posted!\n\nID: ${response.body.id}`,
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
    "basecamp_update_comment",
    {
      title: "Update Basecamp Comment",
      description:
        "Update a comment. At least one content field (content, or partial content operations) must be provided. Returns updated comment.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        comment_id: BasecampIdSchema,
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
        validateContentOperations(params);

        const client = await initializeBasecampClient();
        let finalContent: string | undefined;

        // Check if we need to fetch current content for partial operations
        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps || params.content !== undefined) {
          // Fetch current comment if needed for partial operations
          if (hasPartialOps) {
            const currentResponse = await client.comments.get({
              params: {
                bucketId: params.bucket_id,
                commentId: params.comment_id,
              },
            });

            if (currentResponse.status !== 200 || !currentResponse.body) {
              throw new Error(
                `Failed to fetch current comment: ${currentResponse.status}`,
              );
            }

            const currentContent = currentResponse.body.content || "";
            finalContent = applyContentOperations(currentContent, params);
          } else {
            // Full content replacement
            finalContent = params.content;
          }
        }

        // If no content changes (shouldn't happen due to validation, but be safe)
        if (finalContent === undefined) {
          throw new Error("No content operations resulted in changes");
        }

        // Update the comment
        const response = await client.comments.update({
          params: {
            bucketId: params.bucket_id,
            commentId: params.comment_id,
          },
          body: { content: finalContent },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error("Failed to update comment");
        }

        return {
          content: [
            {
              type: "text",
              text: `Comment updated successfully!\n\nID: ${response.body.id}`,
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
