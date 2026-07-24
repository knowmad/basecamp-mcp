import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeBasecampClient } from "../src/utils/auth.js";
import {
  createTestClient,
  extractId,
  type McpTestClient,
  requireEnv,
  resolveDockId,
  trashRecordings,
} from "./utils";

type Vault = {
  id: number;
  title: string;
  documents_count?: number;
  uploads_count?: number;
  vaults_count?: number;
};

type Document = {
  id: number;
  title: string;
  content: string;
};

type Upload = {
  id: number;
  filename?: string | null;
  content_type?: string | null;
};

let mcp: McpTestClient;
let projectId: number;
let rootVaultId: number;
const toTrash: number[] = [];

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));

  const resolved = await resolveDockId(mcp, projectId, "vault");
  if (resolved == null) {
    throw new Error(
      `Sandbox project ${projectId} has no Docs & Files vault enabled; cannot run docs/files tests.`,
    );
  }
  rootVaultId = resolved;
});

afterAll(async () => {
  await trashRecordings(toTrash);
  await mcp?.close();
});

describe("Basecamp Docs & Files via MCP tools (live)", () => {
  it("lists child vaults (folders) under the root vault", async () => {
    const vaults = await mcp.json<Vault[]>("basecamp_list_vaults", {
      parent_vault_id: rootVaultId,
    });
    expect(Array.isArray(vaults)).toBe(true);
    // Shape check (may be empty): if any, entries are id+title objects.
    if (vaults.length > 0) {
      expect(typeof vaults[0].id).toBe("number");
      expect(typeof vaults[0].title).toBe("string");
    }
  });

  it("creates, reads, updates a vault (folder)", async () => {
    const title = `MCP docs vault ${Date.now()}`;

    // CREATE
    const createText = await mcp.text("basecamp_create_vault", {
      parent_vault_id: rootVaultId,
      title,
    });
    expect(createText).toContain("Vault created successfully!");
    const vaultId = extractId(createText);
    toTrash.push(vaultId);

    // READ
    const vault = await mcp.json<Vault>("basecamp_get_vault", {
      vault_id: vaultId,
    });
    expect(vault.id).toBe(vaultId);
    expect(vault.title).toBe(title);

    // UPDATE
    const newTitle = `${title} (updated)`;
    const updateText = await mcp.text("basecamp_update_vault", {
      vault_id: vaultId,
      title: newTitle,
    });
    expect(updateText.toLowerCase()).toContain("updated");

    const afterUpdate = await mcp.json<Vault>("basecamp_get_vault", {
      vault_id: vaultId,
    });
    expect(afterUpdate.title).toBe(newTitle);
  });

  it("creates, reads, lists, and updates a document (full + partial)", async () => {
    // Create a dedicated vault to hold the document so list_documents is clean.
    const vaultTitle = `MCP docvault ${Date.now()}`;
    const vaultText = await mcp.text("basecamp_create_vault", {
      parent_vault_id: rootVaultId,
      title: vaultTitle,
    });
    const vaultId = extractId(vaultText);
    toTrash.push(vaultId);

    const docTitle = `MCP document ${Date.now()}`;
    const initialContent = "<p>Initial document body.</p>";

    // CREATE
    const createText = await mcp.text("basecamp_create_document", {
      vault_id: vaultId,
      title: docTitle,
      content: initialContent,
    });
    expect(createText).toContain("Document created successfully!");
    const docId = extractId(createText);
    toTrash.push(docId);

    // READ — content matches what we created
    const doc = await mcp.json<Document>("basecamp_get_document", {
      document_id: docId,
    });
    expect(doc.id).toBe(docId);
    expect(doc.title).toBe(docTitle);
    expect(doc.content).toContain("Initial document body.");

    // LIST — our document is present in the vault
    const docs = await mcp.json<Array<{ id: number }>>(
      "basecamp_list_documents",
      { vault_id: vaultId },
    );
    expect(docs.some((d) => d.id === docId)).toBe(true);

    // UPDATE (full replace)
    const replaced = "<p>Fully replaced body.</p>";
    const fullUpdate = await mcp.text("basecamp_update_document", {
      document_id: docId,
      content: replaced,
    });
    expect(fullUpdate.toLowerCase()).toContain("updated");

    const afterFull = await mcp.json<Document>("basecamp_get_document", {
      document_id: docId,
    });
    expect(afterFull.content).toContain("Fully replaced body.");
    expect(afterFull.content).not.toContain("Initial document body.");

    // UPDATE (partial content op: append)
    const partialUpdate = await mcp.text("basecamp_update_document", {
      document_id: docId,
      content_append: "<p>Appended paragraph.</p>",
    });
    expect(partialUpdate.toLowerCase()).toContain("updated");

    const afterPartial = await mcp.json<Document>("basecamp_get_document", {
      document_id: docId,
    });
    expect(afterPartial.content).toContain("Fully replaced body.");
    expect(afterPartial.content).toContain("Appended paragraph.");
  });

  it("lists uploads and gets one (seeding the download path)", async () => {
    // list_uploads always returns an array (possibly empty).
    const uploads = await mcp.json<Upload[]>("basecamp_list_uploads", {
      vault_id: rootVaultId,
    });
    expect(Array.isArray(uploads)).toBe(true);

    // Seed a text upload directly via the SDK so the rewritten download path
    // (downloadURL + streamToBytes) is exercised even on an empty account.
    let seededUploadId: number | undefined;
    try {
      const client = await initializeBasecampClient();
      const fileBody = `seeded upload ${Date.now()}\n`;
      const attachment = await client.attachments.create(
        new TextEncoder().encode(fileBody),
        "text/plain",
        `seed-${Date.now()}.txt`,
      );
      const sgid = (attachment as { attachable_sgid?: string }).attachable_sgid;
      if (sgid) {
        const upload = await client.uploads.create(rootVaultId, {
          attachableSgid: sgid,
        });
        seededUploadId = upload.id;
        toTrash.push(upload.id);
      }
    } catch {
      // Seeding is best-effort; fall back to any pre-existing upload below.
      seededUploadId = undefined;
    }

    const targetUploadId =
      seededUploadId ?? (uploads.length > 0 ? uploads[0].id : undefined);

    if (targetUploadId == null) {
      // No upload available to download; the array assertion above still
      // covers list_uploads. Nothing more to exercise here.
      return;
    }

    // get_upload exercises downloadURL + streamToBytes. For a text/plain file
    // it returns a metadata block plus a "--- File content of ... ---" block.
    const result = await mcp.call("basecamp_get_upload", {
      upload_id: targetUploadId,
    });
    expect(result.isError).not.toBe(true);
    const hasImage = result.content.some((c) => c.type === "image");
    const combinedText = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    // Either an image block, file-content text, or a saved_to path for binary —
    // any of these means the download path ran without error.
    const downloaded =
      hasImage ||
      combinedText.includes("--- File content of") ||
      combinedText.includes("saved_to");
    expect(downloaded).toBe(true);
  });

  it("download_blob with a bogus blob id returns an error", async () => {
    // Exercises URL reconstruction + downloadURL error handling. Uses mcp.call
    // since the tool reports errors as plain text rather than isError.
    const result = await mcp.call("basecamp_download_blob", {
      blob_id: "00000000-0000-0000-0000-000000000000",
      filename: "nope.txt",
    });
    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    const isError =
      result.isError === true ||
      /^(Error|Basecamp API error|Not logged in|Failed)\b/i.test(text.trim());
    expect(isError).toBe(true);
  });
});
