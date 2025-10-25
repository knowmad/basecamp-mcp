/**
 * TODO tools for Basecamp MCP server
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

const GetTodoSetSchema = z.object({
  bucket_id: BasecampIdSchema,
  todoset_id: BasecampIdSchema,
}).strict();

const ListTodosSchema = z.object({
  bucket_id: BasecampIdSchema,
  todolist_id: BasecampIdSchema,
  status: z.enum(["active", "archived"]).default("active").optional(),
  completed: z.enum(["true"]).optional(),
}).strict();

const CreateTodoSchema = z.object({
  bucket_id: BasecampIdSchema,
  todolist_id: BasecampIdSchema,
  content: z.string().min(1),
  description: z.string().optional(),

}).strict();

const CompleteTodoSchema = z.object({

  bucket_id: BasecampIdSchema,
  todo_id: BasecampIdSchema,
}).strict();

export function registerTodoTools(server: McpServer): void {
  server.registerTool(
    "basecamp_get_todoset",
    {
      title: "Get Basecamp Todo Set",
      description: "Get todo set container for a project. Returns todo lists and groups.",
      inputSchema: GetTodoSetSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof GetTodoSetSchema>) => {
      try {
        const client = await initializeBasecampClient();

        const responseTodoSet = await client.todoSets.get({
          params: { bucketId: params.bucket_id, todosetId: params.todoset_id },
        });

        if (responseTodoSet.status !== 200 || !responseTodoSet.body) {
          throw new Error("Failed to fetch todo set");
        }

        const todoLists = await asyncPagedToArray({
          fetchPage: client.todoLists.list,
          request: {
            params: { bucketId: params.bucket_id, todosetId: params.todoset_id },
            query: {}
          }
        });

        const todoSet = responseTodoSet.body;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: todoSet.id,
              name: todoSet.name,
              url: todoSet.app_url,
              completed: todoSet.completed,
              todoLists: todoLists.map(list => ({
                id: list.id,
                url: list.app_url,
                title: list.title,
                completed: list.completed,
                position: list.position,
              })),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_list_todos",
    {
      title: "List Basecamp Todos",
      description: "List todos in a todo list. Filter by status: 'active' or 'archived'.",
      inputSchema: ListTodosSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof ListTodosSchema>) => {
      try {
        const client = await initializeBasecampClient();
        const todos = await asyncPagedToArray({
          fetchPage: client.todos.list,
          request: {
            params: { bucketId: params.bucket_id, todolistId: params.todolist_id },
            query: { status: params.status, completed: params.completed },
          }
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              count: todos.length,
              todos: todos.map(t => ({ id: t.id, content: t.content, completed: t.completed })),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_create_todo",
    {
      title: "Create Basecamp Todo",
      description: "Create a new todo item in a todo list.",
      inputSchema: CreateTodoSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params: z.infer<typeof CreateTodoSchema>) => {
      try {
        const client = await initializeBasecampClient();
        const response = await client.todos.create({
          params: { bucketId: params.bucket_id, todolistId: params.todolist_id },
          body: { content: params.content, description: params.description },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create todo");
        }

        return {
          content: [{ type: "text", text: `Todo created!\n\nID: ${response.body.id}\nContent: ${response.body.content}` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_complete_todo",
    {
      title: "Complete Basecamp Todo",
      description: "Mark a todo as completed.",
      inputSchema: CompleteTodoSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof CompleteTodoSchema>) => {
      try {
        const client = await initializeBasecampClient();
        await client.todos.complete({
          params: { bucketId: params.bucket_id, todoId: params.todo_id },
        });

        return { content: [{ type: "text", text: "Todo marked as completed!" }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_uncomplete_todo",
    {
      title: "Uncomplete Basecamp Todo",
      description: "Mark a todo as incomplete (undo completion).",
      inputSchema: CompleteTodoSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof CompleteTodoSchema>) => {
      try {
        const client = await initializeBasecampClient();
        await client.todos.uncomplete({
          params: { bucketId: params.bucket_id, todoId: params.todo_id },
        });

        return { content: [{ type: "text", text: "Todo marked as incomplete!" }] };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );
}
