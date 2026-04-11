import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { EventEmitNotificationSchema, EventSubscribeResultSchema, EventUnsubscribeResultSchema, EventListResultSchema } from "@modelcontextprotocol/core/packages/core/src/types/schemas.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod/v4"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { withTimeout } from "@/util/timeout"
import { AppFileSystem } from "@/filesystem"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import open from "open"
import { Effect, Exit, Layer, Option, ServiceMap, Stream } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"

/**
 * v2 spec client config shape. Mirrors `Config.Mcp.events` but pre-resolved to
 * default values so callers don't need to `??` every field.
 */
export interface ResolvedEventConfig {
  trust: "trusted" | "untrusted" | "unknown" | "configured"
  defaults: {
    content?: import("../session/event-queue").McpHandle
    signal?: import("../session/event-queue").McpHandle
  }
  topicOverrides?: Record<string, import("../session/event-queue").McpHandle>
}

/**
 * Resolve the v2 events config for an MCP server. Defaults:
 *   trust: "configured" if any `events` config is present, else "trusted"
 *
 * Returns per-kind defaults and per-topic overrides as stored in the client
 * config. Kind fallbacks (content->inject, signal->silent) are applied later
 * in resolveHandle().
 */
export function resolveEventConfig(mcp: Config.Mcp): ResolvedEventConfig {
  const events = mcp.events
  if (!events) {
    return {
      trust: "trusted",
      defaults: {},
      topicOverrides: undefined,
    }
  }
  return {
    trust: (events.trust as ResolvedEventConfig["trust"]) ?? "configured",
    defaults: {
      content: events.defaults?.content as import("../session/event-queue").McpHandle | undefined,
      signal: events.defaults?.signal as import("../session/event-queue").McpHandle | undefined,
    },
    topicOverrides: events.topics as Record<string, import("../session/event-queue").McpHandle> | undefined,
  }
}

/**
 * Convert topic patterns with {param} placeholders to MQTT-style + wildcards
 * for MCP event subscription.
 *
 * When an agentId is provided, `{agent_id}` placeholders are replaced with
 * the literal agent ID so the server can enforce per-agent topic isolation.
 * Remaining `{param}` placeholders are converted to `+` wildcards as before.
 *
 * For backward compatibility with spec v1 topics, `{session_id}` is still
 * treated as an agent_id placeholder.
 */
export function convertTopicPatterns(
  topics: Array<{ pattern: string }>,
  agentId?: string,
): string[] {
  return topics.map((t) => {
    let pattern = t.pattern
    if (agentId) {
      pattern = pattern.replace(/\{agent_id\}/g, agentId)
      pattern = pattern.replace(/\{session_id\}/g, agentId)
    }
    return pattern.replace(/\{[^}]+\}/g, "+")
  })
}

/**
 * Buffered MCP event, pushed by the notification handler and drained by the
 * prompt loop in prompt.ts.
 *
 * The buffer is client-global but each entry is already fanned out to a
 * specific agent -- `agent_id` identifies the target opencode session.
 * prompt.ts drains the buffer and routes entries to the matching agent's
 * EventQueue.
 */
export interface McpBufferedEvent {
  agent_id: string
  server: string
  topic: string
  payload: unknown
  event_id: string
  priority?: "low" | "normal" | "high" | "urgent"
  handle: import("../session/event-queue").McpHandle
  kind: import("../session/event-queue").McpEventKind
  retained?: boolean
  source?: string
  expires_at?: string
}

/**
 * Global event buffer for MCP events.
 *
 * The MCP notification handler pushes events here from an async callback where
 * Effect.runPromise creates an isolated runtime. The prompt loop in prompt.ts
 * drains events from this buffer at each iteration, bridging the runtime
 * isolation gap between the MCP SDK callback and the main Effect runtime where
 * the Bus service is properly scoped.
 *
 * Thread safety: Node.js/Bun execute JavaScript on a single thread. Individual
 * array operations (push, splice) run to completion without preemption, so no
 * mutex or lock is needed. If the runtime model ever changes to true
 * multi-threading, this assumption must be revisited.
 *
 * Capacity: bounded to MAX_BUFFER_SIZE entries. When the limit is exceeded,
 * the oldest events are evicted (FIFO) to prevent unbounded memory growth
 * from a misbehaving or high-throughput MCP server.
 */
const MAX_BUFFER_SIZE = 100

export const mcpEventBuffer: McpBufferedEvent[] = []

/**
 * Append an event to the global buffer, evicting the oldest entries when the
 * buffer exceeds MAX_BUFFER_SIZE.
 */
export function pushMcpEvent(event: McpBufferedEvent): void {
  mcpEventBuffer.push(event)
  if (mcpEventBuffer.length > MAX_BUFFER_SIZE) {
    const excess = mcpEventBuffer.length - MAX_BUFFER_SIZE
    mcpEventBuffer.splice(0, excess)
    Log.create({ service: "mcp" }).warn("event buffer overflow, dropped oldest events", {
      dropped: excess,
      bufferSize: MAX_BUFFER_SIZE,
    })
  }
}

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  export const ToolsChanged = BusEvent.define(
    "mcp.tools.changed",
    z.object({
      server: z.string(),
    }),
  )

  export const McpEvent = BusEvent.define(
    "mcp.event",
    z.object({
      agent_id: z.string(),
      server: z.string(),
      topic: z.string(),
      payload: z.unknown(),
      event_id: z.string(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      handle: z.enum(["drop", "silent", "notify", "ask", "inject", "interrupt"]),
      kind: z.enum(["content", "signal"]),
      retained: z.boolean().optional(),
      source: z.string().optional(),
      expires_at: z.string().optional(),
    }),
  )

  export const BrowserOpenFailed = BusEvent.define(
    "mcp.browser.open.failed",
    z.object({
      mcpName: z.string(),
      url: z.string(),
    }),
  )

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  // Store transports for OAuth servers to allow finishing auth
  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]

  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }

  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

  // Convert MCP tool definition to AI SDK Tool type
  function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Tool {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        return client.callTool(
          {
            name: mcpTool.name,
            arguments: (args || {}) as Record<string, unknown>,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout,
          },
        )
      },
    })
  }

  function defs(key: string, client: MCPClient, timeout?: number) {
    return Effect.tryPromise({
      try: () => withTimeout(client.listTools(), timeout ?? DEFAULT_TIMEOUT),
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    }).pipe(
      Effect.map((result) => result.tools),
      Effect.catch((err) => {
        log.error("failed to get tools from client", { key, error: err })
        return Effect.succeed(undefined)
      }),
    )
  }

  function fetchFromClient<T extends { name: string }>(
    clientName: string,
    client: Client,
    listFn: (c: Client) => Promise<T[]>,
    label: string,
  ) {
    return Effect.tryPromise({
      try: () => listFn(client),
      catch: (e: any) => {
        log.error(`failed to get ${label}`, { clientName, error: e.message })
        return e
      },
    }).pipe(
      Effect.map((items) => {
        const out: Record<string, T & { client: string }> = {}
        const sanitizedClient = sanitize(clientName)
        for (const item of items) {
          out[sanitizedClient + ":" + sanitize(item.name)] = { ...item, client: clientName }
        }
        return out
      }),
      Effect.orElseSucceed(() => undefined),
    )
  }

  interface CreateResult {
    mcpClient?: MCPClient
    status: Status
    defs?: MCPToolDef[]
  }

  // --- Effect Service ---

  interface State {
    status: Record<string, Status>
    clients: Record<string, MCPClient>
    defs: Record<string, MCPToolDef[]>
  }

  export interface Interface {
    readonly status: () => Effect.Effect<Record<string, Status>>
    readonly clients: () => Effect.Effect<Record<string, MCPClient>>
    readonly tools: () => Effect.Effect<Record<string, Tool>>
    readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
    readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
    readonly add: (name: string, mcp: Config.Mcp) => Effect.Effect<{ status: Record<string, Status> | Status }>
    readonly connect: (name: string) => Effect.Effect<void>
    readonly disconnect: (name: string) => Effect.Effect<void>
    readonly getPrompt: (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
    readonly readResource: (
      clientName: string,
      resourceUri: string,
    ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
    readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>
    readonly authenticate: (mcpName: string) => Effect.Effect<Status>
    readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status>
    readonly removeAuth: (mcpName: string) => Effect.Effect<void>
    readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>
    readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
    readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
    readonly subscribeAgent: (agentId: string) => Effect.Effect<void>
    readonly unsubscribeAgent: (agentId: string) => Effect.Effect<void>
    readonly eventConfig: (mcpName: string) => Effect.Effect<ResolvedEventConfig | undefined>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/MCP") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const auth = yield* McpAuth.Service
      const bus = yield* Bus.Service

      type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

      /**
       * Connect a client via the given transport with resource safety:
       * on failure the transport is closed; on success the caller owns it.
       */
      // Maps MCP clients to their server-assigned session UUID (from InitializeResult._meta.session_id).
      // Used to substitute {session_id} in event topic patterns with the real UUID.
      const sessionIds = new Map<MCPClient, string>()

      const connectTransport = (transport: Transport, timeout: number) =>
        Effect.acquireUseRelease(
          Effect.succeed(transport),
          (t) =>
            Effect.tryPromise({
              try: () => {
                const client = new Client({ name: "opencode", version: Installation.VERSION })
                // Intercept the initialize request to capture _meta.session_id from the response.
                // The SDK validates & uses the result but does not expose _meta publicly.
                if (typeof client.request === "function") {
                  const origRequest = client.request.bind(client)
                  ;(client as any).request = async function (req: any, schema: any, opts?: any) {
                    const result = await origRequest(req, schema, opts)
                    if (req.method === "initialize" && result?._meta?.session_id) {
                      sessionIds.set(client, result._meta.session_id as string)
                    }
                    return result
                  }
                }
                return withTimeout(client.connect(t), timeout).then(() => client)
              },
              catch: (e) => (e instanceof Error ? e : new Error(String(e))),
            }),
          (t, exit) => (Exit.isFailure(exit) ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void),
        )

      const DISABLED_RESULT: CreateResult = { status: { status: "disabled" } }

      const connectRemote = Effect.fn("MCP.connectRemote")(function* (
        key: string,
        mcp: Config.Mcp & { type: "remote" },
      ) {
        const oauthDisabled = mcp.oauth === false
        const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
        let authProvider: McpOAuthProvider | undefined

        if (!oauthDisabled) {
          authProvider = new McpOAuthProvider(
            key,
            mcp.url,
            {
              clientId: oauthConfig?.clientId,
              clientSecret: oauthConfig?.clientSecret,
              scope: oauthConfig?.scope,
            },
            {
              onRedirect: async (url) => {
                log.info("oauth redirect requested", { key, url: url.toString() })
              },
            },
          )
        }

        const transports: Array<{ name: string; transport: TransportWithAuth }> = [
          {
            name: "StreamableHTTP",
            transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
              authProvider,
              requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
            }),
          },
          {
            name: "SSE",
            transport: new SSEClientTransport(new URL(mcp.url), {
              authProvider,
              requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
            }),
          },
        ]

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        let lastStatus: Status | undefined

        for (const { name, transport } of transports) {
          const result = yield* connectTransport(transport, connectTimeout).pipe(
            Effect.map((client) => ({ client, transportName: name })),
            Effect.catch((error) => {
              const lastError = error instanceof Error ? error : new Error(String(error))
              const isAuthError =
                error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))

              if (isAuthError) {
                log.info("mcp server requires authentication", { key, transport: name })

                if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                  lastStatus = {
                    status: "needs_client_registration" as const,
                    error: "Server does not support dynamic client registration. Please provide clientId in config.",
                  }
                  return bus
                    .publish(TuiEvent.ToastShow, {
                      title: "MCP Authentication Required",
                      message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                      variant: "warning",
                      duration: 8000,
                    })
                    .pipe(Effect.ignore, Effect.as(undefined))
                } else {
                  pendingOAuthTransports.set(key, transport)
                  lastStatus = { status: "needs_auth" as const }
                  return bus
                    .publish(TuiEvent.ToastShow, {
                      title: "MCP Authentication Required",
                      message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                      variant: "warning",
                      duration: 8000,
                    })
                    .pipe(Effect.ignore, Effect.as(undefined))
                }
              }

              log.debug("transport connection failed", {
                key,
                transport: name,
                url: mcp.url,
                error: lastError.message,
              })
              lastStatus = { status: "failed" as const, error: lastError.message }
              return Effect.succeed(undefined)
            }),
          )
          if (result) {
            log.info("connected", { key, transport: result.transportName })
            return { client: result.client as MCPClient | undefined, status: { status: "connected" } as Status }
          }
          // If this was an auth error, stop trying other transports
          if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
        }

        return {
          client: undefined as MCPClient | undefined,
          status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
        }
      })

      const connectLocal = Effect.fn("MCP.connectLocal")(function* (key: string, mcp: Config.Mcp & { type: "local" }) {
        const [cmd, ...args] = mcp.command
        const cwd = Instance.directory
        const transport = new StdioClientTransport({
          stderr: "pipe",
          command: cmd,
          args,
          cwd,
          env: {
            ...process.env,
            ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
            ...mcp.environment,
          },
        })
        transport.stderr?.on("data", (chunk: Buffer) => {
          log.info(`mcp stderr: ${chunk.toString()}`, { key })
        })

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        return yield* connectTransport(transport, connectTimeout).pipe(
          Effect.map((client): { client: MCPClient | undefined; status: Status } => ({
            client,
            status: { status: "connected" },
          })),
          Effect.catch((error): Effect.Effect<{ client: MCPClient | undefined; status: Status }> => {
            const msg = error instanceof Error ? error.message : String(error)
            log.error("local mcp startup failed", { key, command: mcp.command, cwd, error: msg })
            return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
          }),
        )
      })

      const create = Effect.fn("MCP.create")(function* (key: string, mcp: Config.Mcp) {
        if (mcp.enabled === false) {
          log.info("mcp server disabled", { key })
          return DISABLED_RESULT
        }

        log.info("found", { key, type: mcp.type })

        const { client: mcpClient, status } =
          mcp.type === "remote"
            ? yield* connectRemote(key, mcp as Config.Mcp & { type: "remote" })
            : yield* connectLocal(key, mcp as Config.Mcp & { type: "local" })

        if (!mcpClient) {
          return { status } satisfies CreateResult
        }

        const listed = yield* defs(key, mcpClient, mcp.timeout)
        if (!listed) {
          yield* Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore)
          return { status: { status: "failed", error: "Failed to get tools" } } satisfies CreateResult
        }

        log.info("create() successfully created client", { key, toolCount: listed.length })
        return { mcpClient, status, defs: listed } satisfies CreateResult
      })
      // Per-agent subscription tracking. Each opencode chat session (agent)
      // registers its own subscription set with each connected MCP server.
      //
      // serverSubscriptions[serverName][agentId] = { patterns, topicDecls }
      //
      // Fan-out on event arrival iterates all agent entries and delivers a
      // copy to every agent whose patterns match the event topic (spec v2
      // non-destructive fan-out).
      interface TopicDecl {
        pattern: string
        kind: import("../session/event-queue").McpEventKind
        suggestedHandle?: import("../session/event-queue").McpHandle
      }
      interface AgentSub {
        patterns: string[]
        topicDecls: TopicDecl[]
      }
      const serverSubscriptions = new Map<string, Map<string, AgentSub>>()

      // Cached topic declarations from the server, keyed by server name.
      // Populated by events/list at connect time. Used by subscribeAgent to
      // resolve {agent_id} placeholders without re-fetching.
      const serverTopicCatalog = new Map<string, TopicDecl[]>()

      // Client trust assessment + handle config, keyed by server name.
      // Populated when a server is created and reused on every event arrival.
      const serverEventConfig = new Map<string, ResolvedEventConfig>()

      // Bounded LRU of recently-seen event IDs for deduplication.
      // Spec recommends ~1000 entries. Duplicate events are silently dropped.
      const EVENT_DEDUP_LIMIT = 1000
      const eventDedup = new Set<string>()

      function dedupSeen(eventId: string): boolean {
        if (eventDedup.has(eventId)) return true
        eventDedup.add(eventId)
        if (eventDedup.size > EVENT_DEDUP_LIMIT) {
          // Set iteration order is insertion order; delete the oldest.
          const first = eventDedup.values().next().value
          if (first !== undefined) eventDedup.delete(first)
        }
        return false
      }

      const cfgSvc = yield* Config.Service

      const descendants = Effect.fnUntraced(
        function* (pid: number) {
          if (process.platform === "win32") return [] as number[]
          const pids: number[] = []
          const queue = [pid]
          while (queue.length > 0) {
            const current = queue.shift()!
            const handle = yield* spawner.spawn(
              ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }),
            )
            const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
            yield* handle.exitCode
            for (const tok of text.split("\n")) {
              const cpid = parseInt(tok, 10)
              if (!isNaN(cpid) && !pids.includes(cpid)) {
                pids.push(cpid)
                queue.push(cpid)
              }
            }
          }
          return pids
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed([] as number[])),
      )

      function watch(s: State, name: string, client: MCPClient, timeout?: number) {
        // Catch-all for any notification the SDK doesn't dispatch to a registered handler
        client.fallbackNotificationHandler = async (notification: any) => {
          // no-op: catch-all for unhandled notifications
        }
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          log.info("tools list changed notification received", { server: name })
          if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

          const listed = await Effect.runPromise(defs(name, client, timeout))
          if (!listed) return
          if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

          s.defs[name] = listed
          await Effect.runPromise(bus.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
        })

        // Register event handler by method name directly instead of using
        // setNotificationHandler(schema, ...) because the SDK's getMethodLiteral()
        // may fail when the schema comes from a different Zod version than the SDK.
        ;(client as any)._notificationHandlers.set("events/emit", async (notification: any) => {
          const event = notification.params
          // v2 spec wire format is camelCase (JSON-RPC convention): eventId,
          // expiresAt, etc. We also accept snake_case for backward compat with
          // older servers.
          const eventId: string = event.eventId ?? event.event_id
          const topic: string = event.topic
          const priority: string | undefined = event.priority
          const source: string | undefined = event.source
          const expiresAt: string | undefined = event.expiresAt ?? event.expires_at
          const retained: boolean | undefined = event.retained

          log.info("event received", { server: name, topic, event_id: eventId })

          // v2 spec: clients SHOULD dedupe by eventId with a bounded LRU.
          if (eventId && dedupSeen(eventId)) {
            log.debug("dropping duplicate event", { server: name, topic, event_id: eventId })
            return
          }

          // Non-destructive fan-out: iterate ALL active agent subscriptions
          // on this server and deliver a copy to every agent whose patterns
          // match the event topic. Reference implementation from the spec:
          //
          //   for each (pattern, agent_id) in all_agent_subscriptions:
          //       if mqttTopicMatch(pattern, event.topic):
          //           enqueue(agent_id, event)
          const { mqttTopicMatch, resolveHandle } = await import("@/session/event-queue")
          const agentMap = serverSubscriptions.get(name)
          if (!agentMap || agentMap.size === 0) {
            log.warn("dropping event -- no active agent subscriptions", { server: name, topic })
            return
          }
          const eventConfig = serverEventConfig.get(name) ?? {
            trust: "trusted" as const,
            defaults: {},
            topicOverrides: undefined,
          }

          let delivered = 0
          for (const [agentId, sub] of agentMap.entries()) {
            const matchingPattern = sub.patterns.find((pattern) => mqttTopicMatch(pattern, topic))
            if (!matchingPattern) continue

            // Find the matching topic declaration so we know the kind and
            // suggestedHandle. We match the declaration using the server's
            // original pattern (with {agent_id}); the resolved pattern from
            // sub.patterns has that placeholder substituted, so we cannot
            // simply compare strings. Match by index: sub.patterns[i]
            // corresponds to sub.topicDecls[i] after filtering.
            const patternIdx = sub.patterns.indexOf(matchingPattern)
            const decl = patternIdx >= 0 ? sub.topicDecls[patternIdx] : undefined
            const kind = decl?.kind ?? "content"
            const suggestedHandle = decl?.suggestedHandle

            const handle = resolveHandle({
              topic,
              kind,
              perKindDefault: eventConfig.defaults[kind],
              serverSuggestedHandle: suggestedHandle,
              topicOverrides: eventConfig.topicOverrides,
            })

            // Drop at the earliest opportunity: no buffering, no logging noise.
            if (handle === "drop") continue

            pushMcpEvent({
              agent_id: agentId,
              server: name,
              topic,
              payload: event.payload,
              event_id: eventId,
              priority: priority as McpBufferedEvent["priority"],
              handle,
              kind,
              retained,
              source,
              expires_at: expiresAt,
            })
            delivered += 1
          }

          if (delivered === 0) {
            log.warn("dropping event -- no agent subscription matched", { server: name, topic })
          }
        })
      }

      /**
       * Connect-time discovery: fetch the server's topic catalog via
       * `events/list` and cache it. No subscription calls are issued here --
       * subscriptions are per-agent and happen later when a session registers
       * via `subscribeAgent`.
       *
       * If the server does not support events, the request fails and we
       * catch it silently.
       */
      const discoverEventTopics = Effect.fn("MCP.discoverEventTopics")(function* (
        key: string,
        client: MCPClient,
      ) {
        yield* Effect.tryPromise({
          try: async () => {
            const listResult = await client.request(
              { method: "events/list", params: {} },
              EventListResultSchema as any,
            )
            const topics = (listResult?.topics ?? []) as Array<{
              pattern: string
              kind?: string
              suggestedHandle?: string
            }>
            if (!topics.length) {
              log.info("no event topics from server", { server: key })
              serverTopicCatalog.set(key, [])
              return
            }
            const catalog: TopicDecl[] = topics.map((t) => ({
              pattern: t.pattern,
              kind: (t.kind as import("../session/event-queue").McpEventKind) ?? "content",
              suggestedHandle: t.suggestedHandle as import("../session/event-queue").McpHandle | undefined,
            }))
            serverTopicCatalog.set(key, catalog)
            log.info("discovered event topics", { server: key, count: catalog.length })
          },
          catch: (e) => {
            log.debug("events/list not supported", { server: key, error: String(e) })
            serverTopicCatalog.set(key, [])
            return e
          },
        }).pipe(Effect.ignore)
      })

      /**
       * Register a per-agent subscription with every connected MCP server.
       * The `{agent_id}` placeholder in each topic pattern is replaced with
       * the literal agent ID so the server can enforce per-agent isolation.
       *
       * Agent subscriptions are the unit of fan-out: when an event arrives,
       * the notification handler iterates ALL agent entries and delivers a
       * copy to every agent whose patterns match the event topic.
       *
       * This is idempotent: calling it twice for the same agent replaces
       * the previous subscription.
       */
      const subscribeAgent = Effect.fn("MCP.subscribeAgent")(function* (agentId: string) {
        const s = yield* InstanceState.get(state)
        for (const [serverName, client] of Object.entries(s.clients)) {
          if (s.status[serverName]?.status !== "connected") continue
          const catalog = serverTopicCatalog.get(serverName)
          if (!catalog || catalog.length === 0) continue

          const patterns = convertTopicPatterns(
            catalog.map((t) => ({ pattern: t.pattern })),
            agentId,
          )
          yield* Effect.tryPromise({
            try: async () => {
              const subscribeResult = await client.request(
                { method: "events/subscribe", params: { topics: patterns } },
                EventSubscribeResultSchema as any,
              )

              // Store the agent's subscription. We pair the resolved patterns
              // with the original declarations so the notification handler can
              // recover kind/suggestedHandle when an event arrives.
              const agentMap = serverSubscriptions.get(serverName) ?? new Map<string, AgentSub>()
              agentMap.set(agentId, {
                patterns,
                topicDecls: catalog,
              })
              serverSubscriptions.set(serverName, agentMap)

              // Deliver retained values as if they had just been emitted. We
              // only fan out to the subscribing agent -- other agents already
              // received the retained value at their own subscribe time.
              const eventConfig = serverEventConfig.get(serverName) ?? {
                trust: "trusted" as const,
                defaults: {},
                topicOverrides: undefined,
              }
              for (const retained of subscribeResult.retained ?? []) {
                try {
                  const { mqttTopicMatch, resolveHandle } = await import("@/session/event-queue")
                  // Find the matching declaration (by matching pattern -> topic).
                  const patternIdx = patterns.findIndex((pattern) => mqttTopicMatch(pattern, retained.topic))
                  const decl = patternIdx >= 0 ? catalog[patternIdx] : undefined
                  const kind = decl?.kind ?? "content"
                  const suggestedHandle = decl?.suggestedHandle
                  const handle = resolveHandle({
                    topic: retained.topic,
                    kind,
                    perKindDefault: eventConfig.defaults[kind],
                    serverSuggestedHandle: suggestedHandle,
                    topicOverrides: eventConfig.topicOverrides,
                  })
                  if (handle === "drop") continue
                  pushMcpEvent({
                    agent_id: agentId,
                    server: serverName,
                    topic: retained.topic,
                    payload: retained.payload,
                    event_id: retained.event_id,
                    handle,
                    kind,
                    retained: true,
                    source: (retained as any).source,
                    expires_at: (retained as any).expires_at,
                  })
                } catch (e) {
                  log.warn("failed to deliver retained event", { topic: retained.topic, error: e })
                }
              }

              log.info("agent subscribed to events", {
                server: serverName,
                agentId,
                patterns: patterns.length,
                subscribed: (subscribeResult.subscribed ?? []).length,
              })
            },
            catch: (e) => {
              log.warn("failed to subscribe agent to events", {
                server: serverName,
                agentId,
                error: String(e),
              })
              return e
            },
          }).pipe(Effect.ignore)
        }
      })

      /**
       * Unregister a per-agent subscription from every connected MCP server.
       * Best-effort: network failures do not block local cleanup.
       */
      const unsubscribeAgent = Effect.fn("MCP.unsubscribeAgent")(function* (agentId: string) {
        const s = yield* InstanceState.get(state)
        for (const [serverName, client] of Object.entries(s.clients)) {
          const agentMap = serverSubscriptions.get(serverName)
          const sub = agentMap?.get(agentId)
          if (!sub) continue
          // Best-effort: 3-second timeout so a hung server does not delay cleanup.
          yield* Effect.tryPromise({
            try: () =>
              withTimeout(
                client.request(
                  { method: "events/unsubscribe", params: { topics: sub.patterns } },
                  EventUnsubscribeResultSchema as any,
                ),
                3_000,
              ),
            catch: (e) => {
              log.debug("failed to unsubscribe agent", { server: serverName, agentId, error: String(e) })
              return e
            },
          }).pipe(Effect.ignore)
          agentMap!.delete(agentId)
          if (agentMap!.size === 0) serverSubscriptions.delete(serverName)
          log.info("agent unsubscribed from events", { server: serverName, agentId })
        }
      })

      const state = yield* InstanceState.make<State>(
        Effect.fn("MCP.state")(function* () {
          const cfg = yield* cfgSvc.get()
          const config = cfg.mcp ?? {}
          const s: State = {
            status: {},
            clients: {},
            defs: {},
          }

          yield* Effect.forEach(
            Object.entries(config),
            ([key, mcp]) =>
              Effect.gen(function* () {
                if (!isMcpConfigured(mcp)) {
                  log.error("Ignoring MCP config entry without type", { key })
                  return
                }

                if (mcp.enabled === false) {
                  s.status[key] = { status: "disabled" }
                  return
                }

                const result = yield* create(key, mcp).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!result) return

                s.status[key] = result.status
                if (result.mcpClient) {
                  s.clients[key] = result.mcpClient
                  s.defs[key] = result.defs!
                  serverEventConfig.set(key, resolveEventConfig(mcp))
                  watch(s, key, result.mcpClient, mcp.timeout)
                  yield* discoverEventTopics(key, result.mcpClient)
                }
              }),
            { concurrency: "unbounded" },
          )

          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              yield* Effect.forEach(
                Object.values(s.clients),
                (client) =>
                  Effect.gen(function* () {
                    const pid = (client.transport as any)?.pid
                    if (typeof pid === "number") {
                      const pids = yield* descendants(pid)
                      for (const dpid of pids) {
                        try {
                          process.kill(dpid, "SIGTERM")
                        } catch {}
                      }
                    }
                    sessionIds.delete(client)
                    yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
                  }),
                { concurrency: "unbounded" },
              )
              pendingOAuthTransports.clear()
            }),
          )

          return s
        }),
      )

      function closeClient(s: State, name: string) {
        const client = s.clients[name]
        delete s.defs[name]
        if (!client) return Effect.void
        sessionIds.delete(client)
        return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
      }

      const status = Effect.fn("MCP.status")(function* () {
        const s = yield* InstanceState.get(state)

        const cfg = yield* cfgSvc.get()
        const config = cfg.mcp ?? {}
        const result: Record<string, Status> = {}

        for (const [key, mcp] of Object.entries(config)) {
          if (!isMcpConfigured(mcp)) continue
          result[key] = s.status[key] ?? { status: "disabled" }
        }

        return result
      })

      const clients = Effect.fn("MCP.clients")(function* () {
        const s = yield* InstanceState.get(state)
        return s.clients
      })

      const createAndStore = Effect.fn("MCP.createAndStore")(function* (name: string, mcp: Config.Mcp) {
        const s = yield* InstanceState.get(state)
        const result = yield* create(name, mcp)

        s.status[name] = result.status
        if (!result.mcpClient) {
          serverSubscriptions.delete(name)
          serverTopicCatalog.delete(name)
          yield* closeClient(s, name)
          delete s.clients[name]
          return result.status
        }

        serverSubscriptions.delete(name)
        serverTopicCatalog.delete(name)
        yield* closeClient(s, name)
        s.clients[name] = result.mcpClient
        s.defs[name] = result.defs!
        serverEventConfig.set(name, resolveEventConfig(mcp))
        watch(s, name, result.mcpClient, mcp.timeout)
        yield* discoverEventTopics(name, result.mcpClient)

        // Re-subscribe any agents that were registered before this server
        // reconnected. Fan-out routing requires fresh subscriptions after a
        // transport reset.
        const previouslyRegisteredAgents = Array.from(serverSubscriptions.get(name)?.keys() ?? [])
        for (const agentId of previouslyRegisteredAgents) {
          yield* subscribeAgent(agentId)
        }
        return result.status
      })

      const add = Effect.fn("MCP.add")(function* (name: string, mcp: Config.Mcp) {
        yield* createAndStore(name, mcp)
        const s = yield* InstanceState.get(state)
        return { status: s.status }
      })

      const connect = Effect.fn("MCP.connect")(function* (name: string) {
        const mcp = yield* getMcpConfig(name)
        if (!mcp) {
          log.error("MCP config not found or invalid", { name })
          return
        }
        yield* createAndStore(name, { ...mcp, enabled: true })
      })

      const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
        const s = yield* InstanceState.get(state)
        // Best-effort unsubscribe before closing transport. Collect the union
        // of all active agents' patterns so we only send one events/unsubscribe.
        // Use a 3-second timeout so a hung server does not delay disconnect.
        const agentMap = serverSubscriptions.get(name)
        if (agentMap && s.clients[name]) {
          const allPatterns = new Set<string>()
          for (const sub of agentMap.values()) {
            for (const p of sub.patterns) allPatterns.add(p)
          }
          if (allPatterns.size > 0) {
            yield* Effect.tryPromise({
              try: () => withTimeout(
                s.clients[name]!.request(
                  { method: "events/unsubscribe", params: { topics: Array.from(allPatterns) } },
                  EventUnsubscribeResultSchema as any,
                ),
                3_000,
              ),
              catch: () => undefined,
            }).pipe(Effect.ignore)
          }
        }
        serverSubscriptions.delete(name)
        serverTopicCatalog.delete(name)
        serverEventConfig.delete(name)
        yield* closeClient(s, name)
        delete s.clients[name]
        s.status[name] = { status: "disabled" }
      })

      const tools = Effect.fn("MCP.tools")(function* () {
        const result: Record<string, Tool> = {}
        const s = yield* InstanceState.get(state)

        const cfg = yield* cfgSvc.get()
        const config = cfg.mcp ?? {}
        const defaultTimeout = cfg.experimental?.mcp_timeout

        const connectedClients = Object.entries(s.clients).filter(
          ([clientName]) => s.status[clientName]?.status === "connected",
        )

        yield* Effect.forEach(
          connectedClients,
          ([clientName, client]) =>
            Effect.gen(function* () {
              const mcpConfig = config[clientName]
              const entry = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig : undefined

              const listed = s.defs[clientName]
              if (!listed) {
                log.warn("missing cached tools for connected server", { clientName })
                return
              }

              const timeout = entry?.timeout ?? defaultTimeout
              for (const mcpTool of listed) {
                result[sanitize(clientName) + "_" + sanitize(mcpTool.name)] = convertMcpTool(mcpTool, client, timeout)
              }
            }),
          { concurrency: "unbounded" },
        )
        return result
      })

      function collectFromConnected<T extends { name: string }>(
        s: State,
        listFn: (c: Client) => Promise<T[]>,
        label: string,
      ) {
        return Effect.forEach(
          Object.entries(s.clients).filter(([name]) => s.status[name]?.status === "connected"),
          ([clientName, client]) =>
            fetchFromClient(clientName, client, listFn, label).pipe(Effect.map((items) => Object.entries(items ?? {}))),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
      }

      const prompts = Effect.fn("MCP.prompts")(function* () {
        const s = yield* InstanceState.get(state)
        return yield* collectFromConnected(s, (c) => c.listPrompts().then((r) => r.prompts), "prompts")
      })

      const resources = Effect.fn("MCP.resources")(function* () {
        const s = yield* InstanceState.get(state)
        return yield* collectFromConnected(s, (c) => c.listResources().then((r) => r.resources), "resources")
      })

      const withClient = Effect.fnUntraced(function* <A>(
        clientName: string,
        fn: (client: MCPClient) => Promise<A>,
        label: string,
        meta?: Record<string, unknown>,
      ) {
        const s = yield* InstanceState.get(state)
        const client = s.clients[clientName]
        if (!client) {
          log.warn(`client not found for ${label}`, { clientName })
          return undefined
        }
        return yield* Effect.tryPromise({
          try: () => fn(client),
          catch: (e: any) => {
            log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message })
            return e
          },
        }).pipe(Effect.orElseSucceed(() => undefined))
      })

      const getPrompt = Effect.fn("MCP.getPrompt")(function* (
        clientName: string,
        name: string,
        args?: Record<string, string>,
      ) {
        return yield* withClient(clientName, (client) => client.getPrompt({ name, arguments: args }), "getPrompt", {
          promptName: name,
        })
      })

      const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
        return yield* withClient(clientName, (client) => client.readResource({ uri: resourceUri }), "readResource", {
          resourceUri,
        })
      })

      const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
        const cfg = yield* cfgSvc.get()
        const mcpConfig = cfg.mcp?.[mcpName]
        if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
        return mcpConfig
      })

      const startAuth = Effect.fn("MCP.startAuth")(function* (mcpName: string) {
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
        if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
        if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)

        yield* Effect.promise(() => McpOAuthCallback.ensureRunning())

        const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        yield* auth.updateOAuthState(mcpName, oauthState)
        const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
        let capturedUrl: URL | undefined
        const authProvider = new McpOAuthProvider(
          mcpName,
          mcpConfig.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
          },
          {
            onRedirect: async (url) => {
              capturedUrl = url
            },
          },
        )

        const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), { authProvider })

        return yield* Effect.tryPromise({
          try: () => {
            const client = new Client({ name: "opencode", version: Installation.VERSION })
            return client.connect(transport).then(() => ({ authorizationUrl: "", oauthState }))
          },
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) => {
            if (error instanceof UnauthorizedError && capturedUrl) {
              pendingOAuthTransports.set(mcpName, transport)
              return Effect.succeed({ authorizationUrl: capturedUrl.toString(), oauthState })
            }
            return Effect.die(error)
          }),
        )
      })

      const authenticate = Effect.fn("MCP.authenticate")(function* (mcpName: string) {
        const { authorizationUrl, oauthState } = yield* startAuth(mcpName)
        if (!authorizationUrl) return { status: "connected" } as Status

        log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

        const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

        yield* Effect.tryPromise(() => open(authorizationUrl)).pipe(
          Effect.flatMap((subprocess) =>
            Effect.callback<void, Error>((resume) => {
              const timer = setTimeout(() => resume(Effect.void), 500)
              subprocess.on("error", (err) => {
                clearTimeout(timer)
                resume(Effect.fail(err))
              })
              subprocess.on("exit", (code) => {
                if (code !== null && code !== 0) {
                  clearTimeout(timer)
                  resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
                }
              })
            }),
          ),
          Effect.catch(() => {
            log.warn("failed to open browser, user must open URL manually", { mcpName })
            return bus.publish(BrowserOpenFailed, { mcpName, url: authorizationUrl }).pipe(Effect.ignore)
          }),
        )

        const code = yield* Effect.promise(() => callbackPromise)

        const storedState = yield* auth.getOAuthState(mcpName)
        if (storedState !== oauthState) {
          yield* auth.clearOAuthState(mcpName)
          throw new Error("OAuth state mismatch - potential CSRF attack")
        }
        yield* auth.clearOAuthState(mcpName)
        return yield* finishAuth(mcpName, code)
      })

      const finishAuth = Effect.fn("MCP.finishAuth")(function* (mcpName: string, authorizationCode: string) {
        const transport = pendingOAuthTransports.get(mcpName)
        if (!transport) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

        const result = yield* Effect.tryPromise({
          try: () => transport.finishAuth(authorizationCode).then(() => true as const),
          catch: (error) => {
            log.error("failed to finish oauth", { mcpName, error })
            return error
          },
        }).pipe(Effect.option)

        if (Option.isNone(result)) {
          return { status: "failed", error: "OAuth completion failed" } as Status
        }

        yield* auth.clearCodeVerifier(mcpName)
        pendingOAuthTransports.delete(mcpName)

        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) return { status: "failed", error: "MCP config not found after auth" } as Status

        return yield* createAndStore(mcpName, mcpConfig)
      })

      const removeAuth = Effect.fn("MCP.removeAuth")(function* (mcpName: string) {
        yield* auth.remove(mcpName)
        McpOAuthCallback.cancelPending(mcpName)
        pendingOAuthTransports.delete(mcpName)
        log.info("removed oauth credentials", { mcpName })
      })

      const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (mcpName: string) {
        const mcpConfig = yield* getMcpConfig(mcpName)
        if (!mcpConfig) return false
        return mcpConfig.type === "remote" && mcpConfig.oauth !== false
      })

      const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (mcpName: string) {
        const entry = yield* auth.get(mcpName)
        return !!entry?.tokens
      })

      const getAuthStatus = Effect.fn("MCP.getAuthStatus")(function* (mcpName: string) {
        const entry = yield* auth.get(mcpName)
        if (!entry?.tokens) return "not_authenticated" as AuthStatus
        const expired = yield* auth.isTokenExpired(mcpName)
        return (expired ? "expired" : "authenticated") as AuthStatus
      })

      const eventConfigFor = Effect.fn("MCP.eventConfig")(function* (mcpName: string) {
        return serverEventConfig.get(mcpName)
      })

      return Service.of({
        status,
        clients,
        tools,
        prompts,
        resources,
        add,
        connect,
        disconnect,
        getPrompt,
        readResource,
        startAuth,
        authenticate,
        finishAuth,
        removeAuth,
        supportsOAuth,
        hasStoredTokens,
        getAuthStatus,
        subscribeAgent,
        unsubscribeAgent,
        eventConfig: eventConfigFor,
      })
    }),
  )

  export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

  // --- Per-service runtime ---

  export const defaultLayer = layer.pipe(
    Layer.provide(McpAuth.layer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  // --- Async facade functions ---

  export const status = async () => runPromise((svc) => svc.status())

  export const tools = async () => runPromise((svc) => svc.tools())

  export const prompts = async () => runPromise((svc) => svc.prompts())

  export const resources = async () => runPromise((svc) => svc.resources())

  export const add = async (name: string, mcp: Config.Mcp) => runPromise((svc) => svc.add(name, mcp))

  export const connect = async (name: string) => runPromise((svc) => svc.connect(name))

  export const disconnect = async (name: string) => runPromise((svc) => svc.disconnect(name))

  export const getPrompt = async (clientName: string, name: string, args?: Record<string, string>) =>
    runPromise((svc) => svc.getPrompt(clientName, name, args))

  export const startAuth = async (mcpName: string) => runPromise((svc) => svc.startAuth(mcpName))

  export const authenticate = async (mcpName: string) => runPromise((svc) => svc.authenticate(mcpName))

  export const finishAuth = async (mcpName: string, authorizationCode: string) =>
    runPromise((svc) => svc.finishAuth(mcpName, authorizationCode))

  export const removeAuth = async (mcpName: string) => runPromise((svc) => svc.removeAuth(mcpName))

  export const supportsOAuth = async (mcpName: string) => runPromise((svc) => svc.supportsOAuth(mcpName))

  export const hasStoredTokens = async (mcpName: string) => runPromise((svc) => svc.hasStoredTokens(mcpName))

  export const getAuthStatus = async (mcpName: string) => runPromise((svc) => svc.getAuthStatus(mcpName))

  export const subscribeAgent = async (agentId: string) => runPromise((svc) => svc.subscribeAgent(agentId))

  export const unsubscribeAgent = async (agentId: string) => runPromise((svc) => svc.unsubscribeAgent(agentId))

  export const eventConfig = async (mcpName: string) => runPromise((svc) => svc.eventConfig(mcpName))
}
