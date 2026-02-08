# Basecamp MCP Server

Model Context Protocol (MCP) server for Basecamp integration. Enables LLMs to interact with Basecamp projects, messages, todos, comments, people, and kanban boards.

## Getting Started

The Basecamp MCP server requires Node.js 18+ and works with various MCP clients including Claude Code CLI, Claude Desktop, Cursor, VS Code, and others.

### Standard Configuration

The baseline setup applies across most tools:

```json
{
  "mcpServers": {
    "basecamp": {
      "command": "npx",
      "args": ["-y", "basecamp-mcp@latest"],
      "env": {
        "BASECAMP_CLIENT_ID": "your_client_id",
        "BASECAMP_CLIENT_SECRET": "your_client_secret",
        "BASECAMP_REFRESH_TOKEN": "your_refresh_token",
        "BASECAMP_USER_AGENT": "YourApp (your@email.com)",
        "BASECAMP_ACCOUNT_ID": "account_id"
      }
    }
  }
}
```

### Installation by Client

**Claude Code CLI:**
```bash
claude mcp add basecamp npx basecamp-mcp@latest \
  -e BASECAMP_CLIENT_ID=your_client_id \
  -e BASECAMP_CLIENT_SECRET=your_client_secret \
  -e BASECAMP_REFRESH_TOKEN=your_refresh_token \
  -e BASECAMP_USER_AGENT="YourApp (your@email.com)" \
  -e BASECAMP_ACCOUNT_ID=account_id
```

**Claude Desktop:** Follow the MCP install guide using the standard config above.

**Cursor:** One-click installation available, or manually add configuration through Settings → Tools & Integrations → New MCP Server.

**VS Code:** One-click installation provided, or use the CLI:
```bash
code --add-mcp '{"name":"basecamp","command":"npx","args":["-y", "basecamp-mcp@latest"]}'
```

**Gemini CLI & Windsurf:** Refer to their respective documentation; use the standard config template.

## Configuration

The server requires the following environment variables:

* **`BASECAMP_CLIENT_ID`** — Your Basecamp OAuth client ID
* **`BASECAMP_CLIENT_SECRET`** — Your Basecamp OAuth client secret
* **`BASECAMP_REFRESH_TOKEN`** — Your Basecamp refresh token for authentication
* **`BASECAMP_USER_AGENT`** — Your application identifier (format: YourApp (our@email.com))
* **`BASECAMP_ACCOUNT_ID`** — Your Basecamp account ID

### Complete Configuration Example

```json
{
  "mcpServers": {
    "basecamp": {
      "command": "npx",
      "args": ["-y", "basecamp-mcp@latest"],
      "env": {
        "BASECAMP_CLIENT_ID": "your_client_id",
        "BASECAMP_CLIENT_SECRET": "your_client_secret",
        "BASECAMP_REFRESH_TOKEN": "your_refresh_token",
        "BASECAMP_USER_AGENT": "YourApp (your@email.com)",
        "BASECAMP_ACCOUNT_ID": "account_id"
      }
    }
  }
}
```

## Usage

### Running the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### Available Tools

#### Projects
- `basecamp_list_projects` - List all accessible projects with optional filtering
- `basecamp_get_project` - Get detailed project information including dock configuration

#### Messages
- `basecamp_list_messages` - List messages in a message board with optional filtering
- `basecamp_list_message_types` - List available message types/categories for a project
- `basecamp_get_message` - Get single message details
- `basecamp_create_message` - Create new message with optional category and draft status
- `basecamp_update_message` - Update message with advanced content editing (supports full replacement, append, prepend, search/replace)

#### TODOs
- `basecamp_get_todoset` - Get todo set container with all todo lists
- `basecamp_list_todos` - List todos in a list with status filtering (active/archived)
- `basecamp_create_todo` - Create new todo with optional description
- `basecamp_complete_todo` - Mark todo as complete
- `basecamp_uncomplete_todo` - Mark todo as incomplete

#### Comments
- `basecamp_list_comments` - List comments on any resource (works universally on all recording types)
- `basecamp_create_comment` - Add comment to any resource
- `basecamp_update_comment` - Update comment with advanced content editing (supports full replacement, append, prepend, search/replace)

#### People
- `basecamp_get_me` - Get personal information for the authenticated user
- `basecamp_list_people` - List all people with optional filtering by name, email, or title
- `basecamp_get_person` - Get person details

#### Kanban
- `basecamp_list_kanban_columns` - List all columns in a kanban board
- `basecamp_list_kanban_cards` - List cards in a column with steps and assignees
- `basecamp_get_kanban_card` - Get complete details of a specific card
- `basecamp_create_kanban_card` - Create new card with title, content, and optional checklist steps
- `basecamp_update_kanban_card` - Update card with advanced content editing (supports full replacement, append, prepend, search/replace, plus title, due date, assignees, notifications, and complete step array management)
- `basecamp_move_kanban_card` - Move a card to a different column and/or position

#### Activity
- `basecamp_list_recordings` - Browse recent activity globally or across specific projects, with filtering by type, date range, person, and text search. All filters except text search support multiple values (e.g., multiple project IDs, person IDs, or types for OR-matching)

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
