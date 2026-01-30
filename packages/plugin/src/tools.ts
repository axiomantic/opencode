import type { JsonSchema7Type } from "zod-to-json-schema"

export const DEFAULT_TOOL_TIMEOUT = 30000

export interface ToolsBridge {
  call<T = unknown>(id: string, args: Record<string, unknown>, options?: ToolCallOptions): Promise<ToolResult<T>>

  list(): Promise<ToolInfo[]>

  has(id: string): Promise<boolean>
}

export interface ToolCallOptions {
  signal?: AbortSignal
  timeout?: number
  skipPermissions?: boolean
}

export interface ToolResult<T = unknown> {
  output: T
  title?: string
  metadata?: Record<string, unknown>
}

export interface ToolInfo {
  id: string
  description: string
  parameters: JsonSchema7Type
  source: "builtin" | "mcp" | "plugin"
  server?: string
}
