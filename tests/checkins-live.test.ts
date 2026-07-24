import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveDockId,
  trashRecordings,
} from "./utils";

type Questionnaire = {
  id: number;
  name: string;
  questions_count: number;
  url?: string;
};

type Question = {
  id: number;
  title: string;
  paused?: boolean;
  answers_count?: number;
};

type Answer = {
  id: number;
  content: string;
  group_on?: string | null;
  author?: { id: number; name: string } | null;
};

let mcp: McpTestClient;
let projectId: number;
let questionnaireId: number | null;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));
  questionnaireId = await resolveDockId(mcp, projectId, "questionnaire");
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("Basecamp check-ins (questionnaire) via MCP tools (live)", () => {
  it("has a questionnaire dock in the sandbox", () => {
    // If this fails, the sandbox has no check-ins dock and the read/write tests
    // below are skipped. We surface it rather than failing spuriously.
    expect(
      questionnaireId,
      "Sandbox project has no questionnaire (check-ins) dock enabled",
    ).not.toBeNull();
  });

  it("gets the questionnaire metadata", async () => {
    if (questionnaireId == null) return;
    const q = await mcp.json<Questionnaire>("basecamp_get_questionnaire", {
      questionnaire_id: questionnaireId,
    });
    expect(q.id).toBe(questionnaireId);
    expect(typeof q.name).toBe("string");
    expect(typeof q.questions_count).toBe("number");
  });

  it("lists questions, reads one, lists its answers, and round-trips a new answer", async () => {
    if (questionnaireId == null) return;

    // LIST questions
    const questions = await mcp.json<Question[]>("basecamp_list_questions", {
      questionnaire_id: questionnaireId,
    });
    expect(Array.isArray(questions)).toBe(true);

    if (questions.length === 0) {
      // No seed question — create_answer/get_answer cannot be exercised.
      console.warn(
        "[checkins-live] questionnaire has no questions; skipping get_question/list_answers/create_answer/get_answer.",
      );
      return;
    }

    const questionId = questions[0].id;
    expect(typeof questionId).toBe("number");

    // GET single question — details match the listed entry
    const question = await mcp.json<Question>("basecamp_get_question", {
      question_id: questionId,
    });
    expect(question.id).toBe(questionId);
    expect(question.title).toBe(questions[0].title);

    // LIST answers (may be empty)
    const answersBefore = await mcp.json<Answer[]>("basecamp_list_answers", {
      question_id: questionId,
    });
    expect(Array.isArray(answersBefore)).toBe(true);

    // CREATE an answer (posts a real check-in answer)
    const marker = `MCP check-in answer ${Date.now()}`;
    const content = `<div>${marker}</div>`;
    const today = new Date().toISOString().slice(0, 10);
    const createText = await mcp.text("basecamp_create_answer", {
      question_id: questionId,
      content,
      group_on: today,
    });
    expect(createText).toContain("ID:");
    const answerId = extractId(createText);
    toTrash.push(answerId);

    // GET the answer — content round-trips (HTML may be wrapped/normalized)
    const answer = await mcp.json<Answer>("basecamp_get_answer", {
      answer_id: answerId,
    });
    expect(answer.id).toBe(answerId);
    expect(answer.content).toContain(marker);
  });
});
