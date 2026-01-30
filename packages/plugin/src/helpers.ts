import type { ToolDefinition, ToolContext } from "./tool"
import type { PluginInput } from "./index"
import type { McpServerConfig, McpOAuth } from "./mcp"

export function mcpTool(
  ctx: PluginInput,
  config: {
    server: string
    tool: string
    description?: string
    transformArgs?: (args: unknown) => unknown
    transformResult?: (result: unknown) => unknown
  },
): ToolDefinition {
  return {
    description: config.description ?? `Call ${config.server}/${config.tool}`,
    args: {},
    async execute(args: unknown, context: ToolContext) {
      const transformedArgs = config.transformArgs ? config.transformArgs(args) : args
      const result = await ctx.tools.call(`${config.server}_${config.tool}`, transformedArgs as Record<string, unknown>)
      return config.transformResult ? String(config.transformResult(result.output)) : String(result.output)
    },
  }
}

export const mcpServer = {
  local(config: { command: string[]; environment?: Record<string, string>; timeout?: number }): McpServerConfig {
    return {
      type: "local",
      ...config,
    }
  },

  remote(config: { url: string; headers?: Record<string, string>; oauth?: McpOAuth | false }): McpServerConfig {
    return {
      type: "remote",
      ...config,
    }
  },
}
