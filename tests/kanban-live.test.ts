import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveCardTableId,
  trashRecordings,
} from "./utils";

type Card = {
  id: number;
  title: string;
  content?: string | null;
  due_on?: string | null;
  assignees: Array<{ id: number; name: string } | null>;
  steps?: Array<{ id: number; title: string; completed: boolean }>;
};

let mcp: McpTestClient;
let projectId: number;
let cardTableId: number;
let myId: number;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const resolved = await resolveCardTableId(mcp, projectId);
  if (resolved == null) {
    throw new Error(
      `Sandbox project ${projectId} has no kanban board enabled; cannot run kanban tests.`,
    );
  }
  cardTableId = resolved;

  const me = await mcp.json<{ id: number }>("basecamp_get_me");
  myId = me.id;
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("Basecamp kanban via MCP tools (live)", () => {
  it("lists columns for the card table", async () => {
    const columns = await mcp.json<Array<{ id: number; title: string }>>(
      "basecamp_list_kanban_columns",
      { card_table_id: cardTableId },
    );
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    expect(typeof columns[0].id).toBe("number");
  });

  it("creates, reads, updates (steps + assignee), lists, and moves a card", async () => {
    const columns = await mcp.json<Array<{ id: number; title: string }>>(
      "basecamp_list_kanban_columns",
      { card_table_id: cardTableId },
    );
    const columnId = columns[0].id;
    const destColumnId = columns[1]?.id ?? columns[0].id;

    const title = `MCP kanban card ${Date.now()}`;

    // CREATE
    const createText = await mcp.text("basecamp_create_kanban_card", {
      column_id: columnId,
      title,
      content: "<div>Automated card for the MCP kanban lifecycle test.</div>",
    });
    expect(createText).toContain("Card created!");
    const cardId = extractId(createText);
    toTrash.push(cardId);

    // READ
    const card = await mcp.json<Card>("basecamp_get_kanban_card", {
      card_id: cardId,
    });
    expect(card.id).toBe(cardId);
    expect(card.title).toBe(title);

    // UPDATE: new title + due date + assignee (assignee path = follow-up update)
    // and two fresh steps, the first pre-completed.
    const newTitle = `${title} (updated)`;
    const updateText = await mcp.text("basecamp_update_kanban_card", {
      card_id: cardId,
      title: newTitle,
      due_on: "2030-01-15",
      assignee_ids: [myId],
      steps: [{ title: "Step A", completed: true }, { title: "Step B" }],
    });
    expect(updateText.toLowerCase()).toContain("updated");

    const afterUpdate = await mcp.json<Card>("basecamp_get_kanban_card", {
      card_id: cardId,
    });
    expect(afterUpdate.title).toBe(newTitle);
    expect(afterUpdate.due_on).toBe("2030-01-15");
    expect(afterUpdate.assignees.some((a) => a?.id === myId)).toBe(true);
    expect(afterUpdate.steps).toHaveLength(2);

    const stepA = afterUpdate.steps?.find((s) => s.title === "Step A");
    const stepB = afterUpdate.steps?.find((s) => s.title === "Step B");
    expect(stepA?.completed).toBe(true);
    expect(stepB?.completed).toBe(false);

    // UPDATE steps again: reorder (B before A), rename + uncomplete A, drop B
    // is NOT dropped here — we reorder and mutate to exercise reposition/update/
    // setCompletion. Then a second pass deletes one to exercise trash.
    if (!stepA || !stepB) throw new Error("steps missing after first update");
    const reorderText = await mcp.text("basecamp_update_kanban_card", {
      card_id: cardId,
      steps: [
        { id: stepB.id, title: "Step B" },
        { id: stepA.id, title: "Step A renamed", completed: false },
      ],
    });
    expect(reorderText.toLowerCase()).toContain("updated");

    const afterReorder = await mcp.json<Card>("basecamp_get_kanban_card", {
      card_id: cardId,
    });
    expect(afterReorder.steps?.map((s) => s.title)).toEqual([
      "Step B",
      "Step A renamed",
    ]);
    const renamedA = afterReorder.steps?.find(
      (s) => s.title === "Step A renamed",
    );
    expect(renamedA?.completed).toBe(false);

    // UPDATE steps: delete Step B by omitting it (array = desired final state)
    const deleteText = await mcp.text("basecamp_update_kanban_card", {
      card_id: cardId,
      steps: [{ id: renamedA?.id, title: "Step A renamed" }],
    });
    expect(deleteText.toLowerCase()).toContain("updated");

    const afterDelete = await mcp.json<Card>("basecamp_get_kanban_card", {
      card_id: cardId,
    });
    expect(afterDelete.steps).toHaveLength(1);
    expect(afterDelete.steps?.[0].title).toBe("Step A renamed");

    // LIST cards in the source column — our card should be present
    const cards = await mcp.json<Card[]>("basecamp_list_kanban_cards", {
      column_id: columnId,
    });
    expect(cards.some((c) => c.id === cardId)).toBe(true);

    // MOVE to another column (when available) at position 1
    const moveText = await mcp.text("basecamp_move_kanban_card", {
      card_id: cardId,
      column_id: destColumnId,
      position: 1,
    });
    expect(moveText.toLowerCase()).toContain("moved");

    if (destColumnId !== columnId) {
      const destCards = await mcp.json<Card[]>("basecamp_list_kanban_cards", {
        column_id: destColumnId,
      });
      expect(destCards.some((c) => c.id === cardId)).toBe(true);
    }
  });

  it("creates a card with inline steps at creation time", async () => {
    const columns = await mcp.json<Array<{ id: number }>>(
      "basecamp_list_kanban_columns",
      { card_table_id: cardTableId },
    );
    const columnId = columns[0].id;

    const createText = await mcp.text("basecamp_create_kanban_card", {
      column_id: columnId,
      title: `MCP kanban steps-on-create ${Date.now()}`,
      steps: [
        { title: "First", completed: true },
        { title: "Second" },
        { title: "Third" },
      ],
    });
    const cardId = extractId(createText);
    toTrash.push(cardId);

    const card = await mcp.json<Card>("basecamp_get_kanban_card", {
      card_id: cardId,
    });
    expect(card.steps?.map((s) => s.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(card.steps?.find((s) => s.title === "First")?.completed).toBe(true);
  });
});
