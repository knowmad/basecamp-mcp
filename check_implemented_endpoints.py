#!/usr/bin/env python3
"""
Script to identify which Basecamp API endpoints have MCP tools implemented,
and check them off in BASECAMP_ENDPOINTS.md
"""

import re
from pathlib import Path

# Map of client method calls to their corresponding API endpoints
# Based on Basecamp API conventions and the basecamp-client library
ENDPOINT_MAPPINGS = {
    # Projects
    "client.projects.list": ("GET", "/projects.json"),
    "client.projects.get": ("GET", "/projects/:id.json"),

    # Todo Sets
    "client.todoSets.get": ("GET", "/buckets/:id/todosets/:id.json"),

    # Todo Lists
    "client.todoLists.list": ("GET", "/buckets/:id/todosets/:id/todolists.json"),

    # Todos
    "client.todos.list": ("GET", "/buckets/:id/todolists/:id/todos.json"),
    "client.todos.create": ("POST", "/buckets/:id/todolists/:id/todos.json"),
    "client.todos.complete": ("POST", "/buckets/:id/todos/:id/completion.json"),
    "client.todos.uncomplete": ("DELETE", "/buckets/:id/todos/:id/completion.json"),
    "client.todos.get": ("GET", "/buckets/:id/todos/:id.json"),
    "client.todos.update": ("PUT", "/buckets/:id/todos/:id.json"),

    # Messages
    "client.messages.get": ("GET", "/buckets/:id/messages/:id.json"),
    "client.messages.list": ("GET", "/buckets/:id/message_boards/:id/messages.json"),
    "client.messages.create": ("POST", "/buckets/:id/message_boards/:id/messages.json"),
    "client.messages.update": ("PUT", "/buckets/:id/messages/:id.json"),

    # Message Types/Categories
    "client.messageTypes.list": ("GET", "/buckets/:id/categories.json"),

    # Card Tables (Kanban)
    "client.cardTables.get": ("GET", "/buckets/:id/card_tables/:id.json"),

    # Card Table Cards
    "client.cardTableCards.list": ("GET", "/buckets/:id/card_tables/lists/:id/cards.json"),
    "client.cardTableCards.get": ("GET", "/buckets/:id/card_tables/cards/:id.json"),
    "client.cardTableCards.create": ("POST", "/buckets/:id/card_tables/lists/:id/cards.json"),
    "client.cardTableCards.update": ("PUT", "/buckets/:id/card_tables/cards/:id.json"),
    "client.cardTableCards.move": ("POST", "/buckets/:id/card_tables/cards/:id/moves.json"),

    # Card Table Steps
    "client.cardTableSteps.create": ("POST", "/buckets/:id/card_tables/cards/:id/steps.json"),

    # Comments
    "client.comments.list": ("GET", "/buckets/:id/recordings/:id/comments.json"),
    "client.comments.create": ("POST", "/buckets/:id/recordings/:id/comments.json"),
    "client.comments.get": ("GET", "/buckets/:id/comments/:id.json"),
    "client.comments.update": ("PUT", "/buckets/:id/comments/:id.json"),

    # People
    "client.people.me": ("GET", "/my/profile.json"),
    "client.people.list": ("GET", "/people.json"),
    "client.people.get": ("GET", "/people/:id.json"),
}

def extract_client_calls(tools_dir: Path) -> set:
    """Extract all client method calls from tool files"""
    client_calls = set()

    # Pattern to match client method calls like: client.projects.list, client.todos.create, etc.
    pattern = re.compile(r'client\.(\w+)\.(\w+)')

    for ts_file in tools_dir.glob("*.ts"):
        content = ts_file.read_text()
        matches = pattern.findall(content)
        for match in matches:
            # Reconstruct the full method call
            call = f"client.{match[0]}.{match[1]}"
            client_calls.add(call)

    return client_calls

def get_implemented_endpoints(client_calls: set) -> set:
    """Convert client calls to API endpoints using the mapping"""
    endpoints = set()

    for call in client_calls:
        if call in ENDPOINT_MAPPINGS:
            method, path = ENDPOINT_MAPPINGS[call]
            endpoints.add((method, path))
        else:
            print(f"Warning: Unknown client call '{call}' - not in mapping")

    return endpoints

def update_endpoints_file(endpoints_file: Path, implemented: set):
    """Update BASECAMP_ENDPOINTS.md to check off implemented endpoints"""

    # Read current file
    lines = endpoints_file.read_text().splitlines()

    # Track what we found
    checked_count = 0
    total_count = 0

    # Process each line
    updated_lines = []
    for line in lines:
        # Check if this is an endpoint line
        match = re.match(r'\[ \] (.+): (GET|POST|PUT|PATCH|DELETE) (.+)', line)
        if match:
            total_count += 1
            name = match.group(1)
            method = match.group(2)
            path = match.group(3)

            # Check if this endpoint is implemented
            if (method, path) in implemented:
                # Check it off
                line = f"[x] {name}: {method} {path}"
                checked_count += 1

        updated_lines.append(line)

    # Write updated content
    endpoints_file.write_text('\n'.join(updated_lines) + '\n')

    print(f"\n✓ Updated BASECAMP_ENDPOINTS.md")
    print(f"  - Checked off: {checked_count} endpoints")
    print(f"  - Total endpoints: {total_count}")
    print(f"  - Coverage: {checked_count}/{total_count} ({100*checked_count//total_count}%)")

def main():
    # Paths
    repo_root = Path("/home/user/basecamp-mcp")
    tools_dir = repo_root / "src" / "tools"
    endpoints_file = repo_root / "BASECAMP_ENDPOINTS.md"

    # Extract client calls from tool files
    print("Extracting client method calls from tools...")
    client_calls = extract_client_calls(tools_dir)
    print(f"Found {len(client_calls)} unique client calls:")
    for call in sorted(client_calls):
        print(f"  - {call}")

    # Map to endpoints
    print("\nMapping to API endpoints...")
    implemented = get_implemented_endpoints(client_calls)
    print(f"Mapped to {len(implemented)} API endpoints:")
    for method, path in sorted(implemented):
        print(f"  - {method} {path}")

    # Update the endpoints file
    print("\nUpdating BASECAMP_ENDPOINTS.md...")
    update_endpoints_file(endpoints_file, implemented)

if __name__ == "__main__":
    main()
