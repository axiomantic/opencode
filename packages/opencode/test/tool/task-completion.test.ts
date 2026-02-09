import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { SessionOwnership } from "../../src/session/ownership"
import { waitForUserSignal, CompletionStatus } from "../../src/tool/task"

describe("task.completion", () => {
  test("waitForUserSignal function exists and is exported", async () => {
    expect(typeof waitForUserSignal).toBe("function")
  })

  test("CompletionStatus enum exists with correct values", async () => {
    expect(CompletionStatus).toBeDefined()
    expect(CompletionStatus.options).toEqual(["complete", "interrupted", "takeover"])
  })

  test("waitForUserSignal resolves when SignalComplete event is received", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "test-session-123"
        let resolved = false

        const promise = waitForUserSignal(sessionID).then(() => {
          resolved = true
        })

        // Should not be resolved yet
        expect(resolved).toBe(false)

        // Publish the signal
        Bus.publish(SessionOwnership.Event.SignalComplete, {
          sessionID,
          signal: "complete",
        })

        // Wait for promise to resolve
        await promise

        expect(resolved).toBe(true)
      },
    })
  })

  test("waitForUserSignal ignores signals for other sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "test-session-456"
        let resolved = false

        const promise = waitForUserSignal(sessionID).then(() => {
          resolved = true
        })

        // Publish signal for different session
        Bus.publish(SessionOwnership.Event.SignalComplete, {
          sessionID: "other-session",
          signal: "complete",
        })

        // Give it a tick to process
        await new Promise((r) => setTimeout(r, 10))

        // Should still not be resolved
        expect(resolved).toBe(false)

        // Now publish for correct session
        Bus.publish(SessionOwnership.Event.SignalComplete, {
          sessionID,
          signal: "complete",
        })

        await promise
        expect(resolved).toBe(true)
      },
    })
  })
})
