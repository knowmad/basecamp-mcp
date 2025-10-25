/**
 * Error handling utilities for Basecamp API
 */

/**
 * Convert Basecamp API errors to helpful, actionable error messages for LLMs.
 *
 * @param error - Error object from API call
 * @returns Human-readable error message with guidance
 */
export function handleBasecampError(error: unknown): string {
  // Handle HTTP response errors
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;

    switch (status) {
      case 400:
        return (
          "Error: Bad request. Check that all required parameters are provided and formatted correctly. " +
          extractErrorDetails(error)
        );

      case 401:
        return (
          "Error: Authentication failed. Your access token may have expired. " +
          "Try restarting the server to refresh the token, or check your BASECAMP_REFRESH_TOKEN is valid."
        );

      case 403:
        return (
          "Error: Access denied. You don't have permission to access this resource. " +
          "Check that you're using the correct account ID and that your Basecamp user has access to this project/resource."
        );

      case 404:
        return (
          "Error: Resource not found. The requested resource (message, todo, project, etc.) doesn't exist or has been deleted. " +
          "Verify the ID is correct and the resource hasn't been moved to trash."
        );

      case 422:
        return (
          "Error: Validation failed. The request data didn't pass Basecamp's validation rules. " +
          extractErrorDetails(error) +
          " Check the data format and required fields."
        );

      case 429:
        return (
          "Error: Rate limit exceeded. Too many requests have been made to the Basecamp API. " +
          "Please wait a moment before trying again."
        );

      case 500:
      case 502:
      case 503:
      case 504:
        return (
          "Error: Basecamp server error. The Basecamp API is experiencing issues. " +
          "Please try again in a moment."
        );

      default:
        return `Error: API request failed with status ${status}. ${extractErrorDetails(error)}`;
    }
  }

  // Handle network/connection errors
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;

    if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
      return (
        "Error: Request timed out. The Basecamp API took too long to respond. " +
        "Please try again."
      );
    }

    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      return (
        "Error: Unable to connect to Basecamp API. " +
        "Check your internet connection and try again."
      );
    }
  }

  // Generic error fallback
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Extract additional error details from API response if available.
 *
 * @param error - Error object
 * @returns Error details string or empty string
 */
function extractErrorDetails(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  // Try to extract error message from response body
  if ("body" in error && error.body && typeof error.body === "object") {
    const body = error.body as Record<string, unknown>;

    if ("error" in body && typeof body.error === "string") {
      return `Details: ${body.error}`;
    }

    if ("message" in body && typeof body.message === "string") {
      return `Details: ${body.message}`;
    }

    if ("errors" in body && Array.isArray(body.errors)) {
      const errorMessages = body.errors
        .map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
        .join(", ");
      return `Details: ${errorMessages}`;
    }
  }

  return "";
}
