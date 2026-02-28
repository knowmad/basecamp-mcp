/**
 * Upload & Blob download tools for Basecamp MCP server
 *
 * Uploads are files stored in vaults (Docs & Files section).
 * Blobs are inline attachments embedded in rich text via <bc-attachment> tags.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asyncPagedToArray } from "basecamp-client";
import { z } from "zod";
import { BasecampIdSchema } from "../schemas/common.js";
import { initializeBasecampClient } from "../utils/auth.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { serializePerson } from "../utils/serializers.js";

const DOWNLOAD_DIR = join(tmpdir(), "basecamp-downloads");

function saveToDisk(filename: string, data: ArrayBuffer): string {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const filePath = join(DOWNLOAD_DIR, filename);
  writeFileSync(filePath, Buffer.from(data));
  return filePath;
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

function isImageContentType(contentType: string): boolean {
  return IMAGE_CONTENT_TYPES.some((t) => contentType.startsWith(t));
}

function isTextContentType(contentType: string): boolean {
  return TEXT_CONTENT_TYPES.some((t) => contentType.startsWith(t));
}

export function registerUploadTools(server: McpServer): void {
  // basecamp_list_uploads
  server.registerTool(
    "basecamp_list_uploads",
    {
      title: "List Basecamp Uploads",
      description:
        "List files uploaded to a vault in the Docs & Files section.",
      inputSchema: {
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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
        const uploads = await asyncPagedToArray({
          fetchPage: client.uploads.list,
          request: {
            params: {
              bucketId: params.bucket_id,
              vaultId: params.vault_id,
            },
            query: {},
          },
        });

        let filtered = uploads;
        if (params.filter) {
          const regex = new RegExp(params.filter, "i");
          filtered = uploads.filter(
            (u) => regex.test(u.filename) || regex.test(u.title),
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
        bucket_id: BasecampIdSchema.describe("Project/bucket ID"),
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
        const response = await client.uploads.get({
          params: {
            bucketId: params.bucket_id,
            uploadId: params.upload_id,
          },
        });

        if (response.status !== 200 || !response.body) {
          throw new Error(`Failed to fetch upload: ${response.status}`);
        }

        const upload = response.body;
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

        // Extract filename from download_url
        const urlFilename =
          upload.download_url.split("/").pop() || upload.filename;

        if (isImageContentType(upload.content_type)) {
          const downloadResponse = await client.uploads.download({
            params: {
              bucketId: params.bucket_id,
              uploadId: params.upload_id,
              filename: urlFilename,
            },
          });

          const base64 = Buffer.from(downloadResponse.body).toString("base64");

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(metadata, null, 2),
              },
              {
                type: "image" as const,
                data: base64,
                mimeType: upload.content_type,
              },
            ],
          };
        }

        if (isTextContentType(upload.content_type)) {
          const downloadResponse = await client.uploads.download({
            params: {
              bucketId: params.bucket_id,
              uploadId: params.upload_id,
              filename: urlFilename,
            },
          });

          const text = new TextDecoder().decode(downloadResponse.body);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(metadata, null, 2),
              },
              {
                type: "text" as const,
                text: `--- File content of ${upload.filename} ---\n${text}`,
              },
            ],
          };
        }

        const downloadResponse = await client.uploads.download({
          params: {
            bucketId: params.bucket_id,
            uploadId: params.upload_id,
            filename: urlFilename,
          },
        });

        const filePath = saveToDisk(upload.filename, downloadResponse.body);

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
        const client = await initializeBasecampClient();

        const downloadResponse = await client.blobs.download({
          params: {
            blobId: params.blob_id,
            filename: params.filename,
          },
        });

        const contentType =
          params.content_type || inferContentType(params.filename);

        if (isImageContentType(contentType)) {
          const base64 = Buffer.from(downloadResponse.body).toString("base64");

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
          const text = new TextDecoder().decode(downloadResponse.body);

          return {
            content: [
              {
                type: "text" as const,
                text: `--- File content of ${params.filename} ---\n${text}`,
              },
            ],
          };
        }

        const filePath = saveToDisk(params.filename, downloadResponse.body);

        return {
          content: [
            {
              type: "text" as const,
              text: `Downloaded ${params.filename} (${contentType}, ${downloadResponse.body.byteLength} bytes) and saved to: ${filePath}\n\nUse the file path to read it.`,
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

function inferContentType(filename: string): string {
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
