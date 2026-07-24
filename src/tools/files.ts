/**
 * Docs & Files tools for Basecamp MCP server.
 *
 * This is one Basecamp dock — a vault tree containing both documents and
 * uploads — so the whole hierarchy lives in one module:
 *   - Vaults are folders in the "Docs & Files" section (the container).
 *   - Documents are rich-text documents stored inside vaults.
 *   - Uploads are files stored inside vaults.
 *   - Blobs are inline attachments embedded in rich text via <bc-attachment>.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import {
  applyContentOperations,
  ContentOperationFields,
  htmlRules,
  validateContentOperations,
} from "../utils/contentOperations.js";
import { readCredentials } from "../utils/credentials.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { serializePerson } from "../utils/serializers.js";

const DOWNLOAD_DIR = join(tmpdir(), "basecamp-downloads");

function saveToDisk(filename: string, data: Uint8Array): string {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const filePath = join(DOWNLOAD_DIR, filename);
  writeFileSync(filePath, data);
  return filePath;
}

/**
 * Consume a download stream into a single byte array. The SDK's downloadURL
 * returns a ReadableStream that the caller must fully consume or cancel.
 */
export async function streamToBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const arrayBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

const IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const TEXT_CONTENT_TYPES = [
  "text/plain",
  "text/csv",
  "text/html",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/xml",
];

export function isImageContentType(contentType: string): boolean {
  return IMAGE_CONTENT_TYPES.some((t) => contentType.startsWith(t));
}

export function isTextContentType(contentType: string): boolean {
  return TEXT_CONTENT_TYPES.some((t) => contentType.startsWith(t));
}

export function inferContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    md: "text/markdown",
    html: "text/html",
  };
  return map[ext || ""] || "application/octet-stream";
}

export function registerFilesTools(server: McpServer): void {
  // ===== VAULTS (folders) =====

  // basecamp_list_vaults
  server.registerTool(
    "basecamp_list_vaults",
    {
      title: "List Basecamp Vaults",
      description:
        "List sub-vaults (folders) under a parent vault in the Docs & Files section.",
      inputSchema: {
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
        const vaults = await client.vaults.list(params.parent_vault_id);

        let filtered = [...vaults];
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
        const vault = await client.vaults.get(params.vault_id);

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
        const vault = await client.vaults.create(params.parent_vault_id, {
          title: params.title,
        });

        return {
          content: [
            {
              type: "text",
              text: `Vault created successfully!\n\nID: ${vault.id}\nTitle: ${vault.title}\nURL: ${vault.app_url}`,
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
        const vault = await client.vaults.update(params.vault_id, {
          title: params.title,
        });

        return {
          content: [
            {
              type: "text",
              text: `Vault updated successfully!\n\nID: ${vault.id}\nTitle: ${vault.title}`,
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

  // ===== DOCUMENTS =====

  // basecamp_list_documents
  server.registerTool(
    "basecamp_list_documents",
    {
      title: "List Basecamp Documents",
      description: "List documents in a vault.",
      inputSchema: {
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
        const documents = await client.documents.list(params.vault_id);

        let filtered = [...documents];
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
        const doc = await client.documents.get(params.document_id);

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
        vault_id: BasecampIdSchema.describe(
          "Vault ID to create the document in",
        ),
        title: z.string().min(1).describe("Document title"),
        content: z.string().describe("HTML document content"),
        status: z
          .enum(["active", "drafted"])
          .default("active")
          .describe(
            `Document status. Use "active" to publish, "drafted" to save as an unpublished draft.`,
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
        const doc = await client.documents.create(params.vault_id, {
          title: params.title,
          content: params.content,
          status: params.status,
        });

        return {
          content: [
            {
              type: "text",
              text: `Document created successfully!\n\nID: ${doc.id}\nTitle: ${doc.title}\nURL: ${doc.app_url}`,
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
            const current = await client.documents.get(params.document_id);
            const currentContent = current.content || "";
            finalContent = applyContentOperations(currentContent, params);
          } else {
            finalContent = params.content;
          }
        }

        const doc = await client.documents.update(params.document_id, {
          ...(params.title ? { title: params.title } : {}),
          ...(finalContent !== undefined ? { content: finalContent } : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: `Document updated successfully!\n\nID: ${doc.id}\nTitle: ${doc.title}`,
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

  // ===== UPLOADS (files) =====

  // basecamp_list_uploads
  server.registerTool(
    "basecamp_list_uploads",
    {
      title: "List Basecamp Uploads",
      description:
        "List files uploaded to a vault in the Docs & Files section.",
      inputSchema: {
        vault_id: BasecampIdSchema.describe("Vault ID containing the uploads"),
        filter: z
          .string()
          .optional()
          .describe(
            "Optional regular expression to filter uploads by filename",
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
        const uploads = await client.uploads.list(params.vault_id);

        let filtered = [...uploads];
        if (params.filter) {
          const regex = new RegExp(params.filter, "i");
          filtered = uploads.filter(
            (u) => regex.test(u.filename || "") || regex.test(u.title || ""),
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                filtered.map((u) => ({
                  id: u.id,
                  title: u.title,
                  filename: u.filename,
                  content_type: u.content_type,
                  byte_size: u.byte_size,
                  width: u.width,
                  height: u.height,
                  description: u.description,
                  creator: serializePerson(u.creator),
                  created_at: u.created_at,
                  updated_at: u.updated_at,
                  url: u.app_url,
                  download_url: u.download_url,
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

  // basecamp_get_upload
  server.registerTool(
    "basecamp_get_upload",
    {
      title: "Get Basecamp Upload",
      description:
        "Get a file uploaded to a vault. For images, returns the image content that the LLM can see directly. For text-based files (plain text, CSV, JSON, XML, etc.), returns the file content as text. For other binary formats, returns metadata only.",
      inputSchema: {
        upload_id: BasecampIdSchema.describe("Upload ID to retrieve"),
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
        const upload = await client.uploads.get(params.upload_id);

        if (!upload.download_url) {
          throw new Error(
            `Upload ${params.upload_id} has no download URL available.`,
          );
        }
        const downloadUrl = upload.download_url;
        const contentType = upload.content_type || "application/octet-stream";
        const filename = upload.filename || `upload-${upload.id}`;

        const metadata = {
          id: upload.id,
          title: upload.title,
          filename: upload.filename,
          content_type: upload.content_type,
          byte_size: upload.byte_size,
          width: upload.width,
          height: upload.height,
          description: upload.description,
          creator: serializePerson(upload.creator),
          created_at: upload.created_at,
          updated_at: upload.updated_at,
          url: upload.app_url,
          download_url: upload.download_url,
        };

        if (isImageContentType(contentType)) {
          const result = await client.downloadURL(downloadUrl);
          const bytes = await streamToBytes(result.body);
          const base64 = Buffer.from(bytes).toString("base64");

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(metadata, null, 2),
              },
              {
                type: "image" as const,
                data: base64,
                mimeType: contentType,
              },
            ],
          };
        }

        if (isTextContentType(contentType)) {
          const result = await client.downloadURL(downloadUrl);
          const bytes = await streamToBytes(result.body);
          const text = new TextDecoder().decode(bytes);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(metadata, null, 2),
              },
              {
                type: "text" as const,
                text: `--- File content of ${filename} ---\n${text}`,
              },
            ],
          };
        }

        const result = await client.downloadURL(downloadUrl);
        const bytes = await streamToBytes(result.body);
        const filePath = saveToDisk(filename, bytes);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...metadata,
                  saved_to: filePath,
                  note: `Binary file saved to disk. Use the file path to read it.`,
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

  // ===== BLOBS (inline attachments) =====

  // basecamp_download_blob
  server.registerTool(
    "basecamp_download_blob",
    {
      title: "Download Basecamp Blob",
      description:
        "Download an inline attachment from a <bc-attachment> tag found in document/message/comment HTML content. Extract the blob_id and filename from the href attribute (format: https://storage.3.basecamp.com/{accountId}/blobs/{blobId}/download/{filename}). For images, returns the image content that the LLM can see directly. For text-based files, returns the file content as text.",
      inputSchema: {
        blob_id: z
          .string()
          .describe("Blob UUID extracted from the <bc-attachment> href URL"),
        filename: z
          .string()
          .describe(
            "Filename extracted from the <bc-attachment> href URL (URL-decoded)",
          ),
        content_type: z
          .string()
          .optional()
          .describe(
            'Content type from the <bc-attachment> content-type attribute (e.g. "image/png"). If not provided, will attempt to infer from filename.',
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
        const creds = await readCredentials();
        if (!creds) {
          throw new Error("Not logged in. Use basecamp_login to authenticate.");
        }

        const client = await initializeBasecampClient();

        // Reconstruct the storage download URL from its parts. downloadURL
        // rewrites the origin to the configured API host, so only the path
        // (accountId/blobs/blobId/download/filename) needs to be correct.
        const blobUrl = `https://storage.3.basecamp.com/${creds.accountId}/blobs/${params.blob_id}/download/${encodeURIComponent(params.filename)}`;

        const result = await client.downloadURL(blobUrl);
        const bytes = await streamToBytes(result.body);

        const contentType =
          params.content_type ||
          (result.contentType !== "application/octet-stream"
            ? result.contentType
            : inferContentType(params.filename));

        if (isImageContentType(contentType)) {
          const base64 = Buffer.from(bytes).toString("base64");

          return {
            content: [
              {
                type: "text" as const,
                text: `Blob: ${params.filename} (${contentType})`,
              },
              {
                type: "image" as const,
                data: base64,
                mimeType: contentType,
              },
            ],
          };
        }

        if (isTextContentType(contentType)) {
          const text = new TextDecoder().decode(bytes);

          return {
            content: [
              {
                type: "text" as const,
                text: `--- File content of ${params.filename} ---\n${text}`,
              },
            ],
          };
        }

        const filePath = saveToDisk(params.filename, bytes);

        return {
          content: [
            {
              type: "text" as const,
              text: `Downloaded ${params.filename} (${contentType}, ${bytes.byteLength} bytes) and saved to: ${filePath}\n\nUse the file path to read it.`,
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
