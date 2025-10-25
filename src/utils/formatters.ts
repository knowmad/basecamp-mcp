/**
 * Response formatting utilities for converting Basecamp data to Markdown or JSON
 */

import { CHARACTER_LIMIT } from "../constants.js";
import type { TruncationInfo } from "../types.js";

/**
 * Format a date string to human-readable format
 *
 * @param dateStr - ISO date string
 * @returns Formatted date string
 */
export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return "N/A";

  try {
    const date = new Date(dateStr);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Truncate a response if it exceeds CHARACTER_LIMIT
 *
 * @param response - Response string to check
 * @param data - Original data array (for truncation)
 * @param generateResponse - Function to regenerate response from truncated data
 * @returns Object with response text and truncation info
 */
export function truncateIfNeeded<T>(
  response: string,
  data: T[],
  generateResponse: (truncatedData: T[]) => string,
): { text: string; truncation: TruncationInfo } {
  if (response.length <= CHARACTER_LIMIT) {
    return {
      text: response,
      truncation: { truncated: false },
    };
  }

  // Calculate how many items we can fit
  const avgItemSize = response.length / data.length;
  const estimatedCount = Math.floor(CHARACTER_LIMIT / avgItemSize);
  const truncatedCount = Math.max(1, Math.floor(estimatedCount * 0.8)); // Use 80% to be safe

  const truncatedData = data.slice(0, truncatedCount);
  const truncatedResponse = generateResponse(truncatedData);

  const truncation: TruncationInfo = {
    truncated: true,
    truncation_message:
      `Response truncated from ${data.length} to ${truncatedData.length} items to stay within character limits. ` +
      `Use 'offset' parameter to see more results, or add filters to narrow the search.`,
    original_count: data.length,
    returned_count: truncatedData.length,
  };

  return {
    text: truncatedResponse,
    truncation,
  };
}

/**
 * Add truncation metadata to a JSON response
 *
 * @param jsonData - JSON object to augment
 * @param truncation - Truncation info
 * @returns JSON string with truncation metadata
 */
export function addTruncationToJson(
  jsonData: Record<string, unknown>,
  truncation: TruncationInfo,
): string {
  if (truncation.truncated) {
    return JSON.stringify({ ...jsonData, ...truncation }, null, 2);
  }
  return JSON.stringify(jsonData, null, 2);
}

/**
 * Add truncation notice to markdown response
 *
 * @param markdown - Markdown text
 * @param truncation - Truncation info
 * @returns Markdown with truncation notice appended
 */
export function addTruncationToMarkdown(
  markdown: string,
  truncation: TruncationInfo,
): string {
  if (truncation.truncated && truncation.truncation_message) {
    return `${markdown}\n\n---\n\n**⚠️ ${truncation.truncation_message}**`;
  }
  return markdown;
}

/**
 * Strip HTML tags from a string (basic implementation)
 *
 * @param html - HTML string
 * @returns Plain text
 */
export function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Truncate text to a maximum length with ellipsis
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
