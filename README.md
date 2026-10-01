# Basecamp MCP Server

[![npm version](https://img.shields.io/npm/v/basecamp-mcp.svg)](https://www.npmjs.com/package/basecamp-mcp)
[![npm downloads](https://img.shields.io/npm/dm/basecamp-mcp.svg)](https://www.npmjs.com/package/basecamp-mcp)
[![license](https://img.shields.io/npm/l/basecamp-mcp.svg)](LICENSE)

Model Context Protocol (MCP) server for Basecamp. Gives LLMs tools for projects, messages, todos, comments, people, kanban boards, docs & files, check-ins, and campfire chat.

48 tools, published on npm and installable with one `npx` command: no cloning, no virtualenv, no manual OAuth script to run.

## Why this server

- **Zero-install setup:** `npx basecamp-mcp@latest` runs the server directly from npm. Authentication is one MCP tool call (`basecamp_login`) that opens a browser; there's no separate script to clone and run by hand.
- **Full Docs & Files support:** read and write vaults (folders), documents, and uploads, and download inline `<bc-attachment>` blobs embedded in rich text. Images come back inline, text files as text, everything else saved to disk. Upload a local file or a remote URL to get the `sgid` that embeds it in rich text.
- **Check-ins (Q&A) support:** list automatic check-in questions and their answers, or post new answers programmatically.
- **Granular content editing:** messages, comments, documents, and kanban cards all support append, prepend, and search-replace operations, not just full-text replacement, so an LLM can make a small edit without resending the whole document.
- **Cross-project activity feed:** `basecamp_list_recordings` searches across every project by type, person, date range, and free text in one call, with automatic response-size management and pagination.
- **Type-safe end to end:** written in TypeScript with Zod schemas validating every tool input.
- **Tested against the real API:** the test suite exercises every tool category (messages, todos, kanban, comments, docs/files, check-ins, campfires, activity) against a live Basecamp account, not mocks.

## Getting Started

The Basecamp MCP server requires Node.js 18+ and works with various MCP clients including Claude Code CLI, Claude Desktop, Cursor, VS Code, and others.

### Prerequisites

You need a Basecamp OAuth app. Register one at [37signals Launchpad](https://launchpad.37signals.com/integrations) with the redirect URI set to `http://localhost:7652/callback`.

### Installation

Add the MCP server to your client with your OAuth credentials:

```json
{
  "mcpServers": {
    "basecamp": {
      "command": "npx",
      "args": ["-y", "basecamp-mcp@latest"],
      "env": {
        "BASECAMP_CLIENT_ID": "your_client_id",
        "BASECAMP_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

**Claude Code CLI:**
```bash
claude mcp add basecamp npx basecamp-mcp@latest \
  -e BASECAMP_CLIENT_ID=your_client_id \
  -e BASECAMP_CLIENT_SECRET=your_client_secret
```

**Claude Desktop:** Follow the MCP install guide using the JSON config above.

**Cursor:** Add configuration through Settings → Tools & Integrations → New MCP Server.

**VS Code:**
```bash
code --add-mcp '{"name":"basecamp","command":"npx","args":["-y", "basecamp-mcp@latest"]}'
```

### Authentication

Once the MCP server is running, authenticate using the built-in login tool:

1. Call `basecamp_login` to open a browser window for Basecamp authorization
2. Authorize the app in your browser
3. If you have multiple Basecamp accounts, call `basecamp_login` again with the desired `account_id`
4. Done! Credentials are saved to `~/.config/basecamp-mcp/credentials.json`

Use `basecamp_whoami` to check who you're logged in as, and `basecamp_logout` to remove stored credentials.

## Configuration

The server requires these environment variables:

* **`BASECAMP_CLIENT_ID`** — Your Basecamp OAuth client ID
* **`BASECAMP_CLIENT_SECRET`** — Your Basecamp OAuth client secret

## Available Tools

### Authentication
- `basecamp_login` - Authenticate with Basecamp via OAuth browser flow
- `basecamp_logout` - Remove stored credentials
- `basecamp_whoami` - Show the currently authenticated user

### Projects
- `basecamp_list_projects` - List all accessible projects with optional filtering
- `basecamp_get_project` - Get detailed project information including dock configuration

### Messages
- `basecamp_list_messages` - List messages in a message board with optional filtering (includes draft/published status)
- `basecamp_list_message_types` - List available message types/categories for a project
- `basecamp_get_message` - Get single message details, including whether it is a draft
- `basecamp_create_message` - Create new message with optional category and draft status
- `basecamp_update_message` - Update message with advanced content editing (supports full replacement, append, prepend, search/replace)

### TODOs
- `basecamp_get_todoset` - Get todo set container with all todo lists
- `basecamp_list_todos` - List todos in a list with status filtering (active/archived)
- `basecamp_create_todo` - Create new todo with optional description
- `basecamp_update_todo` - Update a todo's title, description, due date, or assignees
- `basecamp_complete_todo` - Mark todo as complete
- `basecamp_uncomplete_todo` - Mark todo as incomplete

### Comments
- `basecamp_list_comments` - List comments on any resource (works universally on all recording types)
- `basecamp_create_comment` - Add comment to any resource
- `basecamp_update_comment` - Update comment with advanced content editing (supports full replacement, append, prepend, search/replace)

### People
- `basecamp_get_me` - Get personal information for the authenticated user
- `basecamp_list_people` - List all people with optional filtering by name, email, or title
- `basecamp_get_person` - Get person details

### Kanban
- `basecamp_list_kanban_columns` - List all columns in a kanban board
- `basecamp_list_kanban_cards` - List cards in a column with steps and assignees
- `basecamp_get_kanban_card` - Get complete details of a specific card
- `basecamp_create_kanban_card` - Create new card with title, content, and optional checklist steps
- `basecamp_update_kanban_card` - Update card with advanced content editing (supports full replacement, append, prepend, search/replace, plus title, due date, assignees, notifications, and complete step array management)
- `basecamp_move_kanban_card` - Move a card to a different column and/or position

### Activity
- `basecamp_list_recordings` - Browse recent activity globally or across specific projects, with filtering by type, date range, person, and text search. All filters support multiple values for OR-matching (e.g., multiple project IDs, person IDs, types, or search terms)
- `basecamp_list_campfire_messages` - Browse chat messages from Campfires with filtering by campfire, person, text content, and date range. All filters support multiple values for OR-matching

### Docs & Files
- `basecamp_list_vaults` - List sub-vaults (folders) under a parent vault
- `basecamp_get_vault` - Get a vault's details, including document/upload/sub-vault counts
- `basecamp_create_vault` - Create a new vault (folder)
- `basecamp_update_vault` - Rename a vault
- `basecamp_list_documents` - List documents in a vault, with optional title/content filtering
- `basecamp_get_document` - Get a document's full HTML content and draft/published status
- `basecamp_create_document` - Create a new document (active or draft)
- `basecamp_update_document` - Update a document with advanced content editing (supports full replacement, append, prepend, search/replace)
- `basecamp_list_uploads` - List files uploaded to a vault
- `basecamp_get_upload` - Retrieve an uploaded file: images are returned inline, text files as text, other binary formats saved to disk
- `basecamp_download_blob` - Download an inline `<bc-attachment>` attachment referenced in document/message/comment HTML content
- `basecamp_create_attachment` - Upload a local file or a remote URL and get the `attachable_sgid` to embed it with `<bc-attachment>`

### Check-ins (Q&A)
- `basecamp_get_questionnaire` - Get a project's check-ins container
- `basecamp_list_questions` - List automatic check-in questions with schedule and answer counts
- `basecamp_get_question` - Get a single check-in question
- `basecamp_list_answers` - List answers to a check-in question
- `basecamp_get_answer` - Get a single check-in answer
- `basecamp_create_answer` - Post a new answer to a check-in question

## Development

```bash
# Install dependencies
npm install

# Run type checking
npx tsc --noEmit

# Build
npm run build

# Run the live test suite (requires a real, authenticated Basecamp account)
npm test

# Clean build artifacts
npm run clean
```

## License

MIT
