/**
 * Kanban tools for Basecamp MCP server (cards, columns, steps)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

const ListCardsSchema = z.object({

  bucket_id: BasecampIdSchema,
  column_id: BasecampIdSchema,

}).strict();

const CreateCardSchema = z.object({

  bucket_id: BasecampIdSchema,
  column_id: BasecampIdSchema,
  title: z.string().min(1),
  content: z.string().optional(),

}).strict();

const CreateStepSchema = z.object({

  bucket_id: BasecampIdSchema,
  card_id: BasecampIdSchema,
  title: z.string().min(1),
}).strict();

export function registerKanbanTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_kanban_cards",
    {
      title: "List Kanban Cards",
      description: "List cards in a kanban column.",
      inputSchema: ListCardsSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof ListCardsSchema>) => {
      try {
        const client = await initializeBasecampClient();
        const cards = await asyncPagedToArray({
          fetchPage: client.cardTableCards.list,
          request: {
            params: { bucketId: params.bucket_id, columnId: params.column_id },
            query: {},
          }
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(cards.map(c => ({ id: c.id, title: c.title, due_on: c.due_on })), null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_create_kanban_card",
    {
      title: "Create Kanban Card",
      description: "Create a new card in a kanban column.",
      inputSchema: CreateCardSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: z.infer<typeof CreateCardSchema>) => {
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
          content: [{ type: "text", text: `Card created!\n\nID: ${response.body.id}\nTitle: ${response.body.title}` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_create_kanban_step",
    {
      title: "Create Kanban Step",
      description: "Add a checklist step to a kanban card.",
      inputSchema: CreateStepSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: z.infer<typeof CreateStepSchema>) => {
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
          content: [{ type: "text", text: `Step created!\n\nID: ${response.body.id}\nTitle: ${response.body.title}` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );
}
