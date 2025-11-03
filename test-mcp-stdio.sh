#!/bin/bash
# Test MCP stdio transport
# This script demonstrates the stdio transport by sending JSON-RPC requests

echo "Starting MCP stdio server..."
echo ""

# Start the MCP server and send test requests
{
    echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
    sleep 0.5
    echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
    sleep 0.5
    echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"health","arguments":{}}}'
    sleep 0.5
    echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"format_number","arguments":{"number":123456,"locale":"en-US"}}}'
    sleep 0.5
} | bun run src/cli/mcp.ts
