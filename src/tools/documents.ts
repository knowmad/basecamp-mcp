/**
 * Document, Vault & File download tools for Basecamp MCP server
 *
 * Vaults are folders in Basecamp's "Docs & Files" section.
 * Documents are rich-text documents stored inside vaults.
 * Uploads are files stored in vaults.
 * Blobs are inline attachments embedded in rich text via <bc-attachment> tags.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import {
  applyContentOperations,
  ContentOperationFields,
  htmlRules,
  validateContentOperations,
} from "../utils/contentOperations.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { serializePerson } from "../utils/serializers.js";

export function registerDocumentTools(server: McpServer): void {
  // basecamp_list_vaults
  server.registerTool(
    "basecamp_list_vaults",
    {
      title: "List Basecamp Vaults",
      description:
        "List sub-vaults (folders) under a parent vault in the Docs & Files section.",
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
        parent_vault_id: BasecampIdSchema.describe(
          "Parent vault ID (use the vault ID from the project's dock)",
        ),
        filter: z
          .string()
          .optional()
          .describe("Optional regular expression to filter vaults by title"),
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
        const vaults = await asyncPagedToArray({
          fetchPage: client.vaults.list,
          request: {
            params: {
              bucketId: params.bucket_id,
              parentVaultId: params.parent_vault_id,
            },
            query: {},
          },
        });

        let filtered = vaults;
        if (params.filter) {
          const regex = new RegExp(params.filter, "i");
          filtered = vaults.filter((v) => regex.test(v.title));
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                filtered.map((v) => ({
                  id: v.id,
                  title: v.title,
                  documents_count: v.documents_count,
                  uploads_count: v.uploads_count,
                  vaults_count: v.vaults_count,
                  creator: serializePerson(v.creator),
                  created_at: v.created_at,
                  url: v.app_url,
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

  // basecamp_get_vault
  server.registerTool(
    "basecamp_get_vault",
    {
      title: "Get Basecamp Vault",
      description:
        "Get details of a vault (folder) including document/upload/sub-vault counts.",
      inputSchema: {
        bucket_id: BasecampIdSchema.describe(
          "Project/bucket ID containing the vault",
        ),
        vault_id: BasecampIdSchema.describe("Vault ID to retrieve"),
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
        const response = await client.vaults.get({
          params: {
            bucketId: params.bucket_id,
            vaultId: params.vault_id,
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error(`Failed to fetch vault: ${response.status}`);
        }

        const vault = response.body;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: vault.id,
                  title: vault.title,
                  documents_count: vault.documents_count,
                  documents_url: vault.documents_url,
                  uploads_count: vault.uploads_count,
                  uploads_url: vault.uploads_url,
                  vaults_count: vault.vaults_count,
                  vaults_url: vault.vaults_url,
                  creator: serializePerson(vault.creator),
                  created_at: vault.created_at,
                  updated_at: vault.updated_at,
                  url: vault.app_url,
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

  // basecamp_create_vault
  server.registerTool(
    "basecamp_create_vault",
    {
      title: "Create Basecamp Vault",
      description: "Create a new vault (folder) under a parent vault.",
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
        parent_vault_id: BasecampIdSchema.describe(
          "Parent vault ID to create the new vault under",
        ),
        title: z.string().min(1).describe("Vault title/name"),
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
        const response = await client.vaults.create({
          params: {
            bucketId: params.bucket_id,
            parentVaultId: params.parent_vault_id,
          },
          body: {
            title: params.title,
          },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create vault");
        }

        return {
          content: [
            {
              type: "text",
              text: `Vault created successfully!\n\nID: ${response.body.id}\nTitle: ${response.body.title}\nURL: ${response.body.app_url}`,
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

  // basecamp_update_vault
  server.registerTool(
    "basecamp_update_vault",
    {
      title: "Update Basecamp Vault",
      description: "Update the title of a vault (folder).",
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
        vault_id: BasecampIdSchema.describe("Vault ID to update"),
        title: z.string().min(1).describe("New vault title"),
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
        const response = await client.vaults.update({
          params: {
            bucketId: params.bucket_id,
            vaultId: params.vault_id,
          },
          body: {
            title: params.title,
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error("Failed to update vault");
        }

        return {
          content: [
            {
              type: "text",
              text: `Vault updated successfully!\n\nID: ${response.body.id}\nTitle: ${response.body.title}`,
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

  // basecamp_list_documents
  server.registerTool(
    "basecamp_list_documents",
    {
      title: "List Basecamp Documents",
      description: "List documents in a vault.",
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
        vault_id: BasecampIdSchema.describe(
          "Vault ID containing the documents",
        ),
        filter: z
          .string()
          .optional()
          .describe("Optional regular expression to filter documents by title"),
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
        const documents = await asyncPagedToArray({
          fetchPage: client.documents.list,
          request: {
            params: {
              bucketId: params.bucket_id,
              vaultId: params.vault_id,
            },
            query: {},
          },
        });

        let filtered = documents;
        if (params.filter) {
          const regex = new RegExp(params.filter, "i");
          filtered = documents.filter(
            (d) => regex.test(d.title) || regex.test(d.content || ""),
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                filtered.map((d) => ({
                  id: d.id,
                  title: d.title,
                  creator: serializePerson(d.creator),
                  created_at: d.created_at,
                  updated_at: d.updated_at,
                  url: d.app_url,
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

  // basecamp_get_document
  server.registerTool(
    "basecamp_get_document",
    {
      title: "Get Basecamp Document",
      description: "Retrieve a single document with its full content.",
      inputSchema: {
        bucket_id: BasecampIdSchema.describe(
          "Project/bucket ID containing the document",
        ),
        document_id: BasecampIdSchema.describe("Document ID to retrieve"),
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
        const response = await client.documents.get({
          params: {
            bucketId: params.bucket_id,
            documentId: params.document_id,
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error(`Failed to fetch document: ${response.status}`);
        }

        const doc = response.body;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: doc.id,
                  title: doc.title,
                  content: doc.content || "",
                  author: serializePerson(doc.creator),
                  created_at: doc.created_at,
                  updated_at: doc.updated_at,
                  url: doc.app_url,
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

  // basecamp_create_document
  server.registerTool(
    "basecamp_create_document",
    {
      title: "Create Basecamp Document",
      description: `Create a new document in a vault. ${htmlRules}`,
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
        vault_id: BasecampIdSchema.describe(
          "Vault ID to create the document in",
        ),
        title: z.string().min(1).describe("Document title"),
        content: z.string().describe("HTML document content"),
        status: z
          .enum(["active", "draft"])
          .default("active")
          .describe("Document status"),
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
        const response = await client.documents.create({
          params: {
            bucketId: params.bucket_id,
            vaultId: params.vault_id,
          },
          body: {
            title: params.title,
            content: params.content,
            status: params.status,
          },
        });

        if (response.status !== 201 || !response.body) {
          throw new Error("Failed to create document");
        }

        return {
          content: [
            {
              type: "text",
              text: `Document created successfully!\n\nID: ${response.body.id}\nTitle: ${response.body.title}\nURL: ${response.body.app_url}`,
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

  // basecamp_update_document
  server.registerTool(
    "basecamp_update_document",
    {
      title: "Update Basecamp Document",
      description: `Update a document. Use partial content operations when possible to save on token usage. ${htmlRules}`,
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
        document_id: BasecampIdSchema.describe("Document ID to update"),
        title: z.string().min(1).optional().describe("New document title"),
        ...ContentOperationFields,
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
        validateContentOperations(params, ["title"]);

        const client = await initializeBasecampClient();
        let finalContent: string | undefined;

        const hasPartialOps =
          params.content_append ||
          params.content_prepend ||
          params.search_replace;

        if (hasPartialOps || params.content !== undefined) {
          if (hasPartialOps) {
            const currentResponse = await client.documents.get({
              params: {
                bucketId: params.bucket_id,
                documentId: params.document_id,
              },
            });

            if (currentResponse.status !== 200 || !currentResponse.body) {
              throw new Error(
                `Failed to fetch current document for partial update: ${currentResponse.status}`,
              );
            }

            const currentContent = currentResponse.body.content || "";
            finalContent = applyContentOperations(currentContent, params);
          } else {
            finalContent = params.content;
          }
        }

        const response = await client.documents.update({
          params: {
            bucketId: params.bucket_id,
            documentId: params.document_id,
          },
          body: {
            ...(params.title ? { title: params.title } : {}),
            ...(finalContent !== undefined ? { content: finalContent } : {}),
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error("Failed to update document");
        }

        return {
          content: [
            {
              type: "text",
              text: `Document updated successfully!\n\nID: ${response.body.id}\nTitle: ${response.body.title}`,
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
