import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("Session.Info.revert schema", () => {
  test("should accept mode field with valid values", () => {
    const validRevert = {
      messageID: "msg_123",
      mode: "full" as const,
    }
    const result = Session.Info.shape.revert.safeParse(validRevert)
    expect(result.success).toBe(true)
  })

  test("should accept mode 'conversation'", () => {
    const validRevert = {
      messageID: "msg_123",
      mode: "conversation" as const,
    }
    const result = Session.Info.shape.revert.safeParse(validRevert)
    expect(result.success).toBe(true)
  })

  test("should accept mode 'code'", () => {
    const validRevert = {
      messageID: "msg_123",
      mode: "code" as const,
    }
    const result = Session.Info.shape.revert.safeParse(validRevert)
    expect(result.success).toBe(true)
  })

  test("should reject invalid mode values", () => {
    const invalidRevert = {
      messageID: "msg_123",
      mode: "invalid",
    }
    const result = Session.Info.shape.revert.safeParse(invalidRevert)
    expect(result.success).toBe(false)
  })

  test("should accept revert without mode (backward compatibility)", () => {
    const revertWithoutMode = {
      messageID: "msg_123",
    }
    const result = Session.Info.shape.revert.safeParse(revertWithoutMode)
    expect(result.success).toBe(true)
  })
})

describe("SessionRevert.RevertInput schema", () => {
  test("should accept mode parameter", () => {
    const input = {
      sessionID: "session_123",
      messageID: "msg_123",
      mode: "conversation" as const,
    }
    const result = SessionRevert.RevertInput.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe("conversation")
    }
  })

  test("should default mode to 'full' when not provided", () => {
    const input = {
      sessionID: "session_123",
      messageID: "msg_123",
    }
    const result = SessionRevert.RevertInput.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe("full")
    }
  })
})

describe("SessionRevert.revert with modes", () => {
  test("mode 'full' should set mode in session.revert", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionID = session.id

        const userMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID,
          agent: "default",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg.id,
          sessionID,
          type: "text",
          text: "Hello",
        })

        await SessionRevert.revert({
          sessionID,
          messageID: userMsg.id,
          mode: "full",
        })

        const updated = await Session.get(sessionID)
        expect(updated.revert?.mode).toBe("full")

        await Session.remove(sessionID)
      },
    })
  })

  test("mode 'conversation' should set mode and skip snapshot operations", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionID = session.id

        const userMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID,
          agent: "default",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg.id,
          sessionID,
          type: "text",
          text: "Hello",
        })

        await SessionRevert.revert({
          sessionID,
          messageID: userMsg.id,
          mode: "conversation",
        })

        const updated = await Session.get(sessionID)
        expect(updated.revert?.mode).toBe("conversation")
        // Conversation mode should not have snapshot (no code revert)
        expect(updated.revert?.snapshot).toBeUndefined()

        await Session.remove(sessionID)
      },
    })
  })

  test("mode 'code' should set mode in session.revert", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionID = session.id

        const userMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID,
          agent: "default",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg.id,
          sessionID,
          type: "text",
          text: "Hello",
        })

        await SessionRevert.revert({
          sessionID,
          messageID: userMsg.id,
          mode: "code",
        })

        const updated = await Session.get(sessionID)
        expect(updated.revert?.mode).toBe("code")

        await Session.remove(sessionID)
      },
    })
  })
})

describe("SessionRevert.cleanup with modes", () => {
  test("cleanup should preserve messages when mode is 'code'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sessionID = session.id

        const userMsg1 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID,
          agent: "default",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg1.id,
          sessionID,
          type: "text",
          text: "Hello",
        })

        const userMsg2 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID,
          agent: "default",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        })

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg2.id,
          sessionID,
          type: "text",
          text: "World",
        })

        // Revert with code-only mode
        await SessionRevert.revert({
          sessionID,
          messageID: userMsg2.id,
          mode: "code",
        })

        let sessionInfo = await Session.get(sessionID)
        expect(sessionInfo.revert?.mode).toBe("code")

        // Cleanup should NOT remove messages in code-only mode
        await SessionRevert.cleanup(sessionInfo)

        const messages = await Session.messages({ sessionID })
        // Both messages should still exist
        expect(messages.length).toBe(2)

        await Session.remove(sessionID)
      },
    })
  })
})
