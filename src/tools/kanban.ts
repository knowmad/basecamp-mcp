/**
 * Kanban tools for Basecamp MCP server (cards, columns, steps)
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
import { serializePerson } from "../utils/serializers.js";

export function registerKanbanTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_kanban_columns",
    {
      title: "List Kanban Columns",
      description: "List all columns in a kanban board.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        card_table_id: BasecampIdSchema,
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
        const response = await client.cardTables.get({
          params: {
            bucketId: params.bucket_id,
            cardTableId: params.card_table_id,
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error("Failed to fetch card table");
        }

        const columns = response.body.lists || [];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                columns.map((col) => ({
                  id: col.id,
                  title: col.title,
                  position: col.position,
                  cards_count: col.cards_count,
                  type: col.type,
                  description: col.description,
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
    "basecamp_list_kanban_cards",
    {
      title: "List Kanban Cards",
      description: "List cards in a kanban column.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        column_id: BasecampIdSchema,
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
        const cards = await asyncPagedToArray({
          fetchPage: client.cardTableCards.list,
          request: {
            params: { bucketId: params.bucket_id, columnId: params.column_id },
            query: {},
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                cards.map((c) => ({
                  id: c.id,
                  title: c.title,
                  due_on: c.due_on,
                  url: c.app_url,
                  comments_count: c.comments_count,
                  created_at: c.created_at,
                  creator: serializePerson(c.creator),
                  assignees: c.assignees.map(serializePerson),
                  steps: c.steps?.map((s) => ({
                    title: s.title,
                    completed: s.completed,
                  })),
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
    "basecamp_get_kanban_card",
    {
      title: "Get Kanban Card",
      description: "Get all details of a specific kanban card.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        card_id: BasecampIdSchema,
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
        const response = await client.cardTableCards.get({
          params: {
            bucketId: params.bucket_id,
            cardId: params.card_id,
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error("Failed to fetch card");
        }

        const card = response.body;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: card.id,
                  title: card.title,
                  content: card.content,
                  due_on: card.due_on,
                  url: card.app_url,
                  comments_count: card.comments_count,
                  created_at: card.created_at,
                  updated_at: card.updated_at,
                  creator: serializePerson(card.creator),
                  assignees: card.assignees.map(serializePerson),
                  steps: card.steps?.map((s) => ({
                    id: s.id,
                    title: s.title,
                    completed: s.completed,
                  })),
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

  server.registerTool(
    "basecamp_create_kanban_card",
    {
      title: "Create Kanban Card",
      description: "Create a new card in a kanban column.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        column_id: BasecampIdSchema,
        title: z.string().min(1),
        content: z.string().optional(),
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
        const response = await client.cardTableCards.create({
          params: { bucketId: params.bucket_id, columnId: params.column_id },
          body: { title: params.title, content: params.content },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create card");
        }

        return {
          content: [
            {
              type: "text",
              text: `Card created!\n\nID: ${response.body.id}\nTitle: ${response.body.title}`,
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
    "basecamp_update_kanban_card",
    {
      title: "Update Kanban Card",
      description:
        "Update a kanban card. At least one field (title, content, or partial content operations) must be provided. Use partial content operations when possible to save on token usage. Returns updated card.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        card_id: BasecampIdSchema,
        title: z.string().min(1).optional().describe("New card title"),
        ...ContentOperationFields,
        due_on: z
          .string()
          .optional()
          .describe("Due date (YYYY-MM-DD format) or null to clear"),
        notify: z
          .boolean()
          .optional()
          .describe("Whether to notify assignees of the update"),
        assignee_ids: z
          .array(z.number())
          .optional()
          .describe("Array of user IDs to assign to the card"),
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
        validateContentOperations(params, [
          "title",
          "due_on",
          "notify",
          "assignee_ids",
        ]);

        const client = await initializeBasecampClient();
        let finalContent: string | undefined;

        // Check if we need to fetch current content for partial operations
        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps || params.content !== undefined) {
          // Fetch current card if needed for partial operations
          if (hasPartialOps) {
            const currentResponse = await client.cardTableCards.get({
              params: {
                bucketId: params.bucket_id,
                cardId: params.card_id,
              },
            });

            if (currentResponse.status !== 200 || !currentResponse.body) {
              throw new Error(
                `Failed to fetch current card: ${currentResponse.status}`,
              );
            }

            const currentContent = currentResponse.body.content || "";
            finalContent = applyContentOperations(currentContent, params);
          } else {
            // Full content replacement
            finalContent = params.content;
          }
        }

        const response = await client.cardTableCards.update({
          params: { bucketId: params.bucket_id, cardId: params.card_id },
          body: {
            ...(params.title ? { title: params.title } : {}),
            ...(finalContent !== undefined ? { content: finalContent } : {}),
            ...(params.due_on !== undefined ? { due_on: params.due_on } : {}),
            ...(params.notify !== undefined ? { notify: params.notify } : {}),
            ...(params.assignee_ids !== undefined
              ? { assignee_ids: params.assignee_ids }
              : {}),
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error("Failed to update card");
        }

        return {
          content: [
            {
              type: "text",
              text: `Card updated successfully!\n\nID: ${response.body.id}\nTitle: ${response.body.title}`,
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
    "basecamp_move_kanban_card",
    {
      title: "Move Kanban Card",
      description:
        "Move a kanban card to a different column and/or position within that column.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        card_id: BasecampIdSchema,
        column_id: BasecampIdSchema,
        position: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Position within the destination column (zero-indexed). If not specified, card will be added to the end of the column.",
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
        const response = await client.cardTableCards.move({
          params: { bucketId: params.bucket_id, cardId: params.card_id },
          body: {
            column_id: params.column_id,
            ...(params.position !== undefined
              ? { position: params.position }
              : {}),
          },
        });

        if (response.status !== 204) {
          throw new Error("Failed to move card");
        }

        return {
          content: [
            {
              type: "text",
              text: `Card moved successfully to column ${params.column_id}${params.position !== undefined ? ` at position ${params.position}` : ""}!`,
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
    "basecamp_create_kanban_step",
    {
      title: "Create Kanban Step",
      description: "Add a checklist step to a kanban card.",
      inputSchema: {
        bucket_id: BasecampIdSchema,
        card_id: BasecampIdSchema,
        title: z.string().min(1),
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
        const response = await client.cardTableSteps.create({
          params: { bucketId: params.bucket_id, cardId: params.card_id },
          body: { title: params.title },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create step");
        }

        return {
          content: [
            {
              type: "text",
              text: `Step created!\n\nID: ${response.body.id}\nTitle: ${response.body.title}`,
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
