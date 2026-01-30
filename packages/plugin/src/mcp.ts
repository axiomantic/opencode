import type { ToolInfo } from "./tools"

export interface McpBridge {
  addServer(name: string, config: McpServerConfig): Promise<void>
  removeServer(name: string): Promise<void>
  status(): Promise<Record<string, McpStatus>>
  connect(name: string): Promise<void>
  disconnect(name: string): Promise<void>
  tools(server: string): Promise<ToolInfo[]>
  readResource(server: string, uri: string): Promise<ResourceContent>
  getPrompt(server: string, name: string, args?: Record<string, string>): Promise<PromptResult>
}

export type McpServerConfig =
  | {
      type: "local"
      command: string[]
      environment?: Record<string, string>
      timeout?: number
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
      oauth?: McpOAuth | false
    }

export interface McpOAuth {
  clientId?: string
  clientSecret?: string
  scope?: string
}

export type McpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

export interface ResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

export interface PromptResult {
  description?: string
  messages: Array<{
    role: "user" | "assistant"
    content:
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
      | { type: "resource"; resource: ResourceContent }
  }>
}
