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
  htmlRules,
  validateContentOperations,
} from "../utils/contentOperations.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { serializePerson } from "../utils/serializers.js";

// Type for step input from user
type StepInput = {
  id?: number;
  title: string;
  due_on?: string | null;
  assignee_ids?: number[];
  completed?: boolean;
};

// Type for current step from API
type CurrentStep = {
  id: number;
  title: string;
  completed: boolean;
  due_on?: string | null;
  assignees?: Array<{ id: number }>;
};

/**
 * Process step operations for a kanban card (create, update, delete, reposition, setCompletion)
 * Uses complete array replacement approach - steps not in desired array will be deleted
 */
async function processStepOperations(
  client: Awaited<ReturnType<typeof initializeBasecampClient>>,
  bucketId: number,
  cardId: number,
  currentSteps: CurrentStep[],
  desiredSteps: StepInput[],
): Promise<void> {
  // ===== VALIDATION =====

  // Validate new steps have titles
  for (const step of desiredSteps) {
    if (!step.id && !step.title) {
      throw new Error("New steps (without id) must have a title");
    }
  }

  // Check for duplicate IDs
  const stepIds = desiredSteps.filter((s) => s.id).map((s) => s.id!);
  if (new Set(stepIds).size !== stepIds.length) {
    throw new Error("Duplicate step IDs found in steps array");
  }

  // Validate all step IDs exist on current card
  const currentStepIds = new Set(currentSteps.map((s) => s.id));
  for (const id of stepIds) {
    if (!currentStepIds.has(id)) {
      const available = Array.from(currentStepIds).join(", ");
      throw new Error(
        `Step ID ${id} not found on card. ${
          available
            ? `Available IDs: ${available}`
            : "No steps exist on this card."
        }`,
      );
    }
  }

  // ===== IDENTIFY OPERATIONS =====

  const desiredStepIds = new Set(stepIds);

  // Steps to delete: in current but not in desired
  const toDelete = currentSteps.filter((s) => !desiredStepIds.has(s.id));

  // Steps to create: no ID provided
  const toCreate = desiredSteps.filter((s) => !s.id);

  // Steps to update/reposition/complete
  const toProcess = desiredSteps.filter((s) => s.id);

  // ===== DELETE OPERATIONS =====

  for (const step of toDelete) {
    await client.recordings.trash({
      params: { bucketId, recordingId: step.id },
    });
  }

  // ===== CREATE OPERATIONS =====

  const createdStepIds: number[] = []; // Track new IDs for repositioning

  for (const step of toCreate) {
    const response = await client.cardTableSteps.create({
      params: { bucketId, cardId },
      body: {
        title: step.title,
        ...(step.due_on !== undefined
          ? { due_on: step.due_on || undefined }
          : {}),
        ...(step.assignee_ids
          ? { assignees: step.assignee_ids.join(",") }
          : {}),
      },
    });

    if (response.status !== 201 || !response.body) {
      throw new Error(`Failed to create step: ${step.title}`);
    }

    createdStepIds.push(response.body.id);

    // Set completion if specified
    if (step.completed !== undefined && step.completed) {
      await client.cardTableSteps.setCompletion({
        params: { bucketId, stepId: response.body.id },
        body: { completion: "on" },
      });
    }
  }

  // ===== UPDATE OPERATIONS =====

  // Build a map of current steps for comparison
  const currentStepMap = new Map(currentSteps.map((s) => [s.id, s]));

  for (const step of toProcess) {
    const currentStep = currentStepMap.get(step.id!);
    if (!currentStep) continue; // Should not happen due to validation

    // Check what changed
    const titleChanged = step.title && step.title !== currentStep.title;
    const dueOnChanged =
      step.due_on !== undefined && step.due_on !== currentStep.due_on;

    const currentAssigneeIds = currentStep.assignees?.map((a) => a.id) || [];
    const desiredAssigneeIds = step.assignee_ids || [];
    const assigneesChanged =
      step.assignee_ids !== undefined &&
      (currentAssigneeIds.length !== desiredAssigneeIds.length ||
        !currentAssigneeIds.every((id, i) => id === desiredAssigneeIds[i]));

    // Only update if something changed
    if (titleChanged || dueOnChanged || assigneesChanged) {
      await client.cardTableSteps.update({
        params: { bucketId, stepId: step.id! },
        body: {
          ...(step.title ? { title: step.title } : {}),
          ...(step.due_on !== undefined
            ? { due_on: step.due_on || undefined }
            : {}),
          ...(step.assignee_ids
            ? { assignees: step.assignee_ids.join(",") }
            : {}),
        },
      });
    }

    // Handle completion status changes
    if (
      step.completed !== undefined &&
      step.completed !== currentStep.completed
    ) {
      await client.cardTableSteps.setCompletion({
        params: { bucketId, stepId: step.id! },
        body: { completion: step.completed ? "on" : "off" },
      });
    }
  }

  // ===== REPOSITION OPERATIONS =====

  // Build final list of step IDs in desired order (mix of existing and new)
  const finalStepIds: number[] = [];
  let createIndex = 0;

  for (const step of desiredSteps) {
    if (step.id) {
      finalStepIds.push(step.id);
    } else {
      // This was a created step, use the ID we tracked
      if (createIndex < createdStepIds.length) {
        finalStepIds.push(createdStepIds[createIndex++]);
      }
    }
  }

  // Get current positions after all operations
  // We need to reposition if the order doesn't match
  const currentPositions = new Map(
    currentSteps
      .filter((s) => finalStepIds.includes(s.id))
      .map((s, i) => [s.id, i]),
  );

  // Reposition each step to match the desired array order
  for (let i = 0; i < finalStepIds.length; i++) {
    const stepId = finalStepIds[i];
    const currentPos = currentPositions.get(stepId);

    // Only reposition if needed
    if (currentPos !== undefined && currentPos !== i) {
      await client.cardTableSteps.reposition({
        params: { bucketId, cardId },
        body: { source_id: stepId, position: i },
      });
    }
  }
}

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
      description: `Create a new card in a kanban column with optional checklist steps. ${htmlRules}`,
      inputSchema: {
        bucket_id: BasecampIdSchema,
        column_id: BasecampIdSchema,
        title: z.string().min(1),
        content: z.string().optional(),
        due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
        assignee_ids: z
          .array(z.number())
          .optional()
          .describe("Array of user IDs to assign to the card"),
        notify: z.boolean().optional().describe("Whether to notify assignees"),
        steps: z
          .array(
            z.object({
              title: z.string().describe("Step title"),
              due_on: z
                .string()
                .nullable()
                .optional()
                .describe("Due date (YYYY-MM-DD) or null"),
              assignee_ids: z
                .array(z.number())
                .optional()
                .describe("Array of user IDs to assign"),
              completed: z
                .boolean()
                .optional()
                .describe("Whether step is completed"),
            }),
          )
          .optional()
          .describe("Array of steps to create. Array order defines position."),
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
          body: {
            title: params.title,
            content: params.content,
            ...(params.due_on ? { due_on: params.due_on } : {}),
            ...(params.assignee_ids
              ? { assignee_ids: params.assignee_ids }
              : {}),
            ...(params.notify !== undefined ? { notify: params.notify } : {}),
          },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create card");
        }

        // Process step operations if provided (for new card, currentSteps is empty)
        if (params.steps) {
          await processStepOperations(
            client,
            params.bucket_id,
            response.body.id,
            [], // No current steps for a new card
            params.steps,
          );
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
      description: `Update a kanban card including its steps. At least one field (title, content, partial content operations, or steps) must be provided. Use partial content operations when possible to save on token usage. ${htmlRules}`,
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
        steps: z
          .array(
            z.object({
              id: z
                .number()
                .optional()
                .describe("Step ID for updates. Omit for new steps."),
              title: z.string().describe("Step title. Required for new steps."),
              due_on: z
                .string()
                .nullable()
                .optional()
                .describe("Due date (YYYY-MM-DD) or null to clear"),
              assignee_ids: z
                .array(z.number())
                .optional()
                .describe("Array of user IDs to assign"),
              completed: z
                .boolean()
                .optional()
                .describe("Whether step is completed"),
            }),
          )
          .optional()
          .describe(
            "Complete array of desired steps. Array order defines position. Steps not in array will be deleted.",
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
        // Validate at least one operation is provided
        validateContentOperations(params, [
          "title",
          "due_on",
          "notify",
          "assignee_ids",
          "steps",
        ]);

        const client = await initializeBasecampClient();
        let finalContent: string | undefined;
        let currentCard: any = null;

        // Check if we need to fetch current content for partial operations
        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps || params.content !== undefined || params.steps) {
          // Fetch current card if needed for partial operations or steps
          if (hasPartialOps || params.steps) {
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

            currentCard = currentResponse.body;

            if (hasPartialOps) {
              const currentContent = currentCard.content || "";
              finalContent = applyContentOperations(currentContent, params);
            }
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

        // Process step operations if provided
        if (params.steps) {
          await processStepOperations(
            client,
            params.bucket_id,
            params.card_id,
            currentCard?.steps || [],
            params.steps,
          );
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
              text: `Card moved successfully to column ${params.column_id}${
                params.position !== undefined
                  ? ` at position ${params.position}`
                  : ""
              }!`,
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
