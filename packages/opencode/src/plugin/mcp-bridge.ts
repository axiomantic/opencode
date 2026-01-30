import type {
  McpBridge,
  McpServerConfig,
  McpStatus,
  ResourceContent,
  PromptResult,
  ToolInfo,
} from "@opencode-ai/plugin"
import { McpNotConnectedError, McpAuthError } from "@opencode-ai/plugin"
import { MCP } from "../mcp"
import type { Config } from "../config/config"

export function createMcpBridge(): McpBridge {
  return {
    async addServer(name: string, config: McpServerConfig): Promise<void> {
      const mcpConfig: Config.Mcp =
        config.type === "local"
          ? {
              type: "local",
              command: config.command,
              environment: config.environment,
              timeout: config.timeout,
            }
          : {
              type: "remote",
              url: config.url,
              headers: config.headers,
              oauth: config.oauth,
            }

      await MCP.add(name, mcpConfig)
    },

    async removeServer(name: string): Promise<void> {
      await MCP.disconnect(name)
    },

    async status(): Promise<Record<string, McpStatus>> {
      const result = await MCP.status()
      return result as Record<string, McpStatus>
    },

    async connect(name: string): Promise<void> {
      await MCP.connect(name)
    },

    async disconnect(name: string): Promise<void> {
      await MCP.disconnect(name)
    },

    async tools(server: string): Promise<ToolInfo[]> {
      const status = await MCP.status()
      const serverStatus = status[server]

      if (!serverStatus) {
        throw new McpNotConnectedError(server)
      }
      if (serverStatus.status === "needs_auth") {
        throw new McpAuthError(server)
      }
      if (serverStatus.status !== "connected") {
        throw new McpNotConnectedError(server)
      }

      const allTools = await MCP.tools()
      const result: ToolInfo[] = []
      const prefix = `${server}_`

      for (const [id, tool] of Object.entries(allTools)) {
        if (id.startsWith(prefix)) {
          result.push({
            id,
            description: tool.description ?? "",
            parameters: {},
            source: "mcp",
            server,
          })
        }
      }

      return result
    },

    async readResource(server: string, uri: string): Promise<ResourceContent> {
      const result = await MCP.readResource(server, uri)
      if (!result) {
        throw new McpNotConnectedError(server)
      }
      // Transform MCP SDK result to our interface
      const contents = result.contents?.[0] as
        | { uri?: string; mimeType?: string; text?: string; blob?: string }
        | undefined
      return {
        uri: contents?.uri ?? uri,
        mimeType: contents?.mimeType,
        text: contents?.text,
        blob: contents?.blob,
      }
    },

    async getPrompt(server: string, name: string, args?: Record<string, string>): Promise<PromptResult> {
      const result = await MCP.getPrompt(server, name, args)
      if (!result) {
        throw new McpNotConnectedError(server)
      }
      // Transform MCP SDK result to our interface
      return {
        description: result.description,
        messages:
          result.messages?.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content as any,
          })) ?? [],
      }
    },
  }
}
