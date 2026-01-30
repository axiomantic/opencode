import type { ToolsBridge, ToolCallOptions, ToolResult, ToolInfo } from "@opencode-ai/plugin"
import { ToolNotFoundError, ToolPermissionError, ToolCycleError, DEFAULT_TOOL_TIMEOUT } from "@opencode-ai/plugin"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import type { Tool } from "../tool/tool"

export interface ToolsBridgeConfig {
  pluginName: string
  permissions?: {
    tools?: {
      allow?: string[]
      deny?: string[]
    }
  }
  sessionID?: string
  messageID?: string
  agent?: string
  abort?: AbortSignal
}

const callStacks = new WeakMap<ToolsBridge, Set<string>>()

export function createToolsBridge(config: ToolsBridgeConfig): ToolsBridge {
  const bridge: ToolsBridge = {
    async call<T = unknown>(
      id: string,
      args: Record<string, unknown>,
      options?: ToolCallOptions,
    ): Promise<ToolResult<T>> {
      // Check permissions
      if (!options?.skipPermissions) {
        if (!checkPermission(id, config.permissions)) {
          throw new ToolPermissionError(id, config.pluginName)
        }
      }

      // Cycle detection
      let stack = callStacks.get(bridge)
      if (!stack) {
        stack = new Set()
        callStacks.set(bridge, stack)
      }
      if (stack.has(id)) {
        throw new ToolCycleError([...stack, id])
      }
      stack.add(id)

      try {
        const timeout = options?.timeout ?? DEFAULT_TOOL_TIMEOUT
        const context = createContext(config, options)

        // Try built-in tools first
        const registryTools = await ToolRegistry.tools({ providerID: "opencode", modelID: "default" })
        const builtinTool = registryTools.find((t) => t.id === id)

        if (builtinTool) {
          const result = await Promise.race([
            builtinTool.execute(args, context),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Tool ${id} timed out after ${timeout}ms`)), timeout),
            ),
          ])

          return {
            output: result.output as T,
            title: result.title,
            metadata: result.metadata as Record<string, unknown>,
          }
        }

        // Try MCP tools
        const mcpTools = await MCP.tools()
        const mcpTool = mcpTools[id]

        if (mcpTool && mcpTool.execute) {
          const mcpResult = await Promise.race([
            mcpTool.execute(args, { toolCallId: crypto.randomUUID(), messages: [] }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Tool ${id} timed out after ${timeout}ms`)), timeout),
            ),
          ])

          // MCP tools return { content: [...] }
          if (typeof mcpResult === "object" && mcpResult !== null && "content" in mcpResult) {
            const content = (mcpResult as { content: Array<{ type: string; text?: string }> }).content
            const textParts = content.filter((c) => c.type === "text").map((c) => c.text ?? "")
            return {
              output: textParts.join("\n") as T,
            }
          }

          return {
            output: mcpResult as T,
          }
        }

        // Tool not found
        const availableBuiltin = registryTools.map((t) => t.id)
        const availableMcp = Object.keys(mcpTools)
        throw new ToolNotFoundError(id, [...availableBuiltin, ...availableMcp])
      } finally {
        stack.delete(id)
      }
    },

    async list(): Promise<ToolInfo[]> {
      const result: ToolInfo[] = []

      // Built-in tools
      const registryTools = await ToolRegistry.tools({ providerID: "opencode", modelID: "default" })
      for (const tool of registryTools) {
        result.push({
          id: tool.id,
          description: tool.description,
          parameters: tool.parameters as any,
          source: "builtin",
        })
      }

      // MCP tools
      const mcpTools = await MCP.tools()
      for (const [id, tool] of Object.entries(mcpTools)) {
        result.push({
          id,
          description: tool.description ?? "",
          parameters: {},
          source: "mcp",
          server: id.split("_")[0],
        })
      }

      return result
    },

    async has(id: string): Promise<boolean> {
      const registryTools = await ToolRegistry.tools({ providerID: "opencode", modelID: "default" })
      if (registryTools.some((t) => t.id === id)) return true

      const mcpTools = await MCP.tools()
      return id in mcpTools
    },
  }

  return bridge
}

function checkPermission(toolId: string, permissions?: { tools?: { allow?: string[]; deny?: string[] } }): boolean {
  if (!permissions?.tools) return true

  // Deny list takes precedence
  if (permissions.tools.deny?.includes(toolId)) {
    return false
  }

  // If allow list exists, it's a whitelist
  if (permissions.tools.allow) {
    return permissions.tools.allow.includes(toolId)
  }

  return true
}

function createContext(config: ToolsBridgeConfig, options?: ToolCallOptions): Tool.Context {
  const callId = crypto.randomUUID()

  if (config.sessionID) {
    // Use session context
    return {
      sessionID: config.sessionID,
      messageID: config.messageID ?? `plugin-${callId}`,
      agent: config.agent ?? "default",
      abort: options?.signal ?? config.abort ?? new AbortController().signal,
      callID: callId,
      messages: [],
      metadata: () => {},
      ask: async () => {},
    }
  }

  // Synthetic context
  return {
    sessionID: `plugin-${config.pluginName}-${Date.now()}`,
    messageID: `plugin-call-${callId}`,
    agent: "default",
    abort: options?.signal ?? new AbortController().signal,
    callID: callId,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}
