import { buildClient, type Client, getBearerToken } from "basecamp-client";
import { readCredentials } from "./credentials.js";
import { getClientCredentials } from "./oauth.js";

let cachedBearerToken: string | null = null;

export async function initializeBasecampClient(): Promise<Client> {
	const creds = await readCredentials();

	if (!creds) {
		throw new Error("Not logged in. Use basecamp_login to authenticate.");
	}

	const { clientId, clientSecret } = getClientCredentials();

	if (!cachedBearerToken) {
		cachedBearerToken = await getBearerToken({
			clientId,
			clientSecret,
			refreshToken: creds.refreshToken,
		});
	}

	return buildClient({
		bearerToken: cachedBearerToken,
		accountId: creds.accountId,
	});
}

export function clearTokenCache(): void {
	cachedBearerToken = null;
}
