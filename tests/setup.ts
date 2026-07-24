import { config as loadEnv } from "dotenv";

// Load BASECAMP_CLIENT_ID / BASECAMP_CLIENT_SECRET (and friends) from .env.
// Refresh token + account id come from ~/.config/basecamp-mcp/credentials.json,
// exactly as the production server reads them.
loadEnv({ quiet: true });
