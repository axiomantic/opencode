export class ToolNotFoundError extends Error {
  name = "ToolNotFoundError" as const
  constructor(
    public toolId: string,
    public availableTools: string[],
  ) {
    super(
      `Tool "${toolId}" not found. Available: ${availableTools.slice(0, 5).join(", ")}${availableTools.length > 5 ? "..." : ""}`,
    )
  }
}

export class ToolPermissionError extends Error {
  name = "ToolPermissionError" as const
  constructor(
    public toolId: string,
    public pluginName: string,
  ) {
    super(`Plugin "${pluginName}" does not have permission to call "${toolId}"`)
  }
}

export class ToolCycleError extends Error {
  name = "ToolCycleError" as const
  constructor(public callStack: string[]) {
    super(`Circular tool call detected: ${callStack.join(" -> ")}`)
  }
}

export class McpNotConnectedError extends Error {
  name = "McpNotConnectedError" as const
  constructor(public server: string) {
    super(`MCP server "${server}" is not connected`)
  }
}

export class McpTimeoutError extends Error {
  name = "McpTimeoutError" as const
  constructor(
    public server: string,
    public tool: string,
    public elapsed: number,
  ) {
    super(`MCP call to ${server}/${tool} timed out after ${elapsed}ms`)
  }
}

export class McpAuthError extends Error {
  name = "McpAuthError" as const
  constructor(public server: string) {
    super(`MCP server "${server}" requires authentication. Run: opencode mcp ${server} auth`)
  }
}
