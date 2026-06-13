/**
 * People tools for Basecamp MCP server
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

export function registerPeopleTools(server: McpServer): void {
  server.registerTool(
    "basecamp_get_me",
    {
      title: "Get My Basecamp Profile",
      description:
        "Get your full profile for the authenticated user (id, name, email, title, attachable_sgid). To simply check whether you're logged in, use basecamp_whoami.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const client = await initializeBasecampClient();

        const me = await client.people.me();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: me.id,
                  name: me.name,
                  email: me.email_address,
                  title: me.title,
                  attachable_sgid: me.attachable_sgid,
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

  server.registerTool(
    "basecamp_list_people",
    {
      title: "List Basecamp People",
      description: "List all people in the Basecamp account.",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe(
            "Optional regular expression to filter people by name, email, or title",
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

        const people = await client.people.list();

        // Apply filter if provided
        let filteredPeople = [...people];
        if (params.filter) {
          const regex = new RegExp(params.filter, "i");
          filteredPeople = people.filter(
            (p) =>
              regex.test(p.name) ||
              regex.test(p.email_address || "") ||
              regex.test(p.title || ""),
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                filteredPeople.map((p) => ({
                  id: p.id,
                  name: p.name,
                  email: p.email_address,
                  title: p.title,
                  attachable_sgid: p.attachable_sgid,
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

  server.registerTool(
    "basecamp_get_person",
    {
      title: "Get Basecamp Person",
      description: "Get details about a specific person.",
      inputSchema: {
        person_id: BasecampIdSchema,
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

        const person = await client.people.get(params.person_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: person.id,
                  name: person.name,
                  email: person.email_address,
                  title: person.title,
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
}
