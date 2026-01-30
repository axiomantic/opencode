# @opencode-ai/plugin

TypeScript SDK for building OpenCode plugins with full access to tools and MCP servers.

## Installation

```bash
bun add @opencode-ai/plugin
```

## Quick Start

```typescript
import { type Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      myTool: {
        description: "A custom tool",
        args: {},
        async execute() {
          // Call built-in tools
          const result = await ctx.tools.call("read", { filePath: "/etc/hosts" })
          return result.output as string
        },
      },
    },
  }
}

export default MyPlugin
```

## Plugin Context

Every plugin receives a context object with these properties:

| Property    | Type             | Description                   |
| ----------- | ---------------- | ----------------------------- |
| `client`    | `OpencodeClient` | SDK client for API calls      |
| `project`   | `Project`        | Current project info          |
| `directory` | `string`         | Project root directory        |
| `worktree`  | `string`         | Git worktree path             |
| `serverUrl` | `URL`            | OpenCode server URL           |
| `$`         | `BunShell`       | Shell for running commands    |
| `tools`     | `ToolsBridge`    | Call any registered tool      |
| `mcp`       | `McpBridge`      | Manage MCP server connections |

## Tools Bridge

The `tools` bridge lets plugins call any tool: built-in, MCP, or from other plugins.

### Calling Tools

```typescript
// Call a built-in tool
const files = await ctx.tools.call("glob", { pattern: "**/*.ts" })

// Call with options
const result = await ctx.tools.call("bash", { command: "ls -la" }, { timeout: 5000, skipPermissions: true })

// Access result
console.log(result.output)
console.log(result.title)
console.log(result.metadata)
```

### Listing Tools

```typescript
// Get all available tools
const tools = await ctx.tools.list()

for (const tool of tools) {
  console.log(`${tool.id} (${tool.source}): ${tool.description}`)
}

// Check if a tool exists
if (await ctx.tools.has("my-mcp-server_some-tool")) {
  // Tool is available
}
```

### Tool Sources

Tools come from three sources:

- `builtin` - Core OpenCode tools (read, write, bash, glob, etc.)
- `mcp` - Tools from connected MCP servers
- `plugin` - Tools defined by plugins

## MCP Bridge

The `mcp` bridge provides full control over MCP server connections.

### Adding Servers

```typescript
import { mcpServer } from "@opencode-ai/plugin"

// Local server (stdio)
await ctx.mcp.addServer(
  "my-tools",
  mcpServer.local({
    command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
    environment: { DEBUG: "true" },
    timeout: 30000,
  }),
)

// Remote server (SSE)
await ctx.mcp.addServer(
  "remote-tools",
  mcpServer.remote({
    url: "https://mcp.example.com/sse",
    headers: { Authorization: "Bearer token" },
  }),
)
```

### Server Management

```typescript
// Check server status
const status = await ctx.mcp.status()
// { "my-tools": { status: "connected" }, ... }

// Connect/disconnect
await ctx.mcp.connect("my-tools")
await ctx.mcp.disconnect("my-tools")

// Remove server
await ctx.mcp.removeServer("my-tools")
```

### Using MCP Features

```typescript
// List tools from a specific server
const tools = await ctx.mcp.tools("my-tools")

// Read a resource
const content = await ctx.mcp.readResource("my-tools", "file:///path/to/file")

// Get a prompt
const prompt = await ctx.mcp.getPrompt("my-tools", "code-review", {
  language: "typescript",
})
```

## Helper Functions

### mcpTool

Wrap an MCP tool as a plugin tool with optional transforms:

```typescript
import { mcpTool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      // Expose MCP tool directly
      echo: mcpTool(ctx, {
        server: "my-tools",
        tool: "echo",
        description: "Echo a message",
      }),

      // Transform args and results
      search: mcpTool(ctx, {
        server: "search-server",
        tool: "search",
        description: "Search with preprocessing",
        transformArgs: (args) => ({ ...args, limit: 10 }),
        transformResult: (result) => JSON.stringify(result, null, 2),
      }),
    },
  }
}
```

### mcpServer

Factory functions for server configurations:

```typescript
import { mcpServer } from "@opencode-ai/plugin"

// Local server with command array
const local = mcpServer.local({
  command: ["python", "-m", "my_server"],
  environment: { API_KEY: "xxx" },
  timeout: 60000,
})

// Remote server with OAuth
const remote = mcpServer.remote({
  url: "https://api.example.com/mcp",
  oauth: {
    clientId: "my-client",
    scope: "read write",
  },
})
```

## Error Handling

The plugin SDK provides typed errors for common failure cases:

```typescript
import {
  ToolNotFoundError,
  ToolPermissionError,
  ToolCycleError,
  McpNotConnectedError,
  McpTimeoutError,
  McpAuthError,
} from "@opencode-ai/plugin"

try {
  await ctx.tools.call("unknown-tool", {})
} catch (e) {
  if (e instanceof ToolNotFoundError) {
    console.log(`Tool ${e.toolId} not found`)
    console.log(`Available: ${e.availableTools.join(", ")}`)
  }
}

try {
  await ctx.mcp.tools("disconnected-server")
} catch (e) {
  if (e instanceof McpNotConnectedError) {
    console.log(`Server ${e.server} is not connected`)
  }
}
```

### Error Types

| Error                  | When Thrown                          |
| ---------------------- | ------------------------------------ |
| `ToolNotFoundError`    | Tool ID doesn't exist                |
| `ToolPermissionError`  | Plugin lacks permission to call tool |
| `ToolCycleError`       | Circular tool call detected          |
| `McpNotConnectedError` | MCP server not connected             |
| `McpTimeoutError`      | MCP call exceeded timeout            |
| `McpAuthError`         | MCP server requires authentication   |

## Permissions

Plugins can be restricted to specific tools via configuration:

```json
{
  "plugins": {
    "my-plugin": {
      "permissions": {
        "tools": {
          "allow": ["read", "glob", "grep"],
          "deny": ["bash", "write"]
        }
      }
    }
  }
}
```

- `allow` acts as a whitelist (only these tools permitted)
- `deny` acts as a blacklist (these tools blocked)
- `deny` takes precedence over `allow`

## Hooks

Plugins can define hooks to respond to events:

```typescript
export const MyPlugin: Plugin = async (ctx) => {
  return {
    // Define custom tools
    tool: { ... },

    // React to events
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const hasRead = await ctx.tools.has("read")
        console.log(`Read tool available: ${hasRead}`)
      }
    },

    // Modify chat behavior
    "chat.message": async (input, output) => {
      // Transform messages before sending
    },

    // Add auth methods
    auth: { ... },
  }
}
```

See the main OpenCode documentation for the full list of available hooks.

## Examples

See `examples/plugin-mcp-demo/` for a complete working example.
