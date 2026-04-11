import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"

/**
 * MCP Events Spec v2 client-side handle level.
 *
 * Controls HOW an event is processed by the client. The client always has
 * final say (zero-trust model). Resolution order:
 *
 *   per_topic_override ?? per_kind_default ?? server_suggestedHandle ?? kind_fallback
 *
 * where kind_fallback is "inject" for content and "silent" for signal.
 */
export type McpHandle = "drop" | "silent" | "notify" | "ask" | "inject" | "interrupt"

export type McpEventKind = "content" | "signal"

/** Handles that cause the event to be injected into LLM context. */
export function handleInjects(handle: McpHandle): boolean {
  return handle === "inject" || handle === "ask" || handle === "interrupt"
}

/**
 * Match a concrete MQTT topic against a pattern with wildcards.
 * `+` matches exactly one segment, `#` matches the rest of the topic.
 */
export function mqttTopicMatch(pattern: string, topic: string): boolean {
  const patParts = pattern.split("/")
  const topParts = topic.split("/")

  for (let i = 0; i < patParts.length; i++) {
    const p = patParts[i]
    if (p === "#") return true // matches everything from here
    if (i >= topParts.length) return false
    if (p !== "+" && p !== topParts[i]) return false
  }
  return patParts.length === topParts.length
}

/**
 * Resolve the effective handle for an event using the v2 spec resolution order:
 *
 *   per_topic_override ?? per_kind_default ?? server_suggestedHandle ?? kind_fallback
 *
 * The client always has final say. A value of `undefined` for any arg is
 * treated as "not set" and falls through to the next step.
 */
export function resolveHandle(input: {
  topic: string
  kind: McpEventKind
  perKindDefault?: McpHandle
  serverSuggestedHandle?: McpHandle
  topicOverrides?: Record<string, McpHandle>
}): McpHandle {
  if (input.topicOverrides) {
    for (const [pattern, handle] of Object.entries(input.topicOverrides)) {
      if (mqttTopicMatch(pattern, input.topic)) return handle
    }
  }
  if (input.perKindDefault) return input.perKindDefault
  if (input.serverSuggestedHandle) return input.serverSuggestedHandle
  return input.kind === "content" ? "inject" : "silent"
}

export namespace EventQueue {
  export interface QueuedEvent {
    server: string
    topic: string
    payload: unknown
    event_id: string
    priority: "low" | "normal" | "high" | "urgent"
    handle: McpHandle
    kind: McpEventKind
    received_at: number
    ttl_ms: number
    retained?: boolean
    source?: string
    expires_at?: string
  }

  // Default TTLs by priority
  const TTL_DEFAULTS: Record<string, number> = {
    urgent: 5 * 60 * 1000, // 5 min
    high: 30 * 60 * 1000, // 30 min
    normal: 2 * 60 * 60 * 1000, // 2 hours
    low: 24 * 60 * 60 * 1000, // 24 hours
  }

  const PRIORITY_ORDER: Record<string, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  }

  export interface EnqueueEvent {
    server: string
    topic: string
    payload: unknown
    event_id: string
    priority?: string
    handle: McpHandle
    kind: McpEventKind
    retained?: boolean
    source?: string
    expires_at?: string
  }

  export interface Interface {
    readonly enqueue: (agentID: string, event: EnqueueEvent) => Effect.Effect<void>
    readonly drain: (
      agentID: string,
      opts: { maxPriority: "urgent" | "high" | "normal" | "low" },
    ) => Effect.Effect<QueuedEvent[]>
    readonly pending: (agentID: string) => Effect.Effect<number>
    readonly clear: (agentID: string) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()(
    "@opencode/EventQueue",
  ) {}

  export const layer: Layer.Layer<Service, never, Bus.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const queues = new Map<string, QueuedEvent[]>()

      function getQueue(agentID: string): QueuedEvent[] {
        let q = queues.get(agentID)
        if (!q) {
          q = []
          queues.set(agentID, q)
        }
        return q
      }

      function enqueue(agentID: string, event: EnqueueEvent) {
        return Effect.sync(() => {
          // v2 spec: drop handle means discard entirely (no processing).
          if (event.handle === "drop") return

          // Use priority directly from EventParams (spec v2). No inference
          // from requestedEffects -- that field was removed.
          const raw = event.priority ?? "normal"
          const p = (PRIORITY_ORDER[raw] !== undefined ? raw : "normal") as QueuedEvent["priority"]

          // Honor expires_at from the server if present -- drop immediately
          // expired events at enqueue time.
          if (event.expires_at) {
            const exp = Date.parse(event.expires_at)
            if (!isNaN(exp) && exp <= Date.now()) return
          }

          const q = getQueue(agentID)
          q.push({
            server: event.server,
            topic: event.topic,
            payload: event.payload,
            event_id: event.event_id,
            retained: event.retained,
            source: event.source,
            expires_at: event.expires_at,
            handle: event.handle,
            kind: event.kind,
            priority: p,
            received_at: Date.now(),
            ttl_ms: TTL_DEFAULTS[p] ?? TTL_DEFAULTS.normal,
          })
        })
      }

      function drain(
        agentID: string,
        opts: { maxPriority: "urgent" | "high" | "normal" | "low" },
      ) {
        return Effect.sync(() => {
          const q = getQueue(agentID)
          const now = Date.now()
          const maxOrd = PRIORITY_ORDER[opts.maxPriority]
          const result: QueuedEvent[] = []
          const remaining: QueuedEvent[] = []

          for (const event of q) {
            // Expired by internal TTL
            if (now > event.received_at + event.ttl_ms) continue
            // Expired by server-provided expires_at
            if (event.expires_at) {
              const exp = Date.parse(event.expires_at)
              if (!isNaN(exp) && exp <= now) continue
            }
            // Only inject/ask/interrupt handles feed the LLM. silent/notify are
            // handled elsewhere (application callbacks, UI toasts) and must not
            // reach formatMcpEvents. Keep them out of the drain result.
            if (!handleInjects(event.handle)) continue
            if (PRIORITY_ORDER[event.priority] <= maxOrd) {
              result.push(event)
            } else {
              remaining.push(event)
            }
          }
          queues.set(agentID, remaining)
          // Sort by priority (urgent first)
          result.sort(
            (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
          )
          return result
        })
      }

      function pending(agentID: string) {
        return Effect.sync(() => getQueue(agentID).length)
      }

      function clear(agentID: string) {
        return Effect.sync(() => {
          queues.delete(agentID)
        })
      }

      return Service.of({ enqueue, drain, pending, clear })
    }),
  )
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
}

function escapeXmlContent(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
}

/**
 * Format buffered MCP events as an XML envelope for injection into LLM
 * context. Per the v2 spec the attribute order is:
 *
 *   server, topic, priority, event_id, trust, source
 *
 * All values are XML-escaped. `correlation_id` was removed in v2; applications
 * that need correlation should encode it in the payload.
 *
 * When multiple events are concatenated, the caller typically passes a header
 * line; the canonical header is `"MCP events received since your last response:"`.
 */
export function formatMcpEvents(
  events: EventQueue.QueuedEvent[],
  header?: string,
  getServerTrust?: (serverName: string) => string,
): string {
  const body = events
    .map((e) => {
      const attrs = [
        `server="${escapeXmlAttr(e.server)}"`,
        `topic="${escapeXmlAttr(e.topic)}"`,
        `priority="${escapeXmlAttr(e.priority)}"`,
        `event_id="${escapeXmlAttr(e.event_id)}"`,
      ]
      if (getServerTrust) {
        attrs.push(`trust="${escapeXmlAttr(getServerTrust(e.server))}"`)
      }
      if (e.source) attrs.push(`source="${escapeXmlAttr(e.source)}"`)
      const rawPayload = typeof e.payload === "string" ? e.payload : (JSON.stringify(e.payload) ?? "")
      const payloadStr = escapeXmlContent(rawPayload)
      return `<mcp:event ${attrs.join(" ")}>\n${payloadStr}\n</mcp:event>`
    })
    .join("\n")
  // Use the canonical header when two or more events are concatenated.
  const useHeader = header ?? (events.length > 1 ? "MCP events received since your last response:" : undefined)
  return useHeader ? `${useHeader}\n\n${body}` : body
}
