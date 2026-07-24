# Running basecamp-mcp in Claude Cowork (stdio → HTTP bridge)

This server is a **local stdio MCP server** (`StdioServerTransport`, see `src/index.ts`).
It runs directly in **Claude Code** and **Claude Desktop**, which spawn the process on
your machine. **Claude Cowork cannot** — Cowork runs your session inside a cloud sandbox
VM with no access to local processes, so it only accepts **remote HTTP connectors added
by URL**.

This runbook bridges the gap: wrap the existing stdio binary in an HTTP transport, put a
shared-secret proxy in front, and expose it through a tunnel so Cowork can reach it.
**No changes to the server code are required.**

## Architecture

```
[basecamp-mcp stdio]  →  [supergateway :8000/mcp]  →  [Caddy :8080 checks x-api-key]  →  [cloudflared HTTPS]  →  [Cowork connector + x-api-key header]
   node dist/index.js       stdio→Streamable HTTP        rejects requests w/o secret        public URL              Request headers field
```

The shared secret is what makes this safe: this server can **write** to Basecamp (create
todos, post messages, complete items). Without the proxy check, anyone who discovered the
tunnel URL would have full write access. The proxy rejects any request missing the secret,
and you paste that same secret into Cowork's connector config so only Cowork can call it.

## Prerequisites

- Node.js 18+ and a built `dist/` (`npm run build`).
- [`supergateway`](https://github.com/supercorp-ai/supergateway) — run via `npx`, no install needed.
- [`caddy`](https://caddyserver.com/docs/install) — `brew install caddy`.
- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) — `brew install cloudflared`.
- (Optional) [`pm2`](https://pm2.keymetrics.io/) to keep the processes alive — `npm i -g pm2`.

## Verify first: does your Cowork build expose "Request headers"?

Custom connectors support a **Request headers** section that accepts an allowlisted set of
header names (`authorization`, `x-api-key`, `x-auth-token`). `Authorization` is reserved by
OAuth on OAuth connections, so this runbook uses **`x-api-key`** to avoid that entirely.

The feature is **beta**, and there is a known UI gap where some builds showed only OAuth
client id/secret with no header field
([anthropics/claude-ai-mcp#112](https://github.com/anthropics/claude-ai-mcp/issues/112)).
Before doing anything else: open Cowork → add custom connector → confirm a **Request
headers** box is present. If it is not, this bridge cannot be secured with a header and you
should not expose the endpoint publicly — stop here and consider a hosted server with OAuth
instead.

## Step 1 — Pre-authenticate locally

The bridged process runs on your machine but the OAuth browser flow (localhost:7652
callback) can't happen from Cowork's sandbox. Authenticate **once** locally so tokens are
cached to disk before you bridge:

```
node dist/index.js
```

In your MCP client (Claude Code / Desktop), call the `basecamp_login` tool and complete the
browser flow. Tokens persist on disk; the bridged process reuses them. Verify with
`basecamp_whoami`.

## Step 2 — Generate the shared secret

```
openssl rand -hex 32
```

Save the output. This is the value you'll pass to both Caddy (below) and Cowork's
`x-api-key` header. Treat it like a password — anyone with it can write to your Basecamp.

## Step 3 — Expose the stdio server over HTTP (supergateway)

```
npx -y supergateway --stdio "node /Users/william/github/basecamp-mcp/dist/index.js" --outputTransport streamableHttp --port 8000
```

This serves the MCP endpoint at `http://localhost:8000/mcp`. Leave it running.

## Step 4 — Put the shared-secret proxy in front (Caddy)

supergateway's `--oauth2Bearer`/`--header` flags are **outbound only** — they do not protect
the endpoint it exposes. Caddy adds the inbound check.

Create `Caddyfile`:

```
:8080 {
	@noauth not header X-Api-Key {$BRIDGE_SECRET}
	respond @noauth "Unauthorized" 401
	reverse_proxy localhost:8000
}
```

Run it with the secret from Step 2 in the environment:

```
BRIDGE_SECRET=<paste-secret-here> caddy run --config ./Caddyfile
```

Now `http://localhost:8080/mcp` requires header `X-Api-Key: <secret>`; requests without it
get a 401.

## Step 5 — Tunnel to a public URL (cloudflared)

```
cloudflared tunnel --url http://localhost:8080
```

This prints an `https://<random>.trycloudflare.com` URL. Your Cowork connector URL is that
URL **with `/mcp` appended**.

Note: the free "quick tunnel" URL **changes on every restart** — you'll re-enter it in
Cowork each time. For a stable URL, set up a
[named Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
with your own domain (adds ~30 min, one-time).

## Step 6 — Add the connector in Cowork

1. Cowork → Settings → Connectors → **Add custom connector**.
2. **URL:** `https://<tunnel>.trycloudflare.com/mcp`
3. **Request headers:** add `x-api-key` = `<secret from Step 2>`.
4. Save and enable. The Basecamp tools should appear.

## Step 7 — Keep it alive (optional, pm2)

Quick tunnels and foreground processes die on reboot/crash. Wrap Steps 3–5 in pm2:

```
pm2 start "npx -y supergateway --stdio 'node /Users/william/github/basecamp-mcp/dist/index.js' --outputTransport streamableHttp --port 8000" --name bc-gateway
BRIDGE_SECRET=<secret> pm2 start "caddy run --config ./Caddyfile" --name bc-proxy
pm2 start "cloudflared tunnel --url http://localhost:8080" --name bc-tunnel
pm2 save
```

## Verification

- Missing/wrong key → 401:
  ```
  curl -i https://<tunnel>.trycloudflare.com/mcp
  ```
- Correct key → a valid MCP response (not 401):
  ```
  curl -i -H "X-Api-Key: <secret>" https://<tunnel>.trycloudflare.com/mcp
  ```
- In Cowork, confirm the Basecamp tools load and a read call (e.g. list projects) succeeds.

## Security notes

- **The secret is the only thing standing between the internet and write access to your
  Basecamp.** Rotate it if it leaks; never commit it.
- Prefer `x-api-key` over `authorization` to avoid the OAuth header reservation.
- This is a **personal/dev** pattern. For multi-user or durable production use, the correct
  answer is a properly hosted HTTP MCP server with real per-user OAuth, not this bridge.
- The tunnel exposes your machine's process to the public internet for as long as it runs.
  Tear it down when you're not using it.

## Teardown

```
pm2 delete bc-gateway bc-proxy bc-tunnel   # if using pm2
# otherwise Ctrl-C each foreground process
```

Stopping cloudflared immediately makes the public URL unreachable.
