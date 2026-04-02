# Basecamp MCP Server

Model Context Protocol (MCP) server for Basecamp integration. Enables LLMs to interact with Basecamp projects, messages, todos, comments, people, and kanban boards.

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

1. Call `basecamp_login` — a browser window will open for Basecamp authorization
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
- `basecamp_list_messages` - List messages in a message board with optional filtering
- `basecamp_list_message_types` - List available message types/categories for a project
- `basecamp_get_message` - Get single message details
- `basecamp_create_message` - Create new message with optional category and draft status
- `basecamp_update_message` - Update message with advanced content editing (supports full replacement, append, prepend, search/replace)

### TODOs
- `basecamp_get_todoset` - Get todo set container with all todo lists
- `basecamp_list_todos` - List todos in a list with status filtering (active/archived)
- `basecamp_create_todo` - Create new todo with optional description
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

## Development

```bash
# Install dependencies
npm install

# Run type checking
npx tsc --noEmit

# Build
npm run build

# Clean build artifacts
npm run clean
```

## License

MIT
