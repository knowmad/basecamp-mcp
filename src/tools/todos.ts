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
import { serializePerson } from "../utils/serializers.js";

/**
 * Optional date field for todos. Accepts an ISO date (YYYY-MM-DD) or an empty
 * string. Empty/omitted leaves the date unset on create and clears it on update.
 */
const TodoDateSchema = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Date must be in YYYY-MM-DD format or empty")
  .optional();

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
    "basecamp_list_todos",
    {
      title: "List Basecamp Todos",
      description:
        "List todos in a todo list. Filter by status: 'active' or 'archived'.",
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
            return groupTodos.map((t) => ({ todo: t, group: groupName }));
          }),
        );

        const todos = [
          ...ungroupedTodos.map((t) => ({
            todo: t,
            group: null as string | null,
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
                  todos: todos.map(({ todo: t, group }) => ({
                    id: t.id,
                    title: t.content,
                    completed: t.completed,
                    due_on: t.due_on,
                    starts_on: t.starts_on,
                    group,
                    assignees: (t.assignees || []).map(serializePerson),
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
          description: params.content,
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

        // Fetch current todo to get existing values
        const currentTodo = await client.todos.get(params.todo_id);

        // Determine final title (maps to Basecamp's content field)
        const finalTitle = params.title ?? currentTodo.content;

        // Determine final content (maps to Basecamp's description field)
        let finalContent: string | undefined;
        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps) {
          const currentContent = currentTodo.description || "";
          const result = applyContentOperations(currentContent, params);
          if (result === undefined) {
            throw new Error("Content operations resulted in undefined content");
          }
          finalContent = result;
        } else if (params.content !== undefined) {
          // Full content replacement
          finalContent = params.content;
        }

        const todo = await client.todos.update(params.todo_id, {
          content: finalTitle,
          ...(finalContent !== undefined ? { description: finalContent } : {}),
          ...(params.assignee_ids !== undefined
            ? { assigneeIds: params.assignee_ids }
            : {}),
          ...(params.due_on !== undefined ? { dueOn: params.due_on } : {}),
          ...(params.starts_on !== undefined
            ? { startsOn: params.starts_on }
            : {}),
          ...(params.notify !== undefined ? { notify: params.notify } : {}),
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
}
