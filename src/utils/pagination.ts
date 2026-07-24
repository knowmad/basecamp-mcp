/**
 * Lazy pagination over Basecamp list endpoints.
 *
 * The SDK's high-level `.list()` methods eagerly fetch every page before
 * returning, and the exported `paginateAll`/`fetchAllPages` helpers are unusable
 * with `client.GET` responses (the body is already consumed to build `data`, so
 * their internal `.clone()` throws). This module provides a generator that pages
 * on demand by following `Link: rel="next"` headers, so callers can stop early
 * (e.g. once results predate a cutoff). Shared by the recordings feed
 * (`activity.ts`) and campfire lines (`campfires.ts`).
 */

import { parseNextLink } from "@37signals/basecamp";
import type { initializeBasecampClient } from "./auth.js";

/** Safety cap on pages fetched, mirroring the SDK's DEFAULT_MAX_PAGES. */
export const MAX_PAGES = 10_000;

export type BasecampClientInstance = Awaited<
  ReturnType<typeof initializeBasecampClient>
>;

export type LowLevelGet = (
  path: string,
  init: {
    params: {
      query?: Record<string, unknown>;
      path?: Record<string, unknown>;
    };
  },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

/**
 * Recursively coerce Basecamp person IDs that arrive as strings into numbers,
 * mirroring the normalization the SDK's high-level `.list()` methods apply.
 * The low-level `client.GET` path used for lazy pagination skips it, so we
 * replicate it here to keep creator IDs consistent for filtering/output.
 */
export function normalizePersonIds(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) normalizePersonIds(item);
    return;
  }

  const rec = obj as Record<string, unknown>;
  if ("personable_type" in rec && typeof rec.id === "string") {
    const idStr = rec.id;
    if (/^-?\d+$/.test(idStr) && Number.isSafeInteger(Number(idStr))) {
      rec.id = Number(idStr);
    } else {
      // Non-numeric sentinel (e.g. "basecamp") or unsafe integer — preserve
      // the original as a label and zero the numeric id.
      rec.system_label = idStr;
      rec.id = 0;
    }
  }

  for (const val of Object.values(rec)) {
    if (typeof val === "object" && val !== null) normalizePersonIds(val);
  }
}

/**
 * Lazily page through a list endpoint via the low-level client, yielding items
 * one at a time so callers can stop early.
 *
 * Reuses the SDK client so auth, User-Agent, and retry behavior are preserved.
 */
export async function* paginate<T>(
  client: BasecampClientInstance,
  path: string,
  params: {
    query?: Record<string, unknown>;
    path?: Record<string, unknown>;
  },
): AsyncGenerator<T> {
  const get = client.GET as unknown as LowLevelGet;
  const baseQuery = params.query ?? {};

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error, response } = await get(path, {
      params: { ...params, query: { ...baseQuery, page } },
    });

    if (error || !response.ok) {
      throw new Error(`Failed to fetch ${path} (page ${page})`);
    }

    const items = (data ?? []) as T[];
    normalizePersonIds(items);

    for (const item of items) {
      yield item;
    }

    if (!parseNextLink(response.headers.get("Link"))) break;
  }
}
