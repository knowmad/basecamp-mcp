/**
 * Shared utilities and schemas for content manipulation operations
 * Used by messages, comments, and other content-based tools
 */

import { z } from "zod";

export const htmlRules = `

HTML rules for content:

* Allowed tags: p, span, h2, h3, h4, br, strong, em, strike, code, a (with href attribute), pre, ol, ul, li, blockquote, mark, figure, figcaption, table, tbody, tr, th, td, div, bc-attachment.
* Wrap every paragraph in <p>...</p>, and put <p><br></p> between one paragraph and the next. Both parts are necessary: newlines and blank lines in your HTML are discarded, and Basecamp shows no space around a <p> on its own, so two paragraphs with nothing between them are shown as one block of text. Do not rely on line breaks in your HTML to separate paragraphs.
* Headings: use <h2>, <h3>, <h4> as appropriate.
* Inline code: <code>text</code>. Preformatted blocks: <pre>text</pre>.
* Ordered lists: <ol><li>...</li></ol>. Unordered: <ul><li>...</li></ul>.
* Tables: <table><tbody><tr><th>Heading</th>...</tr><tr><td>Cell</td>...</tr></tbody></table>
* To mention people: <bc-attachment sgid="{ person.attachable_sgid }" content-type="application/vnd.basecamp.mention"></bc-attachment>
* Single image: <bc-attachment sgid="{ attachment.attachable_sgid }"></bc-attachment>
* Image gallery: wrap multiple <bc-attachment sgid="..." presentation="gallery"> in a <div>.
* A bc-attachment needs an attachable_sgid. For a file that is already in Basecamp, take the sgid from the HTML content of the message, comment or card that shows it, or use basecamp_list_recordings. For a file that is not in Basecamp yet, such as an image at an external URL or a screenshot on disk, upload it with basecamp_create_attachment and use the sgid that it returns. There is no <img> tag, so an external image URL can never be embedded directly: upload it, or accept that it stays a plain link.
* Basecamp auto-enriches bc-attachment tags after saving (adds url, href, filename, content-type, etc.) — you never need to write those.
* When you see an existing, already-enriched <bc-attachment> tag (e.g. from a previous list/get call), leave its inner HTML alone. Before any content_append/content_prepend/search_replace runs, it is automatically collapsed back to its minimal form (sgid, presentation, caption, and content-type for mentions) — you don't need to strip it yourself, and doing so manually is unnecessary and risks mismatched find strings.
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
 * Attributes we keep when normalizing a <bc-attachment> tag fetched back from
 * Basecamp. Everything else — including the enriched inner HTML Basecamp
 * injects after saving (e.g. a <figure><img/><figcaption>...) — is dropped.
 */
const ALLOWED_BC_ATTACHMENT_ATTRS = new Set([
  "sgid",
  "presentation",
  "caption",
  "content-type",
]);

function normalizeBcAttachmentAttrs(attrString: string): string {
  const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  const kept: string[] = [];
  for (const [, name, value] of attrString.matchAll(attrRegex)) {
    if (ALLOWED_BC_ATTACHMENT_ATTRS.has(name)) {
      kept.push(`${name}="${value}"`);
    }
  }
  return kept.length > 0 ? ` ${kept.join(" ")}` : "";
}

/**
 * Strip Basecamp's server-side enrichment out of any <bc-attachment> tag in
 * `html`, collapsing it back down to its minimal, canonical form (sgid /
 * presentation / caption / content-type only, no inner HTML).
 *
 * Content fetched back from Basecamp (via a GET) has already been enriched:
 * each <bc-attachment> tag gets a full <figure><img/><figcaption>...
 * injected inside it. Running search_replace / append / prepend against that
 * enriched HTML is fragile — the enriched markup is large, can shift between
 * requests, and edits near it have been observed to duplicate or detach the
 * injected <figure> block. Normalizing back to the minimal tag before every
 * partial edit removes that enriched HTML as a moving target entirely;
 * Basecamp re-enriches the minimal tag fresh on save either way.
 */
export function normalizeBcAttachments(html: string): string {
  // Self-closing form first: <bc-attachment .../>
  let result = html.replace(
    /<bc-attachment\b([^>]*)\/>/g,
    (_match, attrs: string) =>
      `<bc-attachment${normalizeBcAttachmentAttrs(attrs)}></bc-attachment>`,
  );

  // Open/close form: <bc-attachment ...>...enriched HTML...</bc-attachment>
  // (Run after the self-closing pass so no stray `/` throws off `[^>]*`.)
  result = result.replace(
    /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/g,
    (_match, attrs: string) =>
      `<bc-attachment${normalizeBcAttachmentAttrs(attrs)}></bc-attachment>`,
  );

  return result;
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

  // Apply partial operations. Normalize any <bc-attachment> tags back to
  // their minimal form first — see normalizeBcAttachments() for why.
  let finalContent = normalizeBcAttachments(currentContent);

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
