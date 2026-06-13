#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerCampfireTools } from "./tools/campfires.js";
import { registerCheckinTools } from "./tools/checkins.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerFilesTools } from "./tools/files.js";
import { registerKanbanTools } from "./tools/kanban.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerPeopleTools } from "./tools/people.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerTodoTools } from "./tools/todos.js";

/**
 * Build an McpServer with every Basecamp tool registered. Shared by the stdio
 * entrypoint (`main`) and the integration test harness so both exercise the
 * exact same tool set.
 */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: "basecamp-mcp-server",
    version: "1.0.0",
  });

  registerAuthTools(server);
  registerProjectTools(server);
  registerMessageTools(server);
  registerTodoTools(server);
  registerCommentTools(server);
  registerPeopleTools(server);
  registerKanbanTools(server);
  registerActivityTools(server);
  registerCampfireTools(server);
  registerFilesTools(server);
  registerCheckinTools(server);

  return server;
}

async function main() {
  console.error("Registering tools...");
  const server = buildServer();
  console.error("Tools registered successfully");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Basecamp MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting Basecamp MCP server:", error);
  process.exit(1);
});
