import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { initializeBasecampClient, clearTokenCache } from "../utils/auth.js";
import {
	deleteCredentials,
	getCredentialsPath,
	readCredentials,
	writeCredentials,
} from "../utils/credentials.js";
import { handleBasecampError } from "../utils/errorHandlers.js";
import { fetchBasecampAccounts, performBasecampOAuthLogin } from "../utils/oauth.js";

export function registerAuthTools(server: McpServer): void {
	server.registerTool(
		"basecamp_login",
		{
			title: "Login to Basecamp",
			description:
				"Authenticate with Basecamp via OAuth. Opens a browser window for authorization. " +
				"If you have multiple Basecamp accounts, call first without account_id to see the list, " +
				"then call again with the desired account_id.",
			inputSchema: {
				account_id: z
					.number()
					.optional()
					.describe(
						"Basecamp account ID. If omitted and you have multiple accounts, returns the list to choose from.",
					),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async (params) => {
			try {
				const { accessToken, refreshToken } =
					await performBasecampOAuthLogin();

				const accounts = await fetchBasecampAccounts(accessToken);

				if (accounts.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No Basecamp 3 accounts found for this user.",
							},
						],
					};
				}

				let accountId: string;

				if (params.account_id) {
					const match = accounts.find(
						(a) => a.id === params.account_id,
					);
					if (!match) {
						return {
							content: [
								{
									type: "text",
									text: `Account ID ${params.account_id} not found. Available accounts:\n${formatAccountList(accounts)}`,
								},
							],
						};
					}
					accountId = String(match.id);
				} else if (accounts.length === 1) {
					accountId = String(accounts[0].id);
				} else {
					return {
						content: [
							{
								type: "text",
								text: `Multiple Basecamp accounts found. Please call basecamp_login again with account_id set to one of:\n${formatAccountList(accounts)}`,
							},
						],
					};
				}

				clearTokenCache();

				await writeCredentials({ refreshToken, accountId });

				return {
					content: [
						{
							type: "text",
							text: `Login successful! Credentials saved to ${getCredentialsPath()}. Account ID: ${accountId}.`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Login failed: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		},
	);

	server.registerTool(
		"basecamp_logout",
		{
			title: "Logout from Basecamp",
			description: "Remove stored Basecamp credentials.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			clearTokenCache();
			await deleteCredentials();

			return {
				content: [
					{
						type: "text",
						text: `Logged out. Credentials removed from ${getCredentialsPath()}.`,
					},
				],
			};
		},
	);

	server.registerTool(
		"basecamp_whoami",
		{
			title: "Who Am I (Basecamp)",
			description:
				"Show the currently authenticated Basecamp user, or indicate if not logged in.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			const creds = await readCredentials();

			if (!creds) {
				return {
					content: [
						{
							type: "text",
							text: "Not logged in. Use basecamp_login to authenticate.",
						},
					],
				};
			}

			try {
				const client = await initializeBasecampClient();
				const response = await client.people.me({});

				if (response.status !== 200 || !response.body) {
					throw new Error("Failed to get profile");
				}

				const me = response.body;

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									name: me.name,
									email: me.email_address,
									title: me.title,
									account_id: creds.accountId,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{ type: "text", text: handleBasecampError(error) },
					],
				};
			}
		},
	);
}

function formatAccountList(
	accounts: { id: number; name: string }[],
): string {
	return accounts.map((a) => `- ${a.name} (id: ${a.id})`).join("\n");
}
