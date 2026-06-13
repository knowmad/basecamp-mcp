/**
 * Comment tools for Basecamp MCP server
 * Comments work on ANY recording (messages, todos, cards, etc.)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import {
  applyContentOperations,
  ContentOperationFields,
  htmlRules,
  validateContentOperations,
} from "../utils/contentOperations.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { serializePerson } from "../utils/serializers.js";

export function registerCommentTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_comments",
    {
      title: "List Basecamp Comments",
      description:
        "List comments on any Basecamp resource (message, todo, card, etc.). Works universally on all recording types.",
      inputSchema: {
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

        const comments = await client.comments.list(params.recording_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                comments.map((c) => ({
                  id: c.id,
                  creator: serializePerson(c.creator),
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
        recording_id: BasecampIdSchema,
        content: z
          .string()
          .min(1)
          .describe(
            `HTML comment content. To mention people: <bc-attachment sgid="{ person.attachable_sgid }"></bc-attachment>`,
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
        const comment = await client.comments.create(params.recording_id, {
          content: params.content,
        });

        return {
          content: [
            {
              type: "text",
              text: `Comment posted!\n\nID: ${comment.id}`,
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
      description: `Update a comment. Use partial content operations when possible to save on token usage. ${htmlRules}`,
      inputSchema: {
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
            const current = await client.comments.get(params.comment_id);
            const currentContent = current.content || "";
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
        const comment = await client.comments.update(params.comment_id, {
          content: finalContent,
        });

        return {
          content: [
            {
              type: "text",
              text: `Comment updated successfully!\n\nID: ${comment.id}`,
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
