/**
 * Kanban tools for Basecamp MCP server (cards, columns, steps)
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
    await client.recordings.trash(step.id);
  }

  // ===== CREATE OPERATIONS =====

  const createdStepIds: number[] = []; // Track new IDs for repositioning

  for (const step of toCreate) {
    const created = await client.cardSteps.create(cardId, {
      title: step.title,
      ...(step.due_on ? { dueOn: step.due_on } : {}),
      ...(step.assignee_ids ? { assigneeIds: step.assignee_ids } : {}),
    });

    createdStepIds.push(created.id);

    // Set completion if specified
    if (step.completed) {
      await client.cardSteps.setCompletion(created.id, { completion: "on" });
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
      await client.cardSteps.update(step.id!, {
        ...(step.title ? { title: step.title } : {}),
        ...(step.due_on !== undefined
          ? { dueOn: step.due_on || undefined }
          : {}),
        ...(step.assignee_ids ? { assigneeIds: step.assignee_ids } : {}),
      });
    }

    // Handle completion status changes
    if (
      step.completed !== undefined &&
      step.completed !== currentStep.completed
    ) {
      // "on" completes; "off" reverts. The SDK doc suggests "" to uncomplete,
      // but the live API rejects an empty completion ("Completion is required").
      await client.cardSteps.setCompletion(step.id!, {
        completion: step.completed ? "on" : "off",
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

    // Only reposition if needed. The reposition endpoint expects a 1-indexed
    // position (1 = top), while the loop index `i` is 0-based — convert here.
    if (currentPos !== undefined && currentPos !== i) {
      await client.cardSteps.reposition(cardId, {
        sourceId: stepId,
        position: i + 1,
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
        const cardTable = await client.cardTables.get(params.card_table_id);

        const columns = cardTable.lists || [];

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
        const cards = await client.cards.list(params.column_id);

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
                  assignees: (c.assignees || []).map(serializePerson),
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
        const card = await client.cards.get(params.card_id);

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
                  assignees: (card.assignees || []).map(serializePerson),
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
        column_id: BasecampIdSchema,
        title: z.string().min(1),
        content: z.string().optional(),
        due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
        assignee_ids: z
          .array(BasecampIdSchema)
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
                .array(BasecampIdSchema)
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
        const card = await client.cards.create(params.column_id, {
          title: params.title,
          ...(params.content !== undefined ? { content: params.content } : {}),
          ...(params.due_on ? { dueOn: params.due_on } : {}),
          ...(params.notify !== undefined ? { notify: params.notify } : {}),
        });

        // The Basecamp card-create endpoint does not accept assignees; they are
        // set via a follow-up update.
        if (params.assignee_ids && params.assignee_ids.length > 0) {
          await client.cards.update(card.id, {
            assigneeIds: params.assignee_ids,
          });
        }

        // Process step operations if provided (for new card, currentSteps is empty)
        if (params.steps) {
          await processStepOperations(
            client,
            card.id,
            [], // No current steps for a new card
            params.steps,
          );
        }

        return {
          content: [
            {
              type: "text",
              text: `Card created!\n\nID: ${card.id}\nTitle: ${card.title}`,
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
        card_id: BasecampIdSchema,
        title: z.string().min(1).optional().describe("New card title"),
        ...ContentOperationFields,
        due_on: z
          .string()
          .optional()
          .describe("Due date (YYYY-MM-DD format) or null to clear"),
        assignee_ids: z
          .array(BasecampIdSchema)
          .optional()
          .describe("Array of user IDs to assign to the card"),
        steps: z
          .array(
            z.object({
              id: BasecampIdSchema.optional().describe(
                "Step ID for updates. Omit for new steps.",
              ),
              title: z.string().describe("Step title. Required for new steps."),
              due_on: z
                .string()
                .nullable()
                .optional()
                .describe("Due date (YYYY-MM-DD) or null to clear"),
              assignee_ids: z
                .array(BasecampIdSchema)
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
          "assignee_ids",
          "steps",
        ]);

        const client = await initializeBasecampClient();
        let finalContent: string | undefined;
        let currentCard: Awaited<ReturnType<typeof client.cards.get>> | null =
          null;

        // Check if we need to fetch current content for partial operations
        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps || params.content !== undefined || params.steps) {
          // Fetch current card if needed for partial operations or steps
          if (hasPartialOps || params.steps) {
            currentCard = await client.cards.get(params.card_id);

            if (hasPartialOps) {
              const currentContent = currentCard.content || "";
              finalContent = applyContentOperations(currentContent, params);
            }
          } else {
            // Full content replacement
            finalContent = params.content;
          }
        }

        // Only issue a card update when there's an actual card-level field to
        // change. A steps-only edit must NOT send an empty body — Basecamp
        // rejects that with "Bad Request". In that case fall back to the
        // already-fetched current card (or fetch it) for the response.
        const updateBody = {
          ...(params.title ? { title: params.title } : {}),
          ...(finalContent !== undefined ? { content: finalContent } : {}),
          ...(params.due_on !== undefined ? { dueOn: params.due_on } : {}),
          ...(params.assignee_ids !== undefined
            ? { assigneeIds: params.assignee_ids }
            : {}),
        };

        let card: Awaited<ReturnType<typeof client.cards.get>>;
        if (Object.keys(updateBody).length > 0) {
          card = await client.cards.update(params.card_id, updateBody);
        } else {
          card = currentCard ?? (await client.cards.get(params.card_id));
        }

        // Process step operations if provided
        if (params.steps) {
          const currentSteps: CurrentStep[] = (currentCard?.steps || []).map(
            (s) => ({
              id: s.id,
              title: s.title,
              completed: s.completed ?? false,
              due_on: s.due_on,
              assignees: s.assignees,
            }),
          );
          await processStepOperations(
            client,
            params.card_id,
            currentSteps,
            params.steps,
          );
        }

        return {
          content: [
            {
              type: "text",
              text: `Card updated successfully!\n\nID: ${card.id}\nTitle: ${card.title}`,
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
        card_id: BasecampIdSchema,
        column_id: BasecampIdSchema,
        position: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "1-indexed position within the destination column (1 = top). If not specified, the card is added to the top of the column.",
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
        await client.cards.move(params.card_id, {
          columnId: params.column_id,
          ...(params.position !== undefined
            ? { position: params.position }
            : {}),
        });

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
