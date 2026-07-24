/**
 * Common Zod schemas used across multiple tools
 */

import { z } from "zod";

/**
 * Basecamp ID parameter schema.
 *
 * Uses `z.coerce.number()` rather than `z.number()` so that IDs arriving as
 * strings are accepted. Some MCP clients (e.g. Claude Desktop / Cowork)
 * serialize tool arguments as strings — a bare `z.number()` then rejects them
 * with "Expected number, received string" (see GitHub issue #5). Coercion
 * keeps the generated JSON Schema as `{"type":"number"}` while still accepting
 * the stringified form; a non-numeric value coerces to NaN and is rejected
 * with a clear error.
 */
export const BasecampIdSchema = z.coerce
  .number()
  .describe("Basecamp resource identifier");

/**
 * Basecamp URL schema
 */
export const BasecampUrlSchema = z
  .string()
  .url()
  .startsWith("https://3.basecamp.com/", "Must be a valid Basecamp URL")
  .describe(
    "Basecamp resource URL (e.g., https://3.basecamp.com/{accountId}/buckets/{bucketId}/messages/{id})",
  );
