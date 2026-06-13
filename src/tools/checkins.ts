/**
 * Check-in (Q&A) tools for Basecamp MCP server
 *
 * Manages automatic check-in questions and their answers.
 * Hierarchy: Project → Questionnaire → Questions → Answers
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { serializePerson } from "../utils/serializers.js";

export function registerCheckinTools(server: McpServer): void {
  // basecamp_get_questionnaire
  server.registerTool(
    "basecamp_get_questionnaire",
    {
      title: "Get Basecamp Questionnaire",
      description:
        "Get the questionnaire (check-ins container) for a project. Returns the number of questions and their URL.",
      inputSchema: {
        questionnaire_id: BasecampIdSchema.describe("Questionnaire ID"),
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
        const q = await client.checkins.getQuestionnaire(
          params.questionnaire_id,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: q.id,
                  name: q.name,
                  questions_count: q.questions_count,
                  created_at: q.created_at,
                  updated_at: q.updated_at,
                  url: q.app_url,
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

  // basecamp_list_questions
  server.registerTool(
    "basecamp_list_questions",
    {
      title: "List Basecamp Check-in Questions",
      description:
        "List all automatic check-in questions in a questionnaire. Returns each question's title, schedule, paused status, and answer count.",
      inputSchema: {
        questionnaire_id: BasecampIdSchema.describe("Questionnaire ID"),
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
        const questions = await client.checkins.listQuestions(
          params.questionnaire_id,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                questions.map((q) => ({
                  id: q.id,
                  title: q.title,
                  paused: q.paused,
                  schedule: q.schedule,
                  answers_count: q.answers_count,
                  created_at: q.created_at,
                  url: q.app_url,
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

  // basecamp_get_question
  server.registerTool(
    "basecamp_get_question",
    {
      title: "Get Basecamp Check-in Question",
      description:
        "Get a single automatic check-in question with its schedule and metadata.",
      inputSchema: {
        question_id: BasecampIdSchema.describe("Question ID"),
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
        const q = await client.checkins.getQuestion(params.question_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: q.id,
                  title: q.title,
                  paused: q.paused,
                  schedule: q.schedule,
                  answers_count: q.answers_count,
                  creator: serializePerson(q.creator),
                  created_at: q.created_at,
                  updated_at: q.updated_at,
                  url: q.app_url,
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

  // basecamp_list_answers
  server.registerTool(
    "basecamp_list_answers",
    {
      title: "List Basecamp Check-in Answers",
      description:
        "List answers to a specific check-in question. Returns each answer's content, author, and check-in date.",
      inputSchema: {
        question_id: BasecampIdSchema.describe("Question ID"),
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
        const answers = await client.checkins.listAnswers(params.question_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                answers.map((a) => ({
                  id: a.id,
                  content: a.content,
                  group_on: a.group_on,
                  author: serializePerson(a.creator),
                  created_at: a.created_at,
                  url: a.app_url,
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

  // basecamp_get_answer
  server.registerTool(
    "basecamp_get_answer",
    {
      title: "Get Basecamp Check-in Answer",
      description: "Get a single check-in answer by its ID.",
      inputSchema: {
        answer_id: BasecampIdSchema.describe("Answer ID"),
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
        const a = await client.checkins.getAnswer(params.answer_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: a.id,
                  content: a.content,
                  group_on: a.group_on,
                  author: serializePerson(a.creator),
                  created_at: a.created_at,
                  updated_at: a.updated_at,
                  comments_count: a.comments_count,
                  url: a.app_url,
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

  // basecamp_create_answer
  server.registerTool(
    "basecamp_create_answer",
    {
      title: "Create Basecamp Check-in Answer",
      description:
        "Create a new answer for a check-in question. Content must be HTML.",
      inputSchema: {
        question_id: BasecampIdSchema.describe("Question ID to answer"),
        content: z.string().min(1).describe("HTML content of the answer"),
        group_on: z
          .string()
          .describe(
            "Date the answer belongs to (YYYY-MM-DD format, used to group answers by check-in day)",
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
        const answer = await client.checkins.createAnswer(params.question_id, {
          content: params.content,
          groupOn: params.group_on,
        });

        return {
          content: [
            {
              type: "text",
              text: `Answer created successfully!\n\nID: ${answer.id}\nURL: ${answer.app_url}`,
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
