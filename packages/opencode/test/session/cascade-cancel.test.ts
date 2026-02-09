import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("cascade cancellation", () => {
  test("cancelling parent session cancels all descendants", async () => {
    await Instance.provide({
      directory: projectRoot,
      async fn() {
        // Create a session hierarchy: grandparent -> parent -> child
        const grandparent = await Session.create({})
        const parent = await Session.create({ parentID: grandparent.id })
        const child = await Session.create({ parentID: parent.id })

        // Simulate all sessions being busy by setting their status
        SessionStatus.set(grandparent.id, { type: "busy" })
        SessionStatus.set(parent.id, { type: "busy" })
        SessionStatus.set(child.id, { type: "busy" })

        // Verify they are busy before cancellation
        expect(SessionStatus.get(grandparent.id).type).toBe("busy")
        expect(SessionStatus.get(parent.id).type).toBe("busy")
        expect(SessionStatus.get(child.id).type).toBe("busy")

        // Cancel the grandparent - should cascade to all descendants
        await SessionPrompt.cancel(grandparent.id)

        // All sessions should now be idle
        expect(SessionStatus.get(grandparent.id).type).toBe("idle")
        expect(SessionStatus.get(parent.id).type).toBe("idle")
        expect(SessionStatus.get(child.id).type).toBe("idle")

        // Cleanup
        await Session.remove(child.id)
        await Session.remove(parent.id)
        await Session.remove(grandparent.id)
      },
    })
  })

  test("cancelling session with no children only cancels itself", async () => {
    await Instance.provide({
      directory: projectRoot,
      async fn() {
        const session = await Session.create({})

        // Simulate session being busy
        SessionStatus.set(session.id, { type: "busy" })
        expect(SessionStatus.get(session.id).type).toBe("busy")

        // Cancel the session
        await SessionPrompt.cancel(session.id)

        // Session should be idle
        expect(SessionStatus.get(session.id).type).toBe("idle")

        // Cleanup
        await Session.remove(session.id)
      },
    })
  })

  test("cancelling parent does not affect sibling sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      async fn() {
        // Create parent with two children (siblings)
        const parent = await Session.create({})
        const child1 = await Session.create({ parentID: parent.id })
        const child2 = await Session.create({ parentID: parent.id })

        // Simulate all sessions being busy
        SessionStatus.set(parent.id, { type: "busy" })
        SessionStatus.set(child1.id, { type: "busy" })
        SessionStatus.set(child2.id, { type: "busy" })

        // Cancel parent - should cascade to both children
        await SessionPrompt.cancel(parent.id)

        // All should be idle (parent and both children)
        expect(SessionStatus.get(parent.id).type).toBe("idle")
        expect(SessionStatus.get(child1.id).type).toBe("idle")
        expect(SessionStatus.get(child2.id).type).toBe("idle")

        // Cleanup
        await Session.remove(child1.id)
        await Session.remove(child2.id)
        await Session.remove(parent.id)
      },
    })
  })
})
