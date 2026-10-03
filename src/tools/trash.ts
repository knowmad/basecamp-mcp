/**
 * Trash tools for Basecamp MCP server: move any item to the trash, and
 * restore it.
 *
 * The Basecamp API has no permanent delete. The trash endpoint works on all
 * the recordings (todo lists, groups, todos, messages, comments, documents,
 * cards and more), so two tools cover all the types.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";

export function registerTrashTools(server: McpServer): void {
  server.registerTool(
    "basecamp_trash",
    {
      title: "Move Basecamp Item to Trash",
      description:
        "Move an item to the trash: a todo list, a group (section), a todo, a message, a comment, a document, a folder, an upload or a kanban card. The items in it go too, for example the todos of a todo list. Basecamp deletes the items in the trash permanently after some time. Until then, basecamp_restore brings the item back with the same ID.",
      inputSchema: {
        recording_id: BasecampIdSchema.describe("ID of the item to trash"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await initializeBasecampClient();
        await client.recordings.trash(params.recording_id);

        return {
          content: [
            {
              type: "text",
              text: `Moved to the trash!\n\nID: ${params.recording_id}\nTo undo, use basecamp_restore with this ID.`,
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
    "basecamp_restore",
    {
      title: "Restore Basecamp Item",
      description:
        'Bring an item back from the trash or from the archive. The items in it come back too, for example the todos of a todo list. To find the IDs of trashed items, use basecamp_list_recordings with status "trashed".',
      inputSchema: {
        recording_id: BasecampIdSchema.describe("ID of the item to restore"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await initializeBasecampClient();
        // The "unarchive" endpoint sets the status to active. It restores an
        // item from the trash too.
        await client.recordings.unarchive(params.recording_id);

        return {
          content: [
            {
              type: "text",
              text: `Restored!\n\nID: ${params.recording_id}`,
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
