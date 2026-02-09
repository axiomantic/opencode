import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { SessionOwnership } from "../../src/session/ownership"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("SessionOwnership", () => {
  describe("get", () => {
    test("defaults to agent for unknown session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const owner = SessionOwnership.get("session_unknown")
          expect(owner).toBe("agent")
        },
      })
    })
  })

  describe("transfer", () => {
    test("changes owner and emits Changed event", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const events: Array<{
            sessionID: string
            owner: string
            previousOwner: string
          }> = []

          const unsub = Bus.subscribe(SessionOwnership.Event.Changed, (event) => {
            events.push({
              sessionID: event.properties.sessionID,
              owner: event.properties.owner,
              previousOwner: event.properties.previousOwner,
            })
          })

          SessionOwnership.transfer("session_456", "user")

          expect(events).toHaveLength(1)
          expect(events[0].sessionID).toBe("session_456")
          expect(events[0].owner).toBe("user")
          expect(events[0].previousOwner).toBe("agent")

          const owner = SessionOwnership.get("session_456")
          expect(owner).toBe("user")

          unsub()
        },
      })
    })

    test("is idempotent - same owner does not emit event", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const events: unknown[] = []

          // First transfer to user
          SessionOwnership.transfer("session_idempotent", "user")

          const unsub = Bus.subscribe(SessionOwnership.Event.Changed, (event) => {
            events.push(event)
          })

          // Second transfer to same owner should not emit
          SessionOwnership.transfer("session_idempotent", "user")

          expect(events).toHaveLength(0)

          unsub()
        },
      })
    })
  })

  describe("signal", () => {
    test("emits SignalComplete event", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const events: Array<{ sessionID: string; signal: string }> = []

          const unsub = Bus.subscribe(SessionOwnership.Event.SignalComplete, (event) => {
            events.push({
              sessionID: event.properties.sessionID,
              signal: event.properties.signal,
            })
          })

          SessionOwnership.signal("session_abc", "complete")

          expect(events).toHaveLength(1)
          expect(events[0].sessionID).toBe("session_abc")
          expect(events[0].signal).toBe("complete")

          unsub()
        },
      })
    })
  })

  describe("list", () => {
    test("returns all ownership states", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          // Set up some ownership states
          SessionOwnership.transfer("session_list_1", "user")
          // Transfer to user first, then back to agent to create a state entry
          SessionOwnership.transfer("session_list_2", "user")
          SessionOwnership.transfer("session_list_2", "agent")

          const states = SessionOwnership.list()

          // Should include at least the sessions we just set
          const session1 = states.find((s) => s.sessionID === "session_list_1")
          const session2 = states.find((s) => s.sessionID === "session_list_2")

          expect(session1).toBeDefined()
          expect(session1!.owner).toBe("user")

          expect(session2).toBeDefined()
          expect(session2!.owner).toBe("agent")
        },
      })
    })
  })

  describe("getInfo", () => {
    test("returns full Info object with metadata", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          SessionOwnership.transfer("session_info", "user")

          const info = SessionOwnership.getInfo("session_info")

          expect(info.sessionID).toBe("session_info")
          expect(info.owner).toBe("user")
          expect(info.previousOwner).toBe("agent")
          expect(typeof info.transferredAt).toBe("number")
        },
      })
    })

    test("returns default Info for unknown session", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const info = SessionOwnership.getInfo("session_never_seen")

          expect(info.sessionID).toBe("session_never_seen")
          expect(info.owner).toBe("agent")
          expect(info.previousOwner).toBeUndefined()
          expect(info.transferredAt).toBeUndefined()
        },
      })
    })
  })

  describe("constants", () => {
    test("exports OWNERSHIP_TIMEOUT_MS", () => {
      expect(SessionOwnership.OWNERSHIP_TIMEOUT_MS).toBe(30 * 60 * 1000)
    })

    test("exports MAX_ANCESTRY_DEPTH_WARNING", () => {
      expect(SessionOwnership.MAX_ANCESTRY_DEPTH_WARNING).toBe(10)
    })
  })
})
