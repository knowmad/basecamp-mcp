/**
 * Authentication utilities for Basecamp API
 */

import { buildClient, type Client, getBearerToken } from "basecamp-client";

/** Cached bearer token to avoid repeated OAuth requests */
let cachedBearerToken: string | null = null;

/**
 * Initialize and return an authenticated Basecamp client.
 *
 * Uses environment variables:
 * - BASECAMP_CLIENT_ID
 * - BASECAMP_CLIENT_SECRET
 * - BASECAMP_REFRESH_TOKEN
 * - BASECAMP_USER_AGENT (optional)
 * - BASECAMP_ACCOUNT_ID
 *
 * @param accountId - Basecamp account ID to use for the client
 * @returns Authenticated Basecamp client instance
 * @throws Error if required environment variables are missing or authentication fails
 */
export async function initializeBasecampClient(): Promise<Client> {
  // Validate required environment variables
  const requiredEnvVars = [
    "BASECAMP_CLIENT_ID",
    "BASECAMP_CLIENT_SECRET",
    "BASECAMP_REFRESH_TOKEN",
    "BASECAMP_ACCOUNT_ID",
  ];

  const missing = requiredEnvVars.filter((varName) => !process.env[varName]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Please set these in your environment or .env file.`,
    );
  }

  // Get bearer token (cache if possible to avoid repeated OAuth requests)
  if (!cachedBearerToken) {
    try {
      cachedBearerToken = await getBearerToken({
        clientId: process.env.BASECAMP_CLIENT_ID!,
        clientSecret: process.env.BASECAMP_CLIENT_SECRET!,
        refreshToken: process.env.BASECAMP_REFRESH_TOKEN!,
        userAgent: process.env.BASECAMP_USER_AGENT,
      });
    } catch (error) {
      throw new Error(
        `Failed to obtain Basecamp access token: ${error instanceof Error ? error.message : String(error)}. ` +
          `Check your BASECAMP_CLIENT_ID, BASECAMP_CLIENT_SECRET, and BASECAMP_REFRESH_TOKEN are correct.`,
      );
    }
  }

  // Build and return client
  return buildClient({
    bearerToken: cachedBearerToken,
    accountId: process.env.BASECAMP_ACCOUNT_ID!,
    userAgent: process.env.BASECAMP_USER_AGENT,
  });
}

/**
 * Clear the cached bearer token (useful for forcing token refresh)
 */
export function clearTokenCache(): void {
  cachedBearerToken = null;
}
