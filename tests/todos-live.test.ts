import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeBasecampClient } from "../src/utils/auth.js";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveDockId,
  trashRecordings,
} from "./utils";

type Todo = {
  id: number;
  title: string;
  completed: boolean;
  due_on?: string | null;
  starts_on?: string | null;
  assignees: Array<{ id: number; name: string } | null>;
};

type TodoList = {
  count: number;
  todos: Todo[];
};

let mcp: McpTestClient;
let projectId: number;
let todosetId: number;
let todolistId: number;
let myId: number;
let seededListId: number | null = null;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const resolved = await resolveDockId(mcp, projectId, "todoset");
  if (resolved == null) {
    throw new Error(
      `Sandbox project ${projectId} has no todoset enabled; cannot run todo tests.`,
    );
  }
  todosetId = resolved;

  const todoset = await mcp.json<{
    todoLists: Array<{ id: number; title: string }>;
  }>("basecamp_get_todoset", { todoset_id: todosetId });

  if (todoset.todoLists.length > 0) {
    todolistId = todoset.todoLists[0].id;
  } else {
    // No lists exist in the sandbox: seed one directly via the SDK and trash it
    // in teardown (there is no MCP tool to create a todolist).
    const client = await initializeBasecampClient();
    const list = await client.todolists.create(todosetId, {
      name: `MCP test list ${Date.now()}`,
    });
    todolistId = list.id;
    seededListId = list.id;
  }

  const me = await mcp.json<{ id: number }>("basecamp_get_me");
  myId = me.id;
});

afterAll(async () => {
  const ids = [...toTrash];
  if (seededListId != null) ids.push(seededListId);
  await trashRecordings(ids);
  await mcp?.close();
});

describe("Basecamp todos via MCP tools (live)", () => {
  it("returns the todoset shape with a todoLists array", async () => {
    const todoset = await mcp.json<{
      id: number;
      todoLists: Array<{ id: number; title: string }>;
    }>("basecamp_get_todoset", { todoset_id: todosetId });

    expect(todoset.id).toBe(todosetId);
    expect(Array.isArray(todoset.todoLists)).toBe(true);
    expect(todoset.todoLists.some((l) => l.id === todolistId)).toBe(true);
  });

  it("runs the full todo lifecycle: create, list, update, complete, uncomplete", async () => {
    const title = `MCP todo ${Date.now()}`;

    // CREATE — title (->content), description, due/start dates, self-assign.
    const createText = await mcp.text("basecamp_create_todo", {
      todolist_id: todolistId,
      title,
      content: "<div>Automated todo for the MCP lifecycle test.</div>",
      starts_on: "2030-01-10",
      due_on: "2030-01-20",
      assignee_ids: [myId],
    });
    expect(createText).toContain("Todo created!");
    expect(createText).toContain("Due: 2030-01-20");
    expect(createText).toContain("Starts: 2030-01-10");
    const todoId = extractId(createText);
    toTrash.push(todoId);

    // LIST (active) — created todo present with dates + assignee surfaced.
    const active = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
    });
    const created = active.todos.find((t) => t.id === todoId);
    expect(created).toBeDefined();
    expect(created?.title).toBe(title);
    expect(created?.completed).toBe(false);
    expect(created?.due_on).toBe("2030-01-20");
    expect(created?.starts_on).toBe("2030-01-10");
    expect(created?.assignees.some((a) => a?.id === myId)).toBe(true);

    // UPDATE — rename, change due date, clear starts_on, keep assignee,
    // and append to the description via a partial content op.
    const newTitle = `${title} (updated)`;
    const updateText = await mcp.text("basecamp_update_todo", {
      todo_id: todoId,
      title: newTitle,
      due_on: "2030-02-15",
      starts_on: "",
      assignee_ids: [myId],
      content_append: "<p>Appended note.</p>",
    });
    expect(updateText).toContain("Todo updated!");
    expect(updateText).toContain("Due: 2030-02-15");

    const afterUpdate = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
    });
    const updated = afterUpdate.todos.find((t) => t.id === todoId);
    expect(updated?.title).toBe(newTitle);
    expect(updated?.due_on).toBe("2030-02-15");
    expect(updated?.starts_on == null || updated?.starts_on === "").toBe(true);
    expect(updated?.assignees.some((a) => a?.id === myId)).toBe(true);

    // Verify the appended description content via the SDK (list_todos does not
    // surface the description).
    const client = await initializeBasecampClient();
    const raw = await client.todos.get(todoId);
    expect(raw.description ?? "").toContain("Appended note.");

    // COMPLETE — drops out of the active list, appears in the completed query.
    const completeText = await mcp.text("basecamp_complete_todo", {
      todo_id: todoId,
    });
    expect(completeText.toLowerCase()).toContain("completed");

    const afterComplete = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
    });
    expect(afterComplete.todos.some((t) => t.id === todoId)).toBe(false);

    const completedList = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
      completed: true,
    });
    const completedTodo = completedList.todos.find((t) => t.id === todoId);
    expect(completedTodo).toBeDefined();
    expect(completedTodo?.completed).toBe(true);

    // UNCOMPLETE — back to the active list.
    const uncompleteText = await mcp.text("basecamp_uncomplete_todo", {
      todo_id: todoId,
    });
    expect(uncompleteText.toLowerCase()).toContain("incomplete");

    const afterUncomplete = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
    });
    const backActive = afterUncomplete.todos.find((t) => t.id === todoId);
    expect(backActive).toBeDefined();
    expect(backActive?.completed).toBe(false);
  });

  it("creates a minimal todo (title only) and clears its due date on update", async () => {
    const title = `MCP minimal todo ${Date.now()}`;

    const createText = await mcp.text("basecamp_create_todo", {
      todolist_id: todolistId,
      title,
      due_on: "2030-03-01",
    });
    const todoId = extractId(createText);
    toTrash.push(todoId);

    const withDue = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
    });
    expect(withDue.todos.find((t) => t.id === todoId)?.due_on).toBe(
      "2030-03-01",
    );

    // Clear the due date with an empty string.
    const updateText = await mcp.text("basecamp_update_todo", {
      todo_id: todoId,
      due_on: "",
    });
    expect(updateText).toContain("Todo updated!");

    const cleared = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
    });
    const clearedTodo = cleared.todos.find((t) => t.id === todoId);
    expect(clearedTodo?.due_on == null || clearedTodo?.due_on === "").toBe(
      true,
    );
  });
});
