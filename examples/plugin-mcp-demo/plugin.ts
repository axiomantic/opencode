import { type Plugin, mcpTool, mcpServer } from "@opencode-ai/plugin"
import { z } from "zod"

/**
 * Example plugin demonstrating the tools and mcp bridges.
 *
 * This plugin shows how to:
 * 1. Call built-in tools from a plugin
 * 2. Add and use MCP servers
 * 3. Create wrapped MCP tools
 */
export const DemoPlugin: Plugin = async (ctx) => {
  // Example: Add a local MCP server (uncomment when you have one to test)
  // await ctx.mcp.addServer("my-tools", mcpServer.local({
  //   command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
  // }))

  return {
    tool: {
      // Example: Tool that uses built-in tools
      countFiles: {
        description: "Count files matching a pattern",
        args: {
          pattern: z.string().default("**/*.ts"),
        },
        async execute(args) {
          const result = await ctx.tools.call("glob", { pattern: args.pattern })
          const files = result.output as string[]
          return `Found ${files.length} files matching ${args.pattern}`
        },
      },

      // Example: Tool that reads a file using built-in tool
      peekFile: {
        description: "Read first 10 lines of a file",
        args: {
          filePath: z.string(),
        },
        async execute(args) {
          const result = await ctx.tools.call("read", {
            filePath: args.filePath,
            limit: 10,
          })
          return result.output as string
        },
      },

      // Example: List all available tools
      listTools: {
        description: "List all available tools",
        args: {},
        async execute() {
          const tools = await ctx.tools.list()
          const lines = tools.map((t) => `- ${t.id} (${t.source}): ${t.description.slice(0, 50)}...`)
          return `Available tools:\n${lines.join("\n")}`
        },
      },

      // Example: Check MCP server status
      mcpStatus: {
        description: "Show MCP server connection status",
        args: {},
        async execute() {
          const status = await ctx.mcp.status()
          const entries = Object.entries(status)
          if (entries.length === 0) {
            return "No MCP servers configured"
          }
          const lines = entries.map(([name, s]) => `- ${name}: ${s.status}`)
          return `MCP Servers:\n${lines.join("\n")}`
        },
      },

      // Example: Wrapped MCP tool (uncomment when server is added)
      // everything: mcpTool(ctx, {
      //   server: "my-tools",
      //   tool: "echo",
      //   description: "Echo via MCP",
      // }),
    },

    // Example: Using tools from event hook
    event: async ({ event }) => {
      if (event.type === "session.created") {
        console.log("[demo-plugin] Session created, checking tools...")
        const hasRead = await ctx.tools.has("read")
        console.log(`[demo-plugin] Read tool available: ${hasRead}`)
      }
    },
  }
}

export default DemoPlugin
