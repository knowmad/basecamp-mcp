/**
 * TODO tools for Basecamp MCP server
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
import {
  expandPersonMentions,
  expandPersonMentionsInOperations,
} from "../utils/mentions.js";
import { serializePerson } from "../utils/serializers.js";

/**
 * Optional date field for todos. Accepts an ISO date (YYYY-MM-DD) or an empty
 * string. Empty/omitted leaves the date unset on create and clears it on update.
 */
const TodoDateSchema = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Date must be in YYYY-MM-DD format or empty")
  .optional();

/**
 * Fields that tell where to put an item among the other items in the same
 * parent. Relative placement is easier to use than a position number.
 */
const PlacementFields = {
  placement: z
    .enum(["top", "bottom", "before", "after"])
    .describe(
      "Where to put the item. 'before' and 'after' need relative_to_id.",
    ),
  relative_to_id: BasecampIdSchema.optional().describe(
    "ID of the item to put this item before or after. Use it only with placement 'before' or 'after'.",
  ),
};

type Placement = "top" | "bottom" | "before" | "after";

/**
 * Make sure that relative_to_id is given only when the placement needs it.
 */
function validatePlacement(
  placement: Placement,
  relativeToId: number | undefined,
): void {
  const needsReference = placement === "before" || placement === "after";
  if (needsReference && relativeToId === undefined) {
    throw new Error(`Placement '${placement}' needs relative_to_id.`);
  }
  if (!needsReference && relativeToId !== undefined) {
    throw new Error(
      `relative_to_id is only for placement 'before' or 'after', not '${placement}'.`,
    );
  }
}

/**
 * Find the 1-based position for an item. siblingIds is the current order of
 * the other items in the destination, without the item that moves. The API
 * takes the position that the item has after the move.
 */
function resolvePosition(
  siblingIds: number[],
  placement: Placement,
  relativeToId: number | undefined,
): number {
  if (placement === "top") return 1;
  if (placement === "bottom") return siblingIds.length + 1;

  const index = siblingIds.indexOf(relativeToId as number);
  if (index === -1) {
    throw new Error(
      `Item ${relativeToId} is not in the destination, or it is the item that moves. Use an item that is in the same parent.`,
    );
  }
  return placement === "before" ? index + 1 : index + 2;
}

/**
 * Get the 1-based rank of an item in a list of items, for the tool response.
 */
function rankOf(items: Array<{ id: number }>, id: number): number | null {
  const index = items.findIndex((item) => item.id === id);
  return index === -1 ? null : index + 1;
}

export function registerTodoTools(server: McpServer): void {
  server.registerTool(
    "basecamp_get_todoset",
    {
      title: "Get Basecamp Todo Set",
      description:
        "Get todo set container for a project. Returns todo lists and groups.",
      inputSchema: {
        todoset_id: BasecampIdSchema,
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

        const todoSet = await client.todosets.get(params.todoset_id);

        const todoLists = await client.todolists.list(params.todoset_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: todoSet.id,
                  name: todoSet.name,
                  url: todoSet.app_url,
                  completed: todoSet.completed,
                  todoLists: todoLists.map((list) => ({
                    id: list.id,
                    url: list.app_url,
                    title: list.title,
                    completed: list.completed,
                    position: list.position,
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
    "basecamp_create_todolist",
    {
      title: "Create Basecamp Todo List",
      description: `Create a new todo list in a todo set. Get the todoset_id from the project dock (basecamp_get_project). ${htmlRules}`,
      inputSchema: {
        todoset_id: BasecampIdSchema,
        name: z.string().min(1).describe("Name of the todo list"),
        description: z
          .string()
          .optional()
          .describe("Optional HTML description of the todo list"),
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
        const list = await client.todolists.create(params.todoset_id, {
          name: params.name,
          ...(params.description !== undefined
            ? {
                description: await expandPersonMentions(
                  client,
                  params.description,
                ),
              }
            : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: `Todo list created!\n\nID: ${list.id}\nName: ${list.name}\nURL: ${list.app_url}`,
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
    "basecamp_update_todolist",
    {
      title: "Update Basecamp Todo List",
      description: `Update the name or the description of a todo list, or of a group (section) in a todo list. Use partial content operations on the description when possible to save on token usage. A todo list is complete when all its todos are complete, so this tool cannot complete it. ${htmlRules}`,
      inputSchema: {
        todolist_id: BasecampIdSchema.describe("ID of the todo list or group"),
        name: z.string().min(1).optional().describe("New name"),
        ...ContentOperationFields,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        validateContentOperations(params, ["name"]);

        const client = await initializeBasecampClient();
        const operations = await expandPersonMentionsInOperations(
          client,
          params,
        );

        // The SDK reads the current todo list, and then sends all the fields.
        // The API clears each field that the request does not include.
        const list = await client.todolists.edit(params.todolist_id, (t) => {
          if (params.name !== undefined) t.name = params.name;
          const description = applyContentOperations(t.description, operations);
          if (description !== undefined) t.description = description;
        });

        return {
          content: [
            {
              type: "text",
              text: `Todo list updated!\n\nID: ${list.id}\nName: ${list.name}\nURL: ${list.app_url}`,
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
    "basecamp_list_todos",
    {
      title: "List Basecamp Todos",
      description:
        "List todos in a todo list. Filter by status: 'active' or 'archived'. The todos come in display order: first the todos that are not in a group, then the todos of each group. The response also lists the groups (sections) of the todo list, also the empty groups.",
      inputSchema: {
        todolist_id: BasecampIdSchema,
        status: z.enum(["active", "archived"]).default("active").optional(),
        completed: z.literal(true).optional(),
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
        const listOptions = {
          status: params.status,
          completed: params.completed,
        };

        // Todos directly under the list (i.e. not inside any group).
        const ungroupedTodos = await client.todos.list(
          params.todolist_id,
          listOptions,
        );

        // A todo list can be split into groups ("sections"). Todos that live in
        // a group are NOT returned by todos.list(listId) — they only come back
        // from todos.list(groupId). Without this, lists that use sections return
        // an empty result even though they contain todos (GitHub issue #7).
        const groups = await client.todolistGroups.list(params.todolist_id);
        const groupedResults = await Promise.all(
          groups.map(async (group) => {
            const groupTodos = await client.todos.list(group.id, listOptions);
            const groupName = group.title || group.name || null;
            return groupTodos.map((t) => ({
              todo: t,
              group: groupName,
              groupId: group.id as number | null,
            }));
          }),
        );

        const todos = [
          ...ungroupedTodos.map((t) => ({
            todo: t,
            group: null as string | null,
            groupId: null as number | null,
          })),
          ...groupedResults.flat(),
        ];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: todos.length,
                  todos: todos.map(({ todo: t, group, groupId }) => ({
                    id: t.id,
                    title: t.content,
                    completed: t.completed,
                    due_on: t.due_on,
                    starts_on: t.starts_on,
                    group,
                    group_id: groupId,
                    assignees: (t.assignees || []).map(serializePerson),
                  })),
                  groups: groups.map((group) => ({
                    id: group.id,
                    name: group.title || group.name,
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
    "basecamp_create_todo",
    {
      title: "Create Basecamp Todo",
      description: `Create a new todo item in a todo list. ${htmlRules}`,
      inputSchema: {
        todolist_id: BasecampIdSchema,
        title: z.string().min(1),
        content: z.string().optional(),
        assignee_ids: z
          .array(BasecampIdSchema)
          .optional()
          .describe("Array of person IDs to assign to this todo"),
        due_on: TodoDateSchema.describe(
          "Due date in YYYY-MM-DD format. Pass an empty string to leave the due date unset.",
        ),
        starts_on: TodoDateSchema.describe(
          "Start date in YYYY-MM-DD format (for a date range; requires due_on). Pass an empty string to leave it unset.",
        ),
        notify: z
          .boolean()
          .optional()
          .describe("Whether to notify the assignees about this todo"),
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
        const todo = await client.todos.create(params.todolist_id, {
          content: params.title,
          description:
            params.content === undefined
              ? undefined
              : await expandPersonMentions(client, params.content),
          assigneeIds: params.assignee_ids,
          ...(params.due_on ? { dueOn: params.due_on } : {}),
          ...(params.starts_on ? { startsOn: params.starts_on } : {}),
          ...(params.notify !== undefined ? { notify: params.notify } : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: `Todo created!\n\nID: ${todo.id}\nContent: ${todo.content}${
                todo.due_on ? `\nDue: ${todo.due_on}` : ""
              }${todo.starts_on ? `\nStarts: ${todo.starts_on}` : ""}`,
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
    "basecamp_complete_todo",
    {
      title: "Complete Basecamp Todo",
      description: "Mark a todo as completed.",
      inputSchema: {
        todo_id: BasecampIdSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await initializeBasecampClient();
        await client.todos.complete(params.todo_id);

        return {
          content: [{ type: "text", text: "Todo marked as completed!" }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );

  server.registerTool(
    "basecamp_uncomplete_todo",
    {
      title: "Uncomplete Basecamp Todo",
      description: "Mark a todo as incomplete (undo completion).",
      inputSchema: {
        todo_id: BasecampIdSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await initializeBasecampClient();
        await client.todos.uncomplete(params.todo_id);

        return {
          content: [{ type: "text", text: "Todo marked as incomplete!" }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );

  server.registerTool(
    "basecamp_update_todo",
    {
      title: "Update Basecamp Todo",
      description: `Update a todo item. Use partial content operations when possible to save on token usage. ${htmlRules}`,
      inputSchema: {
        todo_id: BasecampIdSchema,
        title: z.string().optional().describe("New todo title"),
        assignee_ids: z
          .array(BasecampIdSchema)
          .optional()
          .describe("Array of person IDs to assign to this todo"),
        due_on: TodoDateSchema.describe(
          "Due date in YYYY-MM-DD format. Pass an empty string to clear the due date.",
        ),
        starts_on: TodoDateSchema.describe(
          "Start date in YYYY-MM-DD format (for a date range; requires due_on). Pass an empty string to clear it.",
        ),
        notify: z
          .boolean()
          .optional()
          .describe("Whether to notify the assignees about this todo"),
        ...ContentOperationFields,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Validate at least one operation is provided
        validateContentOperations(params, [
          "title",
          "assignee_ids",
          "due_on",
          "starts_on",
          "notify",
        ]);

        const client = await initializeBasecampClient();
        const operations = await expandPersonMentionsInOperations(
          client,
          params,
        );

        // The SDK reads the current todo, and then sends all the fields. The
        // API clears each field that the request does not include.
        const todo = await client.todos.edit(params.todo_id, (t) => {
          if (params.title !== undefined) t.content = params.title;
          const description = applyContentOperations(t.description, operations);
          if (description !== undefined) t.description = description;
          if (params.assignee_ids !== undefined) {
            t.assigneeIds = params.assignee_ids;
          }
          if (params.due_on !== undefined) t.dueOn = params.due_on;
          // A start date needs a due date. If the request clears the due date
          // and does not give a start date, clear the start date too.
          if (params.starts_on !== undefined) {
            t.startsOn = params.starts_on;
          } else if (t.dueOn === "") {
            t.startsOn = "";
          }
          if (params.notify !== undefined) t.notify = params.notify;
        });

        return {
          content: [
            {
              type: "text",
              text: `Todo updated!\n\nID: ${todo.id}\nContent: ${todo.content}${
                todo.due_on ? `\nDue: ${todo.due_on}` : ""
              }${todo.starts_on ? `\nStarts: ${todo.starts_on}` : ""}`,
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
    "basecamp_move_todo",
    {
      title: "Move Basecamp Todo",
      description: `Move a todo to a different place: in its todo list, into a group (section), or into a different todo list.

Examples:
  - Put a todo at the top of its list: placement "top".
  - Put a todo after another todo: placement "after" and relative_to_id. If the other todo is in a different list or group, the todo moves there.
  - Move a todo to the bottom of another list or group: placement "bottom" and destination_id.

Only the todos that are not complete have a position. To set the order of many todos, use basecamp_reorder_todos.`,
      inputSchema: {
        todo_id: BasecampIdSchema,
        ...PlacementFields,
        destination_id: BasecampIdSchema.optional().describe(
          "ID of the todo list or group to move the todo into. If you do not give it, the todo goes into the parent of relative_to_id, or else it stays in its current parent.",
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        validatePlacement(params.placement, params.relative_to_id);

        const client = await initializeBasecampClient();
        const todo = await client.todos.get(params.todo_id);

        let destinationId = params.destination_id;
        if (destinationId === undefined && params.relative_to_id) {
          const reference = await client.todos.get(params.relative_to_id);
          destinationId = reference.parent.id;
        }
        destinationId ??= todo.parent.id;

        const siblings = await client.todos.list(destinationId);
        const siblingIds = siblings
          .map((sibling) => sibling.id)
          .filter((id) => id !== todo.id);
        const position = resolvePosition(
          siblingIds,
          params.placement,
          params.relative_to_id,
        );

        await client.todos.reposition(todo.id, {
          position,
          ...(destinationId !== todo.parent.id
            ? { parentId: destinationId }
            : {}),
        });

        const moved = await client.todos.get(todo.id);

        return {
          content: [
            {
              type: "text",
              text: `Todo moved!\n\nID: ${moved.id}\nTitle: ${moved.content}\nParent: ${moved.parent.title} (ID: ${moved.parent.id})\nPosition: ${moved.position ?? "none (the todo is complete)"}`,
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
    "basecamp_reorder_todos",
    {
      title: "Reorder Basecamp Todos",
      description:
        "Set the order of all the todos in a todo list or in a group (section). Give the IDs of all the todos that are not complete, in the new order. Use this to sort todos, for example by due date. To move one todo, use basecamp_move_todo. The todos in a group are not part of the todo list: to reorder them, give the group ID.",
      inputSchema: {
        parent_id: BasecampIdSchema.describe("ID of the todo list or group"),
        todo_ids: z
          .array(BasecampIdSchema)
          .min(1)
          .describe(
            "IDs of all the todos that are not complete in the parent, in the new order",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const wanted = params.todo_ids;
        if (new Set(wanted).size !== wanted.length) {
          throw new Error("todo_ids contains the same ID more than one time.");
        }

        const client = await initializeBasecampClient();
        const order = (await client.todos.list(params.parent_id)).map(
          (todo) => todo.id,
        );

        const missing = order.filter((id) => !wanted.includes(id));
        const unknown = wanted.filter((id) => !order.includes(id));
        if (missing.length > 0 || unknown.length > 0) {
          const problems = [
            missing.length > 0
              ? `these todos are in the parent but not in todo_ids: ${missing.join(", ")}`
              : null,
            unknown.length > 0
              ? `these IDs are not todos in the parent that are not complete: ${unknown.join(", ")}`
              : null,
          ].filter(Boolean);
          throw new Error(
            `todo_ids must contain all the todos that are not complete in the parent, and only those. Problems: ${problems.join("; ")}.`,
          );
        }

        // Move the todos one at a time, from the top. Keep a local copy of
        // the order, and move only the todos that are not in their place.
        let moves = 0;
        for (let i = 0; i < wanted.length; i++) {
          if (order[i] === wanted[i]) continue;
          await client.todos.reposition(wanted[i], { position: i + 1 });
          order.splice(order.indexOf(wanted[i]), 1);
          order.splice(i, 0, wanted[i]);
          moves++;
        }

        return {
          content: [
            {
              type: "text",
              text: `Todos reordered!\n\nParent ID: ${params.parent_id}\nTodos moved: ${moves} of ${wanted.length}`,
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
    "basecamp_move_todolist",
    {
      title: "Move Basecamp Todo List",
      description:
        "Move a todo list to a different place among the todo lists of its project. Get the todo list IDs from basecamp_get_todoset. To move a group (section), use basecamp_move_todolist_group.",
      inputSchema: {
        todolist_id: BasecampIdSchema,
        ...PlacementFields,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        validatePlacement(params.placement, params.relative_to_id);

        const client = await initializeBasecampClient();
        const list = await client.todolists.get(params.todolist_id);
        // A todo list is in a todo set. A group is in a todo list.
        if (list.parent.type !== "Todoset") {
          throw new Error(
            `${params.todolist_id} is a group, not a todo list. Use basecamp_move_todolist_group.`,
          );
        }

        const siblings = await client.todolists.list(list.parent.id);
        const position = resolvePosition(
          siblings.map((sibling) => sibling.id).filter((id) => id !== list.id),
          params.placement,
          params.relative_to_id,
        );
        await client.todolists.reposition(list.id, { position });

        const after = await client.todolists.list(list.parent.id);

        return {
          content: [
            {
              type: "text",
              text: `Todo list moved!\n\nID: ${list.id}\nName: ${list.name}\nPosition: ${rankOf(after, list.id)} of ${after.length}`,
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
    "basecamp_move_todolist_group",
    {
      title: "Move Basecamp Todo List Group",
      description:
        "Move a group (section) to a different place among the groups of its todo list. The groups always show after the todos that are not in a group. Get the group IDs from basecamp_list_todos. You cannot move a group to a different todo list.",
      inputSchema: {
        group_id: BasecampIdSchema,
        ...PlacementFields,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        validatePlacement(params.placement, params.relative_to_id);

        const client = await initializeBasecampClient();
        const group = await client.todolists.get(params.group_id);
        // A group is in a todo list. A todo list is in a todo set.
        if (group.parent.type !== "Todolist") {
          throw new Error(
            `${params.group_id} is a todo list, not a group. Use basecamp_move_todolist.`,
          );
        }

        const siblings = await client.todolistGroups.list(group.parent.id);
        const position = resolvePosition(
          siblings.map((sibling) => sibling.id).filter((id) => id !== group.id),
          params.placement,
          params.relative_to_id,
        );
        await client.todolistGroups.reposition(group.id, { position });

        const after = await client.todolistGroups.list(group.parent.id);

        return {
          content: [
            {
              type: "text",
              text: `Group moved!\n\nID: ${group.id}\nName: ${group.name}\nTodo list: ${group.parent.title} (ID: ${group.parent.id})\nPosition: ${rankOf(after, group.id)} of ${after.length}`,
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
