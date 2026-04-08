import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"

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
      },
      priority?: string,
    ) => Effect.Effect<void>
    readonly drain: (
      sessionID: string,
      opts: { maxPriority: "urgent" | "high" | "normal" | "low" },
    ) => Effect.Effect<QueuedEvent[]>
    readonly pending: (sessionID: string) => Effect.Effect<number>
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
        },
        priority?: string,
      ) {
        return Effect.sync(() => {
          // Filter requested_effects by server permissions
          const allowedEffects = event.requested_effects?.filter((effect) => {
            if (!event.permissions) return true // no permissions = allow all (backward compat)
            return event.permissions[effect.type] === true
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

      return Service.of({ enqueue, drain, pending })
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

export function formatMcpEvents(
  events: EventQueue.QueuedEvent[],
  header?: string,
): string {
  const body = events
    .map(
      (e) =>
        `<mcp:event source="${escapeXmlAttr(e.server)}" topic="${escapeXmlAttr(e.topic)}" ` +
        `priority="${escapeXmlAttr(e.priority)}" event_id="${escapeXmlAttr(e.event_id)}">` +
        `\n${typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload)}` +
        `\n</mcp:event>`,
    )
    .join("\n")
  return header ? `${header}\n\n${body}` : body
}
