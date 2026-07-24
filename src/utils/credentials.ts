import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Credentials = {
  refreshToken: string;
  accountId: string;
};

const CREDENTIALS_PATH = join(
  homedir(),
  ".config",
  "basecamp-mcp",
  "credentials.json",
);

export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}

export async function readCredentials(): Promise<Credentials | null> {
  try {
    const content = await readFile(CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(content);

    if (!data.refreshToken || !data.accountId) {
      return null;
    }

    return { refreshToken: data.refreshToken, accountId: data.accountId };
  } catch {
    return null;
  }
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  const dir = dirname(CREDENTIALS_PATH);
  await mkdir(dir, { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), "utf-8");
  await chmod(CREDENTIALS_PATH, 0o600);
}

export async function deleteCredentials(): Promise<void> {
  try {
    await unlink(CREDENTIALS_PATH);
  } catch {
    // File doesn't exist, nothing to do
  }
}
