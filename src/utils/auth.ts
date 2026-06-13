import { type BasecampClient, createBasecampClient } from "@37signals/basecamp";
import { readCredentials } from "./credentials.js";
import { getClientCredentials, refreshAccessToken } from "./oauth.js";

let cachedBearerToken: string | null = null;

/**
 * Return a valid bearer token, refreshing (and caching) one if necessary.
 * Throws if the user is not logged in.
 */
export async function getBearerToken(): Promise<string> {
  const creds = await readCredentials();

  if (!creds) {
    throw new Error("Not logged in. Use basecamp_login to authenticate.");
  }

  if (!cachedBearerToken) {
    const { clientId, clientSecret } = getClientCredentials();
    cachedBearerToken = await refreshAccessToken(
      creds.refreshToken,
      clientId,
      clientSecret,
    );
  }

  return cachedBearerToken;
}

export async function initializeBasecampClient(): Promise<BasecampClient> {
  const creds = await readCredentials();

  if (!creds) {
    throw new Error("Not logged in. Use basecamp_login to authenticate.");
  }

  const accessToken = await getBearerToken();

  return createBasecampClient({
    accountId: creds.accountId,
    accessToken,
  });
}

export function clearTokenCache(): void {
  cachedBearerToken = null;
}
