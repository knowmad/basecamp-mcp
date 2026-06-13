/**
 * Project-related tools for Basecamp MCP server
 *
 * Projects are the foundation - they help users discover bucket IDs needed for other operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

/**
 * Register all project-related tools with the MCP server
 */
export function registerProjectTools(server: McpServer): void {
  // Tool: basecamp_list_projects
  server.registerTool(
    "basecamp_list_projects",
    {
      title: "List Basecamp Projects",
      description: `List all projects visible to the authenticated user in a Basecamp account. This tool returns active projects with their IDs, names, descriptions, and metadata. Use this to discover project/bucket IDs needed for accessing messages, todos, and other resources.`,
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe(
            "Optional regular expression to filter projects by name or description",
          ),
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

        // Fetch projects (the SDK auto-paginates across all pages)
        const projects = await client.projects.list();

        // Apply filter if provided
        let filteredProjects = [...projects];
        if (params.filter) {
          const regex = new RegExp(params.filter, "i");
          filteredProjects = projects.filter(
            (p) => regex.test(p.name) || regex.test(p.description || ""),
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                filteredProjects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  description: p.description || "",
                  created_at: p.created_at,
                  updated_at: p.updated_at,
                  url: p.app_url,
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

  // Tool: basecamp_get_project
  server.registerTool(
    "basecamp_get_project",
    {
      title: "Get Basecamp Project Details",
      description: `Fetch detailed information about a specific Basecamp project. This tool retrieves complete project details including name, description, dock configuration, and metadata.

Examples:
  - Use when: "Get details for project 12345"
  - Use when: Need full project information including dock configuration`,
      inputSchema: {
        project_id: BasecampIdSchema.describe("Project ID to retrieve"),
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

        const project = await client.projects.get(params.project_id);

        const jsonData = {
          id: project.id,
          name: project.name,
          description: project.description || "",
          created_at: project.created_at,
          updated_at: project.updated_at,
          url: project.app_url,
          dock: project.dock || [],
        };

        return {
          content: [{ type: "text", text: JSON.stringify(jsonData, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleBasecampError(error) }],
        };
      }
    },
  );
}
