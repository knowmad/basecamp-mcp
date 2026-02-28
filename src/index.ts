#!/usr/bin/env node
/**
 * Basecamp MCP Server
 *
 * MCP server for interacting with Basecamp API, providing tools for:
 * - Projects (discovering bucket IDs)
 * - Messages (with patch support for updates)
 * - TODOs (sets, lists, todos)
 * - Comments (universal - work on any resource)
 * - People
 * - Kanban (cards, columns, steps)
 * - Activity (recordings browsing)
 *
 * Environment variables required:
 * - BASECAMP_CLIENT_ID
 * - BASECAMP_CLIENT_SECRET
 * - BASECAMP_REFRESH_TOKEN
 * - BASECAMP_USER_AGENT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerKanbanTools } from "./tools/kanban.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerPeopleTools } from "./tools/people.js";
// Import tool registration functions
import { registerProjectTools } from "./tools/projects.js";
import { registerTodoTools } from "./tools/todos.js";
import { registerUploadTools } from "./tools/uploads.js";

/**
 * Main server initialization and startup
 */
async function main() {
  // Validate required environment variables
  const requiredEnvVars = [
    "BASECAMP_CLIENT_ID",
    "BASECAMP_CLIENT_SECRET",
    "BASECAMP_REFRESH_TOKEN",
    "BASECAMP_USER_AGENT",
  ];

  const missing = requiredEnvVars.filter((varName) => !process.env[varName]);
  if (missing.length > 0) {
    console.error(
      `ERROR: Missing required environment variables: ${missing.join(", ")}`,
    );
    console.error(
      "Please set these in your environment or .env file before starting the server.",
    );
    process.exit(1);
  }

  // Create MCP server instance
  const server = new McpServer({
    name: "basecamp-mcp-server",
    version: "1.0.0",
  });

  // Register all tool categories
  console.error("Registering tools...");
  registerProjectTools(server);
  registerMessageTools(server);
  registerTodoTools(server);
  registerCommentTools(server);
  registerPeopleTools(server);
  registerKanbanTools(server);
  registerActivityTools(server);
  registerDocumentTools(server);
  registerUploadTools(server);
  console.error("Tools registered successfully");

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  console.error("Basecamp MCP server running on stdio");
  console.error("Waiting for client connection...");
}

// Run the server
main().catch((error) => {
  console.error("Fatal error starting Basecamp MCP server:", error);
  process.exit(1);
});
