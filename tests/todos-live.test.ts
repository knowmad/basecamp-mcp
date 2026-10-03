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
  group?: string | null;
  group_id?: number | null;
  assignees: Array<{ id: number; name: string } | null>;
};

type TodoList = {
  count: number;
  todos: Todo[];
  groups: Array<{ id: number; name: string }>;
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
    // No lists exist in the sandbox: seed one and trash it in teardown.
    const createText = await mcp.text("basecamp_create_todolist", {
      todoset_id: todosetId,
      name: `MCP test list ${Date.now()}`,
    });
    todolistId = extractId(createText);
    seededListId = todolistId;
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

  it("creates a todo list and updates its name and description", async () => {
    const name = `MCP todolist ${Date.now()}`;

    const createText = await mcp.text("basecamp_create_todolist", {
      todoset_id: todosetId,
      name,
      description: "<div>Automated todo list for the MCP test.</div>",
    });
    expect(createText).toContain("Todo list created!");
    expect(createText).toContain(`Name: ${name}`);
    const listId = extractId(createText);
    toTrash.push(listId);

    const todoset = await mcp.json<{
      todoLists: Array<{ id: number; title: string }>;
    }>("basecamp_get_todoset", { todoset_id: todosetId });
    expect(todoset.todoLists.some((l) => l.id === listId)).toBe(true);

    // Append to the description only: the name must stay the same.
    const appendText = await mcp.text("basecamp_update_todolist", {
      todolist_id: listId,
      content_append: "<p>Appended note.</p>",
    });
    expect(appendText).toContain("Todo list updated!");
    expect(appendText).toContain(`Name: ${name}`);

    const newName = `${name} (updated)`;
    const renameText = await mcp.text("basecamp_update_todolist", {
      todolist_id: listId,
      name: newName,
    });
    expect(renameText).toContain(`Name: ${newName}`);

    const client = await initializeBasecampClient();
    const raw = await client.todolists.get(listId);
    expect(raw.name).toBe(newName);
    expect(raw.description ?? "").toContain("Automated todo list");
    expect(raw.description ?? "").toContain("Appended note.");
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

  it("keeps the fields that an update does not change (regression)", async () => {
    // The API clears each field that a PUT does not include. Make sure that
    // a title-only update keeps the description, the dates, the assignees and
    // the completion subscribers.
    const client = await initializeBasecampClient();
    const seeded = await client.todos.create(todolistId, {
      content: `MCP keep-fields todo ${Date.now()}`,
      description: "<div>Keep this description.</div>",
      assigneeIds: [myId],
      completionSubscriberIds: [myId],
      startsOn: "2030-04-01",
      dueOn: "2030-04-10",
    });
    toTrash.push(seeded.id);

    const newTitle = `${seeded.content} (renamed)`;
    await mcp.text("basecamp_update_todo", {
      todo_id: seeded.id,
      title: newTitle,
    });

    const raw = await client.todos.get(seeded.id);
    expect(raw.content).toBe(newTitle);
    expect(raw.description ?? "").toContain("Keep this description.");
    expect(raw.starts_on).toBe("2030-04-01");
    expect(raw.due_on).toBe("2030-04-10");
    expect((raw.assignees || []).map((p) => p.id)).toContain(myId);
    expect((raw.completion_subscribers || []).map((p) => p.id)).toContain(myId);
  });

  it("includes todos nested in groups/sections", async () => {
    // Todos inside a group are not returned by todos.list(listId); the tool now
    // also walks the list's groups so sectioned lists are not reported empty.
    const client = await initializeBasecampClient();
    const group = await client.todolistGroups.create(todolistId, {
      name: `Section ${Date.now()}`,
    });

    const groupedTitle = `MCP grouped todo ${Date.now()}`;
    const grouped = await client.todos.create(group.id, {
      content: groupedTitle,
    });
    toTrash.push(grouped.id);

    const listed = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: todolistId,
    });

    const found = listed.todos.find((t) => t.id === grouped.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe(groupedTitle);
    expect(found?.group).toBe(group.title || group.name);
    expect(found?.group_id).toBe(group.id);
    expect(listed.groups.some((g) => g.id === group.id)).toBe(true);
  });

  it("accepts a stringified id (client serialization, regression for #5)", async () => {
    // Some MCP clients serialize numeric arguments as strings; BasecampIdSchema
    // coerces them rather than rejecting with "Expected number, received string".
    const listed = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: String(todolistId),
    });
    expect(typeof listed.count).toBe("number");
    expect(Array.isArray(listed.todos)).toBe(true);
  });
});

describe("Basecamp todo ordering via MCP tools (live)", () => {
  /** Create a todo list for one test, and trash it in teardown. */
  async function createList(name: string): Promise<number> {
    const text = await mcp.text("basecamp_create_todolist", {
      todoset_id: todosetId,
      name: `${name} ${Date.now()}`,
    });
    const id = extractId(text);
    toTrash.push(id);
    return id;
  }

  async function createTodos(parentId: number, titles: string[]) {
    const ids: number[] = [];
    for (const title of titles) {
      const text = await mcp.text("basecamp_create_todo", {
        todolist_id: parentId,
        title,
      });
      ids.push(extractId(text));
    }
    return ids;
  }

  async function todoOrder(parentId: number): Promise<number[]> {
    const client = await initializeBasecampClient();
    return (await client.todos.list(parentId)).map((todo) => todo.id);
  }

  it("moves a todo to the top, after another todo, and into a group", async () => {
    const listId = await createList("MCP move list");
    const [t1, t2, t3] = await createTodos(listId, ["t1", "t2", "t3"]);

    const topText = await mcp.text("basecamp_move_todo", {
      todo_id: t3,
      placement: "top",
    });
    expect(topText).toContain("Todo moved!");
    expect(topText).toContain("Position: 1");
    expect(await todoOrder(listId)).toEqual([t3, t1, t2]);

    await mcp.text("basecamp_move_todo", {
      todo_id: t3,
      placement: "after",
      relative_to_id: t1,
    });
    expect(await todoOrder(listId)).toEqual([t1, t3, t2]);

    await mcp.text("basecamp_move_todo", {
      todo_id: t1,
      placement: "bottom",
    });
    expect(await todoOrder(listId)).toEqual([t3, t2, t1]);

    // Move into a group with destination_id, then next to a todo in the
    // group without destination_id: the tool finds the group by itself.
    const client = await initializeBasecampClient();
    const group = await client.todolistGroups.create(listId, {
      name: "Section",
    });
    const intoGroup = await mcp.text("basecamp_move_todo", {
      todo_id: t2,
      placement: "bottom",
      destination_id: group.id,
    });
    expect(intoGroup).toContain(`(ID: ${group.id})`);
    await mcp.text("basecamp_move_todo", {
      todo_id: t1,
      placement: "before",
      relative_to_id: t2,
    });
    expect(await todoOrder(group.id)).toEqual([t1, t2]);
    expect(await todoOrder(listId)).toEqual([t3]);

    // list_todos shows the group IDs.
    const listed = await mcp.json<TodoList>("basecamp_list_todos", {
      todolist_id: listId,
    });
    expect(listed.todos.find((t) => t.id === t2)?.group_id).toBe(group.id);
    expect(listed.groups).toEqual([{ id: group.id, name: "Section" }]);
  });

  it("rejects a move with a wrong placement", async () => {
    const listId = await createList("MCP bad move list");
    const [t1, t2] = await createTodos(listId, ["t1", "t2"]);

    const noReference = await mcp.call("basecamp_move_todo", {
      todo_id: t1,
      placement: "after",
    });
    expect(noReference.content[0].text).toContain("needs relative_to_id");

    const selfReference = await mcp.call("basecamp_move_todo", {
      todo_id: t1,
      placement: "after",
      relative_to_id: t1,
    });
    expect(selfReference.content[0].text).toContain(
      "is not in the destination",
    );

    expect(await todoOrder(listId)).toEqual([t1, t2]);
  });

  it("reorders all the todos in a list", async () => {
    const listId = await createList("MCP reorder list");
    const [a, b, c, d] = await createTodos(listId, ["a", "b", "c", "d"]);

    const text = await mcp.text("basecamp_reorder_todos", {
      parent_id: listId,
      todo_ids: [d, b, a, c],
    });
    expect(text).toContain("Todos reordered!");
    expect(await todoOrder(listId)).toEqual([d, b, a, c]);

    // A list with a missing todo is an error, and changes nothing.
    const partial = await mcp.call("basecamp_reorder_todos", {
      parent_id: listId,
      todo_ids: [a, b, c],
    });
    expect(partial.content[0].text).toContain(String(d));
    expect(await todoOrder(listId)).toEqual([d, b, a, c]);
  });

  it("moves a todo list among the todo lists", async () => {
    const a = await createList("MCP list A");
    const b = await createList("MCP list B");
    const c = await createList("MCP list C");
    const client = await initializeBasecampClient();
    const ours = async () =>
      (await client.todolists.list(todosetId))
        .map((list) => list.id)
        .filter((id) => [a, b, c].includes(id));

    await mcp.text("basecamp_move_todolist", {
      todolist_id: a,
      placement: "before",
      relative_to_id: c,
    });
    const afterBefore = await ours();
    expect(afterBefore.indexOf(a)).toBe(afterBefore.indexOf(c) - 1);

    const text = await mcp.text("basecamp_move_todolist", {
      todolist_id: b,
      placement: "top",
    });
    expect(text).toContain("Position: 1 of");
    expect((await ours())[0]).toBe(b);

    // A group is not a todo list.
    const group = await client.todolistGroups.create(a, { name: "Section" });
    const wrongKind = await mcp.call("basecamp_move_todolist", {
      todolist_id: group.id,
      placement: "top",
    });
    expect(wrongKind.content[0].text).toContain("is a group");
  });

  it("moves a group among the groups of its todo list", async () => {
    const listId = await createList("MCP group list");
    const client = await initializeBasecampClient();
    const g1 = await client.todolistGroups.create(listId, { name: "G1" });
    const g2 = await client.todolistGroups.create(listId, { name: "G2" });
    const g3 = await client.todolistGroups.create(listId, { name: "G3" });
    const groupOrder = async () =>
      (await client.todolistGroups.list(listId)).map((group) => group.id);

    const text = await mcp.text("basecamp_move_todolist_group", {
      group_id: g1.id,
      placement: "after",
      relative_to_id: g3.id,
    });
    expect(text).toContain("Position: 3 of 3");
    expect(await groupOrder()).toEqual([g2.id, g3.id, g1.id]);

    await mcp.text("basecamp_move_todolist_group", {
      group_id: g3.id,
      placement: "top",
    });
    expect(await groupOrder()).toEqual([g3.id, g2.id, g1.id]);

    const wrongKind = await mcp.call("basecamp_move_todolist_group", {
      group_id: listId,
      placement: "top",
    });
    expect(wrongKind.content[0].text).toContain("is a todo list");
  });
});
