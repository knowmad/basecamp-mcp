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

const ListCardsSchema = z
  .object({
    bucket_id: BasecampIdSchema,
    column_id: BasecampIdSchema,
  })
  .strict();

const CreateCardSchema = z
  .object({
    bucket_id: BasecampIdSchema,
    column_id: BasecampIdSchema,
    title: z.string().min(1),
    content: z.string().optional(),
  })
  .strict();

const CreateStepSchema = z
  .object({
    bucket_id: BasecampIdSchema,
    card_id: BasecampIdSchema,
    title: z.string().min(1),
  })
  .strict();

// Update card (PATCH support - all fields optional)
const UpdateKanbanCardPatchSchema = z
  .object({
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
  })
  .strict();

export function registerKanbanTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_kanban_cards",
    {
      title: "List Kanban Cards",
      description: "List cards in a kanban column.",
      inputSchema: ListCardsSchema.shape,
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
    "basecamp_create_kanban_card",
    {
      title: "Create Kanban Card",
      description: "Create a new card in a kanban column.",
      inputSchema: CreateCardSchema.shape,
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
        "Update a kanban card. At least one field (title, content, or partial content operations) must be provided. Returns updated card.",
      inputSchema: UpdateKanbanCardPatchSchema.shape,
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
    "basecamp_create_kanban_step",
    {
      title: "Create Kanban Step",
      description: "Add a checklist step to a kanban card.",
      inputSchema: CreateStepSchema.shape,
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
