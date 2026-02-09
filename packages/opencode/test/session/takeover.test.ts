import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { SessionOwnership, Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("SessionPrompt takeover detection", () => {
  describe("child session (has parentID)", () => {
    test("transfers ownership from agent to user when prompted", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create parent session first
          const parent = await Session.create({})

          // Create child session with parentID
          const child = await Session.create({ parentID: parent.id })

          // Verify child has parentID
          expect(child.parentID).toBe(parent.id)

          // Verify initial ownership is agent (default)
          expect(SessionOwnership.get(child.id)).toBe("agent")

          // Prompt the child session - this should trigger takeover detection
          // Using noReply: true to avoid needing a model configuration
          await SessionPrompt.prompt({
            sessionID: child.id,
            noReply: true,
            parts: [{ type: "text", text: "test message" }],
          })

          // Verify ownership was transferred to user
          expect(SessionOwnership.get(child.id)).toBe("user")
        },
      })
    }, 15000)
  })

  describe("root session (no parentID)", () => {
    test("does NOT transfer ownership when prompted", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create root session (no parentID)
          const root = await Session.create({})

          // Verify no parentID
          expect(root.parentID).toBeUndefined()

          // Verify initial ownership is agent (default)
          expect(SessionOwnership.get(root.id)).toBe("agent")

          // Prompt the root session
          // Using noReply: true to avoid needing a model configuration
          await SessionPrompt.prompt({
            sessionID: root.id,
            noReply: true,
            parts: [{ type: "text", text: "test message" }],
          })

          // Verify ownership was NOT transferred (still agent)
          expect(SessionOwnership.get(root.id)).toBe("agent")
        },
      })
    }, 15000)
  })
})
