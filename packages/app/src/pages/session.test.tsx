import { describe, expect, test } from "bun:test"

describe("Session page render optimizations", () => {
  test("constant classes object is hoisted", async () => {
    const code = await Bun.file("src/pages/session.tsx").text()
    expect(code).toContain("SESSION_TURN_CLASSES")
  })
})
