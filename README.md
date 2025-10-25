# Basecamp MCP Server

Model Context Protocol (MCP) server for Basecamp integration. Enables LLMs to interact with Basecamp projects, messages, todos, comments, people, and kanban boards.

## Features

- **Projects**: List and get project details (discover bucket IDs)
- **Messages**: Create, read, update, and list messages with advanced content editing
- **TODOs**: Manage todo sets, lists, and individual todos
- **Comments**: Create, read, and update comments with advanced content editing
- **People**: List and get person details
- **Kanban**: Create, read, and update cards with advanced content editing; manage columns and steps
- **Advanced Content Editing**: Partial updates with append, prepend, and search/replace operations
- **URL Support**: Parse Basecamp URLs to extract IDs
- **Flexible Output**: Both Markdown and JSON response formats
- **Pagination**: Proper pagination support for large datasets
- **Character Limits**: Automatic truncation with clear messaging

## Installation

```bash
cd basecamp-mcp-server
npm install
npm run build
```

## Configuration

Required environment variables:

```bash
BASECAMP_CLIENT_ID=your_client_id
BASECAMP_CLIENT_SECRET=your_client_secret
BASECAMP_REFRESH_TOKEN=your_refresh_token
BASECAMP_USER_AGENT=YourApp (your@email.com)
BASECAMP_ACCOUNT_ID=account_id
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
- `basecamp_list_projects` - List all accessible projects
- `basecamp_get_project` - Get project details

#### Messages
- `basecamp_list_messages` - List messages in a message board
- `basecamp_get_message` - Get single message
- `basecamp_create_message` - Create new message
- `basecamp_update_message` - Update message with advanced content editing (supports full replacement, append, prepend, search/replace)

#### TODOs
- `basecamp_get_todoset` - Get todo set container
- `basecamp_list_todos` - List todos in a list
- `basecamp_create_todo` - Create new todo
- `basecamp_complete_todo` - Mark todo as complete
- `basecamp_uncomplete_todo` - Mark todo as incomplete

#### Comments
- `basecamp_list_comments` - List comments on any resource
- `basecamp_create_comment` - Add comment to any resource
- `basecamp_update_comment` - Update comment with advanced content editing (supports full replacement, append, prepend, search/replace)

#### People
- `basecamp_list_people` - List all people
- `basecamp_get_person` - Get person details

#### Kanban
- `basecamp_list_kanban_columns` - List all columns in a kanban board
- `basecamp_list_kanban_cards` - List cards in a column
- `basecamp_create_kanban_card` - Create new card
- `basecamp_update_kanban_card` - Update card with advanced content editing (supports full replacement, append, prepend, search/replace, plus title, due date, assignees)
- `basecamp_move_kanban_card` - Move a card to a different column and/or position
- `basecamp_create_kanban_step` - Add step to card

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
