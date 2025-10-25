/**
 * Common Zod schemas used across multiple tools
 */

import { z } from "zod";

/**
 * Basecamp ID parameter schema
 */
export const BasecampIdSchema = z
  .number()
  .describe("Basecamp resource identifier");

/**
 * Basecamp URL schema
 */
export const BasecampUrlSchema = z
  .string()
  .url()
  .startsWith("https://3.basecamp.com/", "Must be a valid Basecamp URL")
  .describe("Basecamp resource URL (e.g., https://3.basecamp.com/{accountId}/buckets/{bucketId}/messages/{id})");
