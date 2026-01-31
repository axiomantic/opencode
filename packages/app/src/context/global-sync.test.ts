import { describe, expect, test } from "bun:test"

describe("global-sync render optimizations", () => {
  test("exposes sortedSessions memo", async () => {
    const code = await Bun.file("src/context/global-sync.tsx").text()
    expect(code).toContain("sortedSessions")
  })
})
