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

// Import after mocks
import { EventEmitNotificationSchema, EventSubscribeResultSchema } from "@modelcontextprotocol/core/packages/core/src/types/schemas.js"

test("EventEmitNotificationSchema validates valid event notification", () => {
  const notification = {
    method: "events/emit",
    params: {
      topic: "spellbook/sessions/abc/messages",
      event_id: "evt-123",
      payload: { text: "hello from session B" },
      retained: false,
      requested_effects: [
        { type: "inject_context", priority: "high" },
      ],
    },
  }

  const result = EventEmitNotificationSchema.safeParse(notification)
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.method).toBe("events/emit")
    expect(result.data.params.topic).toBe("spellbook/sessions/abc/messages")
    expect(result.data.params.event_id).toBe("evt-123")
    expect(result.data.params.payload).toEqual({ text: "hello from session B" })
  }
})

test("EventEmitNotificationSchema rejects invalid method", () => {
  const notification = {
    method: "wrong/method",
    params: {
      topic: "test",
      event_id: "evt-1",
      payload: null,
    },
  }
  const result = EventEmitNotificationSchema.safeParse(notification)
  expect(result.success).toBe(false)
})

test("EventEmitNotificationSchema requires topic and event_id", () => {
  const notification = {
    method: "events/emit",
    params: {
      payload: "test",
    },
  }
  const result = EventEmitNotificationSchema.safeParse(notification)
  expect(result.success).toBe(false)
})

test("EventSubscribeResultSchema validates subscribe response", () => {
  const response = {
    subscribed: [{ pattern: "spellbook/sessions/+/messages" }],
    rejected: [],
    retained: [
      {
        topic: "spellbook/sessions/abc/status",
        event_id: "ret-1",
        payload: { status: "active" },
      },
    ],
  }
  const result = EventSubscribeResultSchema.safeParse(response)
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.subscribed).toHaveLength(1)
    expect(result.data.retained).toHaveLength(1)
    expect(result.data.retained![0].topic).toBe("spellbook/sessions/abc/status")
  }
})

test("EventSubscribeResultSchema defaults retained and rejected to empty arrays", () => {
  const response = {
    subscribed: [{ pattern: "test/+" }],
  }
  const result = EventSubscribeResultSchema.safeParse(response)
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.rejected).toEqual([])
    expect(result.data.retained).toEqual([])
  }
})

test("{param} to + conversion in subscription patterns", () => {
  const { convertTopicPatterns } = require("../../src/mcp/index")
  const topics = [
    { pattern: "spellbook/sessions/{session_id}/messages" },
    { pattern: "builds/{project_id}/status" },
    { pattern: "no-params/topic" },
  ]
  const patterns = convertTopicPatterns(topics)
  expect(patterns).toEqual([
    "spellbook/sessions/+/messages",
    "builds/+/status",
    "no-params/topic",
  ])
})

test("EventEmitNotificationSchema has correct method literal for SDK compat", () => {
  // The MCP SDK's setNotificationHandler extracts the method literal
  // from the schema to register handlers. Verify our schema has the right structure.
  const parsed = EventEmitNotificationSchema.safeParse({
    method: "events/emit",
    params: { topic: "t", event_id: "e", payload: null },
  })
  expect(parsed.success).toBe(true)
  if (parsed.success) {
    expect(parsed.data.method).toBe("events/emit")
  }
})

test("EventEmitNotificationSchema handles optional fields", () => {
  const minimal = {
    method: "events/emit",
    params: {
      topic: "test",
      event_id: "evt-1",
      payload: null,
    },
  }
  const result = EventEmitNotificationSchema.safeParse(minimal)
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.params.retained).toBeUndefined()
    expect(result.data.params.requested_effects).toBeUndefined()
    expect(result.data.params.source).toBeUndefined()
    expect(result.data.params.timestamp).toBeUndefined()
  }
})

test("resolveEventPermissions respects server events config", () => {
  const { resolveEventPermissions } = require("../../src/mcp/index")
  // Server with explicit permissions
  const mcp = {
    type: "stdio" as const,
    command: "test",
    args: [],
    events: {
      inject_context: true,
      notify_user: false,
      trigger_turn: true,
    },
  }
  const perms = resolveEventPermissions(mcp)
  expect(perms).toEqual({
    inject_context: true,
    notify_user: false,
    trigger_turn: true,
  })
})

test("default permissions when server has no events config", () => {
  const { resolveEventPermissions } = require("../../src/mcp/index")
  // When a server has no events config, resolveEventPermissions should produce
  // defaults: inject_context=false, notify_user=true, trigger_turn=false
  const mcp = {
    type: "stdio" as const,
    command: "test",
    args: [],
    // no events field
  }
  const resolved = resolveEventPermissions(mcp)
  expect(resolved).toEqual({
    inject_context: false,
    notify_user: true,
    trigger_turn: false,
  })
})

test("EventEmitNotificationSchema handles all effect types", () => {
  const notification = {
    method: "events/emit",
    params: {
      topic: "test",
      event_id: "evt-1",
      payload: "data",
      requested_effects: [
        { type: "inject_context", priority: "urgent" },
        { type: "notify_user", priority: "normal" },
        { type: "trigger_turn", priority: "high" },
      ],
    },
  }
  const result = EventEmitNotificationSchema.safeParse(notification)
  expect(result.success).toBe(true)
  if (result.success) {
    const effects = result.data.params.requested_effects!
    expect(effects).toHaveLength(3)
    expect(effects[0].type).toBe("inject_context")
    expect(effects[0].priority).toBe("urgent")
    expect(effects[1].type).toBe("notify_user")
    expect(effects[1].priority).toBe("normal")
    expect(effects[2].type).toBe("trigger_turn")
    expect(effects[2].priority).toBe("high")
  }
})
