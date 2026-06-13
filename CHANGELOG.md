# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — migrated to the official Basecamp SDK

Replaced the unofficial `basecamp-client` dependency with the official
[`@37signals/basecamp`](https://www.npmjs.com/package/@37signals/basecamp)
TypeScript SDK (`^0.7.3`). Every tool now talks to Basecamp through the SDK's
typed service methods.

- **Bucket-less routing.** Recording IDs are globally unique per account, so the
  SDK addresses most resources by ID alone. `bucket_id` was **dropped from every
  tool's input schema** except `basecamp_list_message_types` (see below). Tools
  that previously required a `bucket_id`/project id no longer accept one.
- **Auth.** `initializeBasecampClient()` now builds the client via
  `createBasecampClient({ accountId, accessToken })`; a new `getBearerToken()`
  helper centralizes token refresh/caching. Credentials are still read from
  `~/.config/basecamp-mcp/credentials.json` (refresh token + account id) with
  `BASECAMP_CLIENT_ID` / `BASECAMP_CLIENT_SECRET` from the environment.
- **Kanban** (`src/tools/kanban.ts`). Rewritten onto `cards`, `cardSteps`, and
  `cardTables` services. Request bodies use the SDK's camelCase fields
  (`dueOn`, `assigneeIds`, `sourceId`, `columnId`). Card assignees are set via a
  follow-up `cards.update` because the create endpoint does not accept them.
  Card moves use a 1-indexed `position`.
- **Uploads & blobs** (`src/tools/uploads.ts`). Downloads now use
  `client.downloadURL(rawURL)` (returns a `ReadableStream`) consumed by a
  `streamToBytes()` helper; there is no `uploads.download` method. Inline-
  attachment blob URLs are reconstructed as
  `https://storage.3.basecamp.com/{accountId}/blobs/{blobId}/download/{filename}`
  (the SDK rewrites the origin to the API host).
- **Activity** (`src/tools/activity.ts`). Recordings and campfire lines are
  paged with a custom lazy `paginate()` generator that follows `Link: rel=next`
  headers and supports date-based early termination. The SDK's exported
  `paginateAll`/`fetchAllPages` are **unusable** with `client.GET` responses —
  `client.GET` consumes the response body to build `data`, so `paginateAll`'s
  internal `.clone()` throws "Body has already been consumed." The generator
  also replicates the SDK's `normalizePersonIds` fix-up (string creator ids such
  as `"basecamp"` → `0` + `system_label`), which only the high-level `.list()`
  methods apply.
- **Message types** (`src/tools/messages.ts`). `basecamp_list_message_types` is
  the **sole tool that still requires `bucket_id`**: the SDK's
  `messageTypes.list()` hits an account-level `/categories.json` and 404s, so the
  tool issues a low-level `client.GET` to the project-scoped
  `/buckets/{bucketId}/categories.json`.
- Todos, comments, documents, vaults, check-ins, people, and projects were all
  moved onto their corresponding SDK service methods.

### Changed — tool module reorganization

Tool files now follow one consistent principle: one Basecamp dock per module
(matching how `kanban.ts` already owned its whole card-table hierarchy).

- **Docs & Files is one module.** `documents.ts` and `uploads.ts` were merged
  into `files.ts` (`registerFilesTools`), which owns the entire dock — the vault
  container plus both of its children (documents and uploads/blobs). Previously
  the vault container lived in `documents.ts`, orphaned from the uploads it also
  parents.
- **Campfire chat split out of the activity feed.** `list_campfire_messages`
  moved from `activity.ts` to its own `campfires.ts` (`registerCampfireTools`).
  Chat lines are not recordings; `activity.ts` is now purely the cross-project
  recordings feed.
- **Shared pagination/date utilities extracted.** The lazy `paginate()`
  generator and `normalizePersonIds()` now live in `src/utils/pagination.ts`, and
  `parseSince()` in `src/utils/parseSince.ts`, shared by the recordings feed and
  campfire browsing. A `serializeCreator()` helper was added to
  `utils/serializers.ts` so activity/campfire creator serialization is no longer
  inlined.
- **Tool routing documented.** `basecamp_list_recordings` now explains when to
  use it (cross-project / time-based / multi-type browsing) versus the
  per-project list tools, and `basecamp_list_messages` points back to it.
  `basecamp_whoami` (login state) and `basecamp_get_me` (full profile) now
  cross-reference each other.

### Fixed — kanban regressions surfaced by the new live tests

These three bugs were introduced during the migration and caught by the new
integration suite before release:

- **Card step reposition used a 0-indexed `position`.** The Basecamp reposition
  endpoint expects a 1-indexed position (1 = top); sending `0` returned
  `400 Bad Request`. `processStepOperations` now sends `position: i + 1`.
- **A steps-only card update sent an empty `cards.update` body.** When
  `basecamp_update_kanban_card` was called with only `steps` (no card-level
  field), it still issued `cards.update(id, {})`, which Basecamp rejects with
  `400 Bad Request`. The handler now skips the card update when its body is empty
  and falls back to the already-fetched card for the response.
- **Uncompleting a card step sent `completion: ""`.** The SDK's own schema
  documentation suggests an empty string to uncomplete, but the live API rejects
  it with "Completion is required". Reverted to `completion: "off"`.

### Added — live integration test suite

- Introduced [Vitest](https://vitest.dev/) (`npm test` → `vitest run`,
  `npm run test:watch`).
- New in-memory MCP test harness (`tests/utils.ts`): stands up the real
  `McpServer` with every tool registered and drives it through an in-memory MCP
  `Client`, so each test exercises the full production path (input validation →
  handler → live Basecamp API). Helpers: `createTestClient`, dock discovery
  (`resolveDockId`, `resolveCardTableId`), `extractId` for parsing confirmation
  text, and `trashRecordings` for cleanup (there is no MCP delete tool, so
  teardown uses the SDK directly).
- `buildServer()` was extracted from `src/index.ts` so the entrypoint and the
  tests register an identical tool set.
- Per-dock live suites: `kanban`, `todos`, `messages`, `files` (Docs & Files),
  `comments`, `check-ins`, `activity` (recordings), `campfires` (chat), and
  `projects`/`people`, plus a `smoke` suite. Tests assert operation invariants
  against live data and clean up everything they create. Reads that can't
  early-terminate are scoped server-side (`project_ids` for recordings, the
  sandbox's `chat` dock for campfires) plus a tight `since` window, so unbounded
  fetches can't time out and the full suite stays fast (~50s).
- A handful of internal helpers in `src/tools/files.ts` (`streamToBytes`,
  `inferContentType`, `isImageContentType`, `isTextContentType`) are exported to
  support targeted unit testing.

> **Note:** the suite is live — it requires valid Basecamp credentials and a
> sandbox project id in `BASECAMP_BUCKET_ID`, and it creates/trashes real records
> in that project.
