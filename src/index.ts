#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerKanbanTools } from "./tools/kanban.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerPeopleTools } from "./tools/people.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerTodoTools } from "./tools/todos.js";
import { registerCheckinTools } from "./tools/checkins.js";
import { registerUploadTools } from "./tools/uploads.js";

async function main() {
	const server = new McpServer({
		name: "basecamp-mcp-server",
		version: "1.0.0",
	});

	console.error("Registering tools...");
	registerAuthTools(server);
	registerProjectTools(server);
	registerMessageTools(server);
	registerTodoTools(server);
	registerCommentTools(server);
	registerPeopleTools(server);
	registerKanbanTools(server);
	registerActivityTools(server);
	registerDocumentTools(server);
	registerUploadTools(server);
	registerCheckinTools(server);
	console.error("Tools registered successfully");

	const transport = new StdioServerTransport();
	await server.connect(transport);

	console.error("Basecamp MCP server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error starting Basecamp MCP server:", error);
	process.exit(1);
});
