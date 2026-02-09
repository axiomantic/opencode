import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import z from "zod"

export namespace SessionOwnership {
  // Constants
  export const OWNERSHIP_TIMEOUT_MS = 30 * 60 * 1000
  export const MAX_ANCESTRY_DEPTH_WARNING = 10

  // Owner enum
  export const Owner = z.enum(["agent", "user"]).meta({ ref: "SessionOwner" })
  export type Owner = z.infer<typeof Owner>

  // Info schema
  export const Info = z
    .object({
      sessionID: z.string(),
      owner: Owner,
      transferredAt: z.number().optional(),
      previousOwner: Owner.optional(),
    })
    .meta({ ref: "SessionOwnershipInfo" })
  export type Info = z.infer<typeof Info>

  // Events
  export const Event = {
    Changed: BusEvent.define(
      "session.ownership.changed",
      z.object({
        sessionID: z.string(),
        owner: Owner,
        previousOwner: Owner,
        transferredAt: z.number(),
      }),
    ),
    SignalComplete: BusEvent.define(
      "session.ownership.signal",
      z.object({
        sessionID: z.string(),
        signal: z.string(),
      }),
    ),
  }

  // In-memory state
  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  // Get owner for a session (defaults to "agent")
  export function get(sessionID: string): Owner {
    return state()[sessionID]?.owner ?? "agent"
  }

  // Get full Info for a session
  export function getInfo(sessionID: string): Info {
    const existing = state()[sessionID]
    if (existing) return existing
    return {
      sessionID,
      owner: "agent",
      previousOwner: undefined,
      transferredAt: undefined,
    }
  }

  // Transfer ownership (idempotent - no event if same owner)
  export function transfer(sessionID: string, newOwner: Owner): void {
    const currentOwner = get(sessionID)
    if (currentOwner === newOwner) return

    const now = Date.now()
    const info: Info = {
      sessionID,
      owner: newOwner,
      previousOwner: currentOwner,
      transferredAt: now,
    }
    state()[sessionID] = info

    Bus.publish(Event.Changed, {
      sessionID,
      owner: newOwner,
      previousOwner: currentOwner,
      transferredAt: now,
    })
  }

  // Signal completion
  export function signal(sessionID: string, signalType: string): void {
    Bus.publish(Event.SignalComplete, {
      sessionID,
      signal: signalType,
    })
  }

  // List all ownership states
  export function list(): Info[] {
    return Object.values(state())
  }
}
