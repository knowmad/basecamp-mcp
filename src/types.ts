/**
 * TypeScript types and enums for the Basecamp MCP server
 */

/** Parsed Basecamp URL structure */
export interface ParsedBasecampUrl {
  accountId: string;
  bucketId: string;
  resourceType: string;
  resourceId: string;
  fullUrl: string;
}

/** Pagination metadata for list responses */
export interface PaginationMetadata {
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

/** Truncation metadata when response exceeds character limit */
export interface TruncationInfo {
  truncated: boolean;
  truncation_message?: string;
  original_count?: number;
  returned_count?: number;
}
