import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"

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
 * Resolve per-effect permissions for an event, merging per-topic overrides
 * on top of server-level defaults.
 */
export function resolvePermissionsForTopic(
  serverPerms: { inject_context: boolean; notify_user: boolean; trigger_turn: boolean },
  topic: string,
  topicOverrides?: Record<string, { inject_context?: boolean; notify_user?: boolean; trigger_turn?: boolean }>,
): { inject_context: boolean; notify_user: boolean; trigger_turn: boolean } {
  if (!topicOverrides) return serverPerms

  // Find the first matching topic pattern
  for (const [pattern, overrides] of Object.entries(topicOverrides)) {
    if (mqttTopicMatch(pattern, topic)) {
      return {
        inject_context: overrides.inject_context ?? serverPerms.inject_context,
        notify_user: overrides.notify_user ?? serverPerms.notify_user,
        trigger_turn: overrides.trigger_turn ?? serverPerms.trigger_turn,
      }
    }
  }

  return serverPerms
}

export namespace EventQueue {
  export interface QueuedEvent {
    server: string
    topic: string
    payload: unknown
    event_id: string
    priority: "low" | "normal" | "high" | "urgent"
    received_at: number
    ttl_ms: number
    retained?: boolean
    requested_effects?: Array<{
      type: "inject_context" | "notify_user" | "trigger_turn"
      priority?: "low" | "normal" | "high" | "urgent"
    }>
    source?: string
    correlation_id?: string
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

  export interface Interface {
    readonly enqueue: (
      sessionID: string,
      event: {
        server: string
        topic: string
        payload: unknown
        event_id: string
        retained?: boolean
        requested_effects?: QueuedEvent["requested_effects"]
        permissions?: {
          inject_context: boolean
          notify_user: boolean
          trigger_turn: boolean
        }
        topicOverrides?: Record<string, { inject_context?: boolean; notify_user?: boolean; trigger_turn?: boolean }>
        source?: string
        correlation_id?: string
        expires_at?: string
      },
      priority?: string,
    ) => Effect.Effect<void>
    readonly drain: (
      sessionID: string,
      opts: { maxPriority: "urgent" | "high" | "normal" | "low" },
    ) => Effect.Effect<QueuedEvent[]>
    readonly pending: (sessionID: string) => Effect.Effect<number>
    readonly clear: (sessionID: string) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()(
    "@opencode/EventQueue",
  ) {}

  export const layer: Layer.Layer<Service, never, Bus.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const queues = new Map<string, QueuedEvent[]>()

      function getQueue(sessionID: string): QueuedEvent[] {
        let q = queues.get(sessionID)
        if (!q) {
          q = []
          queues.set(sessionID, q)
        }
        return q
      }

      function enqueue(
        sessionID: string,
        event: {
          server: string
          topic: string
          payload: unknown
          event_id: string
          retained?: boolean
          requested_effects?: QueuedEvent["requested_effects"]
          permissions?: {
            inject_context: boolean
            notify_user: boolean
            trigger_turn: boolean
          }
          topicOverrides?: Record<string, { inject_context?: boolean; notify_user?: boolean; trigger_turn?: boolean }>
          source?: string
          correlation_id?: string
          expires_at?: string
        },
        priority?: string,
      ) {
        return Effect.sync(() => {
          // Resolve effective permissions: per-topic overrides merged on top of server defaults
          const effectivePermissions = event.permissions
            ? resolvePermissionsForTopic(event.permissions, event.topic, event.topicOverrides)
            : undefined

          // Filter requested_effects by effective permissions
          const allowedEffects = event.requested_effects?.filter((effect) => {
            if (!effectivePermissions) return true // no permissions = allow all (backward compat)
            return effectivePermissions[effect.type] === true
          }) ?? []

          // If event requested effects but all were filtered out, skip enqueue
          if (event.requested_effects?.length && allowedEffects.length === 0) {
            return // silently drop
          }

          const filteredEffects = allowedEffects.length > 0 ? allowedEffects : undefined

          // Infer priority from the MOST URGENT effect, not just the first one
          const inferredPriority = filteredEffects?.reduce((best, eff) => {
            const effPri = eff.priority ?? "normal"
            return (PRIORITY_ORDER[effPri] ?? 2) < (PRIORITY_ORDER[best] ?? 2) ? effPri : best
          }, "normal" as string) ?? "normal"
          const raw = priority ?? inferredPriority
          const p = (PRIORITY_ORDER[raw] !== undefined ? raw : "normal") as QueuedEvent["priority"]
          const q = getQueue(sessionID)
          q.push({
            server: event.server,
            topic: event.topic,
            payload: event.payload,
            event_id: event.event_id,
            retained: event.retained,
            requested_effects: filteredEffects,
            source: event.source,
            correlation_id: event.correlation_id,
            expires_at: event.expires_at,
            priority: p,
            received_at: Date.now(),
            ttl_ms: TTL_DEFAULTS[p] ?? TTL_DEFAULTS.normal,
          })
        })
      }

      function drain(
        sessionID: string,
        opts: { maxPriority: "urgent" | "high" | "normal" | "low" },
      ) {
        return Effect.sync(() => {
          const q = getQueue(sessionID)
          const now = Date.now()
          const maxOrd = PRIORITY_ORDER[opts.maxPriority]
          const result: QueuedEvent[] = []
          const remaining: QueuedEvent[] = []

          for (const event of q) {
            if (now > event.received_at + event.ttl_ms) continue // expired
            if (PRIORITY_ORDER[event.priority] <= maxOrd) {
              result.push(event)
            } else {
              remaining.push(event)
            }
          }
          queues.set(sessionID, remaining)
          // Sort by priority (urgent first)
          result.sort(
            (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
          )
          return result
        })
      }

      function pending(sessionID: string) {
        return Effect.sync(() => getQueue(sessionID).length)
      }

      function clear(sessionID: string) {
        return Effect.sync(() => {
          queues.delete(sessionID)
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
}

function escapeXmlContent(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;")
}

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
      if (e.correlation_id) attrs.push(`correlation_id="${escapeXmlAttr(e.correlation_id)}"`)
      const rawPayload = typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload)
      const payloadStr = escapeXmlContent(rawPayload)
      return `<mcp:event ${attrs.join(" ")}>\n${payloadStr}\n</mcp:event>`
    })
    .join("\n")
  return header ? `${header}\n\n${body}` : body
}
