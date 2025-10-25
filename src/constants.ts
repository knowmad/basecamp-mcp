/**
 * Shared constants for the Basecamp MCP server
 */

/** Maximum response size in characters to prevent overwhelming LLM context */
export const CHARACTER_LIMIT = 25000;

/** Default number of items to return in paginated responses */
export const DEFAULT_LIMIT = 20;

/** Maximum number of items allowed in a single request */
export const MAX_LIMIT = 100;

/** Basecamp API base URL pattern */
export const BASECAMP_API_BASE = "https://3.basecampapi.com";

/** Basecamp web URL pattern for parsing */
export const BASECAMP_WEB_BASE = "https://3.basecamp.com";
