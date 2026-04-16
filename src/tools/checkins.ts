/**
 * Check-in (Q&A) tools for Basecamp MCP server
 *
 * Manages automatic check-in questions and their answers.
 * Hierarchy: Project → Questionnaire → Questions → Answers
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
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
				bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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
				const response = await client.questionnaires.get({
					params: {
						bucketId: params.bucket_id,
						questionnaireId: params.questionnaire_id,
					},
				});

				if (response.status !== 200 || !response.body) {
					throw new Error(
						`Failed to fetch questionnaire: ${response.status}`,
					);
				}

				const q = response.body;

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
				bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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
				const questions = await asyncPagedToArray({
					fetchPage: client.questions.list,
					request: {
						params: {
							bucketId: params.bucket_id,
							questionnaireId: params.questionnaire_id,
						},
						query: {},
					},
				});

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
				bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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
				const response = await client.questions.get({
					params: {
						bucketId: params.bucket_id,
						questionId: params.question_id,
					},
				});

				if (response.status !== 200 || !response.body) {
					throw new Error(`Failed to fetch question: ${response.status}`);
				}

				const q = response.body;

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
				bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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
				const answers = await asyncPagedToArray({
					fetchPage: client.questionAnswers.list,
					request: {
						params: {
							bucketId: params.bucket_id,
							questionId: params.question_id,
						},
						query: {},
					},
				});

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
				bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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
				const response = await client.questionAnswers.get({
					params: {
						bucketId: params.bucket_id,
						answerId: params.answer_id,
					},
				});

				if (response.status !== 200 || !response.body) {
					throw new Error(`Failed to fetch answer: ${response.status}`);
				}

				const a = response.body;

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
				bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
				question_id: BasecampIdSchema.describe("Question ID to answer"),
				content: z
					.string()
					.min(1)
					.describe("HTML content of the answer"),
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
				const response = await client.questionAnswers.create({
					params: {
						bucketId: params.bucket_id,
						questionId: params.question_id,
					},
					body: {
						content: params.content,
						group_on: params.group_on,
					},
				});

				if (response.status !== 201 || !response.body) {
					throw new Error("Failed to create answer");
				}

				return {
					content: [
						{
							type: "text",
							text: `Answer created successfully!\n\nID: ${response.body.id}\nURL: ${response.body.app_url}`,
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
