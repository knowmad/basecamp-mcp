# Basecamp MCP Server

Model Context Protocol (MCP) server for Basecamp integration. Enables LLMs to interact with Basecamp projects, messages, todos, comments, people, and kanban boards.

## Features

- **Projects**: List and get project details (discover bucket IDs)
- **Messages**: Create, read, update (with patch support), and list messages
- **TODOs**: Manage todo sets, lists, and individual todos
- **Comments**: Add and read comments on any resource
- **People**: List and get person details
- **Kanban**: Manage cards, columns, and steps
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
- `basecamp_update_message_patch` - Update message (partial fields)

#### TODOs
- `basecamp_get_todoset` - Get todo set container
- `basecamp_list_todos` - List todos in a list
- `basecamp_create_todo` - Create new todo
- `basecamp_complete_todo` - Mark todo as complete
- `basecamp_uncomplete_todo` - Mark todo as incomplete

#### Comments
- `basecamp_list_comments` - List comments on any resource
- `basecamp_create_comment` - Add comment to any resource

#### People
- `basecamp_list_people` - List all people
- `basecamp_get_person` - Get person details

#### Kanban
- `basecamp_list_kanban_cards` - List cards in a column
- `basecamp_create_kanban_card` - Create new card
- `basecamp_create_kanban_step` - Add step to card

## Special Features

### Message Patch Updates

The `basecamp_update_message_patch` tool allows updating messages without providing the full content:

```json
{
  "account_id": "1234567",
  "bucket_id": "7654321",
  "message_id": "9999999",
  "subject": "New Subject"
  // No need to provide content if only updating subject
}
```

### URL Parsing

The server includes URL parsing utilities that can extract IDs from Basecamp URLs:

Pattern: `https://3.basecamp.com/{accountId}/buckets/{bucketId}/{resourceType}/{resourceId}`

## Architecture

```
src/
├── index.ts              # Server initialization
├── constants.ts          # Shared constants
├── types.ts              # TypeScript types
├── utils/
│   ├── auth.ts           # Authentication & client init
│   ├── urlParser.ts      # URL parsing
│   ├── formatters.ts     # Response formatting
│   └── errorHandlers.ts  # Error handling
├── tools/                # Tool implementations
│   ├── projects.ts
│   ├── messages.ts
│   ├── todos.ts
│   ├── comments.ts
│   ├── people.ts
│   └── kanban.ts
└── schemas/              # Zod validation schemas
    └── common.ts
```

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
