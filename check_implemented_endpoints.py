#!/usr/bin/env python3
"""
Script to identify which Basecamp API endpoints have MCP tools implemented.

This script uses a CONVENTION-BASED mapping approach:
- The basecamp-client library follows REST conventions
- Method names map predictably to endpoints
- Manual ENDPOINT_MAPPINGS provides the source of truth

IMPORTANT: When you add new MCP tools, you need to:
1. Add the mapping to ENDPOINT_MAPPINGS dictionary below
2. Run this script to update BASECAMP_ENDPOINTS.md
3. This is intentional - it serves as documentation of what you've implemented

Think of ENDPOINT_MAPPINGS as a living document of your API coverage.
"""

import re
from pathlib import Path

# ============================================================================
# ENDPOINT MAPPINGS - UPDATE THIS WHEN YOU ADD NEW MCP TOOLS
# ============================================================================
# This is the single source of truth mapping client methods to API endpoints.
# Format: "client.resource.method": ("HTTP_METHOD", "/endpoint/path")
#
# Why manual?
# - Acts as explicit documentation of implemented features
# - Prevents false positives from code comments or examples
# - Makes it clear what each tool actually does
# - Forces intentional tracking of API coverage
# ============================================================================

ENDPOINT_MAPPINGS = {
    # Projects - 2 endpoints
    "client.projects.list": ("GET", "/projects.json"),
    "client.projects.get": ("GET", "/projects/:id.json"),

    # Todo Sets - 1 endpoint
    "client.todoSets.get": ("GET", "/buckets/:id/todosets/:id.json"),

    # Todo Lists - 1 endpoint
    "client.todoLists.list": ("GET", "/buckets/:id/todosets/:id/todolists.json"),

    # Todos - 4 endpoints
    "client.todos.list": ("GET", "/buckets/:id/todolists/:id/todos.json"),
    "client.todos.create": ("POST", "/buckets/:id/todolists/:id/todos.json"),
    "client.todos.complete": ("POST", "/buckets/:id/todos/:id/completion.json"),
    "client.todos.uncomplete": ("DELETE", "/buckets/:id/todos/:id/completion.json"),
    # Note: todos.get and todos.update exist in the API but aren't used yet
    # "client.todos.get": ("GET", "/buckets/:id/todos/:id.json"),
    # "client.todos.update": ("PUT", "/buckets/:id/todos/:id.json"),

    # Messages - 4 endpoints
    "client.messages.get": ("GET", "/buckets/:id/messages/:id.json"),
    "client.messages.list": ("GET", "/buckets/:id/message_boards/:id/messages.json"),
    "client.messages.create": ("POST", "/buckets/:id/message_boards/:id/messages.json"),
    "client.messages.update": ("PUT", "/buckets/:id/messages/:id.json"),

    # Message Types/Categories - 1 endpoint
    "client.messageTypes.list": ("GET", "/buckets/:id/categories.json"),

    # Card Tables (Kanban) - 1 endpoint
    "client.cardTables.get": ("GET", "/buckets/:id/card_tables/:id.json"),

    # Card Table Cards - 5 endpoints
    "client.cardTableCards.list": ("GET", "/buckets/:id/card_tables/lists/:id/cards.json"),
    "client.cardTableCards.get": ("GET", "/buckets/:id/card_tables/cards/:id.json"),
    "client.cardTableCards.create": ("POST", "/buckets/:id/card_tables/lists/:id/cards.json"),
    "client.cardTableCards.update": ("PUT", "/buckets/:id/card_tables/cards/:id.json"),
    "client.cardTableCards.move": ("POST", "/buckets/:id/card_tables/cards/:id/moves.json"),

    # Card Table Steps - 1 endpoint
    "client.cardTableSteps.create": ("POST", "/buckets/:id/card_tables/cards/:id/steps.json"),

    # Comments (work on any recording) - 4 endpoints
    "client.comments.list": ("GET", "/buckets/:id/recordings/:id/comments.json"),
    "client.comments.create": ("POST", "/buckets/:id/recordings/:id/comments.json"),
    "client.comments.get": ("GET", "/buckets/:id/comments/:id.json"),
    "client.comments.update": ("PUT", "/buckets/:id/comments/:id.json"),

    # People - 3 endpoints
    "client.people.me": ("GET", "/my/profile.json"),
    "client.people.list": ("GET", "/people.json"),
    "client.people.get": ("GET", "/people/:id.json"),
}

# ============================================================================
# SCRIPT LOGIC - You probably don't need to modify below here
# ============================================================================

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

def get_implemented_endpoints(client_calls: set) -> tuple[set, list]:
    """
    Convert client calls to API endpoints using the mapping.
    Returns (implemented_endpoints, unmapped_calls)
    """
    endpoints = set()
    unmapped = []

    for call in client_calls:
        if call in ENDPOINT_MAPPINGS:
            method, path = ENDPOINT_MAPPINGS[call]
            endpoints.add((method, path))
        else:
            unmapped.append(call)

    return endpoints, unmapped

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
        match = re.match(r'\[[x ]\] (.+): (GET|POST|PUT|PATCH|DELETE) (.+)', line)
        if match:
            total_count += 1
            name = match.group(1)
            method = match.group(2)
            path = match.group(3)

            # Check if this endpoint is implemented
            if (method, path) in implemented:
                # Check it off (replace [ ] or [x] with [x])
                line = f"[x] {name}: {method} {path}"
                checked_count += 1
            else:
                # Ensure it's unchecked
                line = f"[ ] {name}: {method} {path}"

        updated_lines.append(line)

    # Write updated content
    endpoints_file.write_text('\n'.join(updated_lines) + '\n')

    return checked_count, total_count

def main():
    # Paths
    repo_root = Path("/home/user/basecamp-mcp")
    tools_dir = repo_root / "src" / "tools"
    endpoints_file = repo_root / "BASECAMP_ENDPOINTS.md"

    print("=" * 70)
    print("Basecamp MCP Endpoint Coverage Checker")
    print("=" * 70)

    # Extract client calls from tool files
    print("\n📋 Extracting client method calls from tools...")
    client_calls = extract_client_calls(tools_dir)
    print(f"   Found {len(client_calls)} unique client calls")

    # Map to endpoints
    print("\n🔗 Mapping to API endpoints...")
    implemented, unmapped = get_implemented_endpoints(client_calls)

    if unmapped:
        print(f"\n⚠️  WARNING: {len(unmapped)} client calls not in ENDPOINT_MAPPINGS:")
        for call in sorted(unmapped):
            print(f"   - {call}")
        print("\n   Add these to ENDPOINT_MAPPINGS in this script!")
        print("   (This ensures intentional tracking of API coverage)")

    print(f"\n✓ Mapped to {len(implemented)} API endpoints")

    # Update the endpoints file
    print("\n📝 Updating BASECAMP_ENDPOINTS.md...")
    checked_count, total_count = update_endpoints_file(endpoints_file, implemented)

    print("\n" + "=" * 70)
    print("✅ COMPLETE")
    print("=" * 70)
    print(f"  Checked off: {checked_count} endpoints")
    print(f"  Total endpoints: {total_count}")
    print(f"  Coverage: {checked_count}/{total_count} ({100*checked_count//total_count}%)")
    print("=" * 70)

if __name__ == "__main__":
    main()
