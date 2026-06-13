import { exec } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { platform } from "node:os";
import { URL } from "node:url";

const REDIRECT_PORT = 7652;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const AUTHORIZE_BASE = "https://launchpad.37signals.com/authorization/new";
const TOKEN_URL = "https://launchpad.37signals.com/authorization/token";
const AUTH_INFO_URL = "https://launchpad.37signals.com/authorization.json";

export function getClientCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.BASECAMP_CLIENT_ID;
  const clientSecret = process.env.BASECAMP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing BASECAMP_CLIENT_ID and BASECAMP_CLIENT_SECRET environment variables.",
    );
  }

  return { clientId, clientSecret };
}

function buildAuthorizeUrl(clientId: string): string {
  const params = new URLSearchParams({
    type: "web_server",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
  });
  return `${AUTHORIZE_BASE}?${params.toString()}`;
}

function openBrowser(url: string): void {
  const os = platform();
  const cmd = os === "darwin" ? "open" : os === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`);
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "web_server",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "refresh",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Basecamp MCP</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h1>Login successful!</h1>
    <p>You can close this tab and return to your MCP client.</p>
  </div>
</body>
</html>`;

type ServerHandle = {
  waitForTokens: () => Promise<{
    accessToken: string;
    refreshToken: string;
  } | null>;
};

function startCallbackServer(
  clientId: string,
  clientSecret: string,
): Promise<ServerHandle | null> {
  return new Promise((resolveStart) => {
    let resolveTokens: (
      tokens: { accessToken: string; refreshToken: string } | null,
    ) => void;

    const tokensPromise = new Promise<{
      accessToken: string;
      refreshToken: string;
    } | null>((resolve) => {
      resolveTokens = resolve;
    });

    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(
          req.url || "/",
          `http://localhost:${REDIRECT_PORT}`,
        );

        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");

        if (!code) {
          const error =
            url.searchParams.get("error_description") ||
            "No authorization code received";
          res.writeHead(400);
          res.end(error);
          server.close();
          resolveTokens!(null);
          return;
        }

        try {
          const tokens = await exchangeCodeForTokens(
            code,
            clientId,
            clientSecret,
          );
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(SUCCESS_HTML);
          server.close();
          resolveTokens!(tokens);
        } catch (err) {
          res.writeHead(500);
          res.end(
            `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          server.close();
          resolveTokens!(null);
        }
      },
    );

    server.once("error", () => {
      resolveStart(null);
    });

    server.once("listening", () => {
      resolveStart({ waitForTokens: () => tokensPromise });
    });

    server.listen(REDIRECT_PORT, "127.0.0.1");
  });
}

export async function performBasecampOAuthLogin(): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const { clientId, clientSecret } = getClientCredentials();

  const serverHandle = await startCallbackServer(clientId, clientSecret);

  if (!serverHandle) {
    throw new Error(
      `Could not start local server on port ${REDIRECT_PORT}. Is another process using it?`,
    );
  }

  const authorizeUrl = buildAuthorizeUrl(clientId);
  openBrowser(authorizeUrl);

  const tokens = await serverHandle.waitForTokens();

  if (!tokens) {
    throw new Error("Authentication failed — no tokens received");
  }

  return tokens;
}

export type BasecampAccount = {
  id: number;
  name: string;
  href: string;
  product: string;
};

export async function fetchBasecampAccounts(
  accessToken: string,
): Promise<BasecampAccount[]> {
  const response = await fetch(AUTH_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch accounts (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    accounts: BasecampAccount[];
  };

  return data.accounts.filter((a) => a.product === "bc3");
}
