/**
 * People tools for Basecamp MCP server
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

const ListPeopleSchema = z.object({


}).strict();

const GetPersonSchema = z.object({

  person_id: BasecampIdSchema,

}).strict();

export function registerPeopleTools(server: McpServer): void {
  server.registerTool(
    "basecamp_list_people",
    {
      title: "List Basecamp People",
      description: "List all people in the Basecamp account.",
      inputSchema: ListPeopleSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof ListPeopleSchema>) => {
      try {
        const client = await initializeBasecampClient();
        const people = await asyncPagedToArray({
          fetchPage: client.people.list,
          request: { query: {} }
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(people.map(p => ({
              id: p.id,
              name: p.name,
              email: p.email_address,
              title: p.title,
            })), null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );

  server.registerTool(
    "basecamp_get_person",
    {
      title: "Get Basecamp Person",
      description: "Get details about a specific person.",
      inputSchema: GetPersonSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: z.infer<typeof GetPersonSchema>) => {
      try {
        const client = await initializeBasecampClient();

        const response = await client.people.get({
          params: { personId: params.person_id },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error("Failed to get person");
        }

        const person = response.body;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: person.id,
              name: person.name,
              email: person.email_address,
              title: person.title,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: handleBasecampError(error) }] };
      }
    }
  );
}
