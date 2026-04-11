import { test, expect, mock, beforeEach } from "bun:test"

// --- Mock infrastructure ---

interface MockClientState {
  tools: Array<{ name: string; description?: string; inputSchema: object }>
  notificationHandlers: Map<string, (...args: any[]) => any>
  closed: boolean
  serverCapabilities: Record<string, any> | null
  requestResults: Map<string, any>
}

const clientStates = new Map<string, MockClientState>()

function getOrCreateClientState(name?: string): MockClientState {
  const key = name ?? "default"
  let state = clientStates.get(key)
  if (!state) {
    state = {
      tools: [{ name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: {} } }],
      notificationHandlers: new Map(),
      closed: false,
      serverCapabilities: null,
      requestResults: new Map(),
    }
    clientStates.set(key, state)
  }
  return state
}

// Track notification handler registrations
const registeredHandlers: Array<{ method: string; handler: Function }> = []

// Mock the MCP Client
mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    private clientName: string
    constructor(_opts: any) {
      this.clientName = "default"
    }
    async connect(_transport: any) {}
    async close() {
      const state = getOrCreateClientState(this.clientName)
      state.closed = true
    }
    async listTools() {
      const state = getOrCreateClientState(this.clientName)
      return { tools: state.tools }
    }
    setNotificationHandler(schema: any, handler: any) {
      // Extract the method literal from the schema
      const method = schema?._zod?.def?.shape?.method?._zod?.def?.value ??
        schema?.shape?.method?._def?.value ??
        "unknown"
      const state = getOrCreateClientState(this.clientName)
      state.notificationHandlers.set(method, handler)
      registeredHandlers.push({ method, handler })
    }
    getServerCapabilities() {
      const state = getOrCreateClientState(this.clientName)
      return state.serverCapabilities
    }
    async request(req: any, _schema: any) {
      const state = getOrCreateClientState(this.clientName)
      return state.requestResults.get(req.method) ?? { subscribed: [], rejected: [], retained: [] }
    }
  },
}))

// Mock transports
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor() {}
    async start() {}
    async close() {}
  },
}))
mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    constructor() {}
    async start() {}
    async close() {}
  },
}))
mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    stderr = null
    constructor() {}
    async start() {}
    async close() {}
  },
}))
mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {
    constructor(msg?: string) {
      super(msg ?? "Unauthorized")
    }
  },
}))

beforeEach(() => {
  clientStates.clear()
  registeredHandlers.length = 0
})

test("convertTopicPatterns substitutes {agent_id} with literal id and + for others", () => {
  const { convertTopicPatterns } = require("../../src/mcp/index")
  const agentId = "ses_abc123"
  const topics = [
    { pattern: "agents/{agent_id}/messages" },
    { pattern: "builds/{project_id}/status" },
    { pattern: "no-params/topic" },
    { pattern: "{agent_id}/logs/{level}" },
  ]
  const patterns = convertTopicPatterns(topics, agentId)
  expect(patterns).toEqual([
    `agents/${agentId}/messages`,
    "builds/+/status",
    "no-params/topic",
    `${agentId}/logs/+`,
  ])
})

test("convertTopicPatterns: backward-compat {session_id} still treated as agent_id", () => {
  const { convertTopicPatterns } = require("../../src/mcp/index")
  const agentId = "my-agent"
  const topics = [{ pattern: "spellbook/sessions/{session_id}/messages" }]
  const patterns = convertTopicPatterns(topics, agentId)
  expect(patterns).toEqual([`spellbook/sessions/${agentId}/messages`])
})

test("convertTopicPatterns without agentId: all placeholders become +", () => {
  const { convertTopicPatterns } = require("../../src/mcp/index")
  const topics = [
    { pattern: "agents/{agent_id}/messages" },
    { pattern: "builds/{project_id}/status" },
  ]
  const patterns = convertTopicPatterns(topics)
  expect(patterns).toEqual(["agents/+/messages", "builds/+/status"])
})

test("convertTopicPatterns: multiple {param} types get + except {agent_id}", () => {
  const { convertTopicPatterns } = require("../../src/mcp/index")
  const agentId = "abc-123"
  const topics = [{ pattern: "{agent_id}/events/{severity}/{project}" }]
  const patterns = convertTopicPatterns(topics, agentId)
  expect(patterns).toEqual([`${agentId}/events/+/+`])
})

test("convertTopicPatterns: {agent_id} appears multiple times", () => {
  const { convertTopicPatterns } = require("../../src/mcp/index")
  const agentId = "my-agent"
  const topics = [{ pattern: "agents/{agent_id}/sub/{agent_id}/data" }]
  const patterns = convertTopicPatterns(topics, agentId)
  expect(patterns).toEqual([`agents/${agentId}/sub/${agentId}/data`])
})

test("mqttTopicMatch used for subscription defense-in-depth", () => {
  // Verify the mqttTopicMatch function is importable from event-queue
  const { mqttTopicMatch } = require("../../src/session/event-queue")
  // Simulates the defense-in-depth check in the notification handler
  const activeSubs = ["agents/abc/+", "metrics/#"]

  // Should match
  expect(activeSubs.some((p: string) => mqttTopicMatch(p, "agents/abc/messages"))).toBe(true)
  expect(activeSubs.some((p: string) => mqttTopicMatch(p, "metrics/cpu/load"))).toBe(true)

  // Should NOT match - unsubscribed topic
  expect(activeSubs.some((p: string) => mqttTopicMatch(p, "other/topic"))).toBe(false)
})

test("resolveEventConfig defaults to trusted when no events config", () => {
  const { resolveEventConfig } = require("../../src/mcp/index")
  const mcp = { type: "local" as const, command: ["test"] }
  const cfg = resolveEventConfig(mcp)
  expect(cfg.trust).toBe("trusted")
  expect(cfg.defaults).toEqual({})
  expect(cfg.topicOverrides).toBeUndefined()
})

test("resolveEventConfig returns per-kind defaults from events config", () => {
  const { resolveEventConfig } = require("../../src/mcp/index")
  const mcp = {
    type: "local" as const,
    command: ["test"],
    events: {
      defaults: { content: "inject", signal: "silent" },
      topics: {
        "agents/{agent_id}/messages": "inject",
        "global/announcements": "notify",
      },
    },
  }
  const cfg = resolveEventConfig(mcp)
  expect(cfg.trust).toBe("configured")
  expect(cfg.defaults).toEqual({ content: "inject", signal: "silent" })
  expect(cfg.topicOverrides).toEqual({
    "agents/{agent_id}/messages": "inject",
    "global/announcements": "notify",
  })
})

test("resolveEventConfig honors explicit trust value", () => {
  const { resolveEventConfig } = require("../../src/mcp/index")
  const mcp = {
    type: "local" as const,
    command: ["test"],
    events: { trust: "untrusted" as const },
  }
  const cfg = resolveEventConfig(mcp)
  expect(cfg.trust).toBe("untrusted")
})

test("resolveHandle four-step resolution order", () => {
  // 1. per_topic_override
  // 2. per_kind_default
  // 3. server_suggestedHandle
  // 4. kind_fallback (content -> inject, signal -> silent)
  const { resolveHandle } = require("../../src/session/event-queue")

  // Step 1 wins
  expect(
    resolveHandle({
      topic: "a/b",
      kind: "content",
      perKindDefault: "notify",
      serverSuggestedHandle: "silent",
      topicOverrides: { "a/+": "interrupt" },
    }),
  ).toBe("interrupt")

  // Step 2 when no override matches
  expect(
    resolveHandle({
      topic: "other/topic",
      kind: "content",
      perKindDefault: "notify",
      serverSuggestedHandle: "silent",
      topicOverrides: { "a/+": "interrupt" },
    }),
  ).toBe("notify")

  // Step 3 when no override and no default
  expect(
    resolveHandle({
      topic: "x",
      kind: "signal",
      serverSuggestedHandle: "ask",
    }),
  ).toBe("ask")

  // Step 4 fallback: content -> inject
  expect(resolveHandle({ topic: "x", kind: "content" })).toBe("inject")

  // Step 4 fallback: signal -> silent
  expect(resolveHandle({ topic: "x", kind: "signal" })).toBe("silent")
})
