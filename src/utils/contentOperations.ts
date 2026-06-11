/**
 * Shared utilities and schemas for content manipulation operations
 * Used by messages, comments, and other content-based tools
 */

import { z } from "zod";

export const htmlRules = `

HTML rules for content:

* Allowed tags: p, span, h2, h3, h4, br, strong, em, strike, code, a (with href attribute), pre, ol, ul, li, blockquote, mark, figure, figcaption, table, tbody, tr, th, td, div, bc-attachment.
* Use <p> for paragraphs. Use <p><br></p> for empty line spacing between paragraphs.
* Headings: use <h2>, <h3>, <h4> as appropriate.
* Inline code: <code>text</code>. Preformatted blocks: <pre>text</pre>.
* Ordered lists: <ol><li>...</li></ol>. Unordered: <ul><li>...</li></ul>.
* Tables: <table><tbody><tr><th>Heading</th>...</tr><tr><td>Cell</td>...</tr></tbody></table>
* To mention people: <bc-attachment sgid="{ person.attachable_sgid }" content-type="application/vnd.basecamp.mention"></bc-attachment>
* Single image: <bc-attachment sgid="{ attachment.attachable_sgid }"></bc-attachment>
* Image gallery: wrap multiple <bc-attachment sgid="..." presentation="gallery"> in a <div>.
* Basecamp auto-enriches bc-attachment tags after saving (adds url, href, filename, content-type, etc.) — you never need to write those.
* To consume less tokens, existing <bc-attachment> tags can be rewritten keeping only: sgid, presentation, caption. For mentions also keep content-type="application/vnd.basecamp.mention". Drop everything else including inner HTML.
* Background highlights: <mark style="background-color: var(--highlight-bg-N);">...</mark>
* Text color highlights: <span style="color: var(--highlight-N);">...</span>
* For both, N is 1 (yellow), 2 (amber), 3 (red), 4 (pink), 5 (purple), 6 (blue), 7 (teal), 8 (near-white), or 9 (light gray).
`;

/**
 * Shared Zod schema for content operation fields
 * These fields can be composed into tool-specific schemas
 */
export const ContentOperationFields = {
  content: z
    .string()
    .optional()
    .describe(
      `If provided, replaces entire HTML content. Cannot be used with content_append, content_prepend, or search_replace.`,
    ),
  content_append: z
    .string()
    .optional()
    .describe(
      "Text to append to the end of current content. Cannot be used with content.",
    ),
  content_prepend: z
    .string()
    .optional()
    .describe(
      "Text to prepend to the beginning of current content. Cannot be used with content.",
    ),
  search_replace: z
    .array(
      z.object({
        find: z.string().describe("Text to search for"),
        replace: z
          .string()
          .describe("Text to replace ALL the occurrences with"),
      }),
    )
    .optional()
    .describe(
      "Array of search-replace operations to apply to current content. Cannot be used with content.",
    ),
};

/**
 * Parameters for applying content operations
 */
export interface ContentOperationParams {
  content?: string;
  content_append?: string;
  content_prepend?: string;
  search_replace?: Array<{ find: string; replace: string }>;
}

/**
 * Apply content operations to existing content
 *
 * @param currentContent - The current content to operate on
 * @param operations - The operations to apply
 * @returns The final content after applying all operations, or undefined if no operations
 * @throws Error if validation fails (mutual exclusivity, no operations provided)
 */
export function applyContentOperations(
  currentContent: string,
  operations: ContentOperationParams,
): string | undefined {
  const hasPartialOps =
    operations.content_append ||
    operations.content_prepend ||
    operations.search_replace;

  // Validate mutual exclusivity
  if (operations.content && hasPartialOps) {
    throw new Error(
      "Cannot use 'content' with partial operations (content_append, content_prepend, search_replace). Use either full replacement or partial operations, not both.",
    );
  }

  // If full content replacement, return it directly
  if (operations.content !== undefined) {
    return operations.content;
  }

  // If no operations at all, return undefined (no changes)
  if (!hasPartialOps) {
    return undefined;
  }

  // Apply partial operations
  let finalContent = currentContent;

  // Apply search-replace operations first
  if (operations.search_replace) {
    for (const operation of operations.search_replace) {
      // Check if the search string exists in the content
      if (!finalContent.includes(operation.find)) {
        throw new Error(
          `Search string not found: "${operation.find}". The content does not contain this text.`,
        );
      }
      finalContent = finalContent.replaceAll(operation.find, operation.replace);
    }
  }

  // Apply prepend
  if (operations.content_prepend) {
    finalContent = operations.content_prepend + finalContent;
  }

  // Apply append
  if (operations.content_append) {
    finalContent = finalContent + operations.content_append;
  }

  return finalContent;
}

/**
 * Validate that at least one content operation is provided
 *
 * @param operations - The operations to validate
 * @param additionalFields - Additional field names that count as valid operations
 * @throws Error if no operations are provided
 */
export function validateContentOperations(
  operations: ContentOperationParams,
  additionalFields: string[] = [],
): void {
  const hasContentOp =
    operations.content ||
    operations.content_append ||
    operations.content_prepend ||
    operations.search_replace;

  const hasAdditionalFields = additionalFields.some(
    (field) => (operations as Record<string, unknown>)[field] !== undefined,
  );

  if (!hasContentOp && !hasAdditionalFields) {
    const fieldsStr = [
      "content",
      "partial operations",
      ...additionalFields,
    ].join(", ");
    throw new Error(`At least one field (${fieldsStr}) must be provided`);
  }
}
