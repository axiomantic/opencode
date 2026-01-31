import { describe, expect, test } from "bun:test"

describe("Layout render optimizations", () => {
  test("uses findLast instead of slice().reverse().find()", async () => {
    const code = await Bun.file("src/pages/layout.tsx").text()
    // Should not contain the inefficient pattern
    expect(code).not.toContain(".slice().reverse().find(")
    // Should use findLast
    expect(code).toContain("findLast")
  })

  test("uses globalSync.sortedSessions for main workspace components", async () => {
    const code = await Bun.file("src/pages/layout.tsx").text()
    // Should use globalSync.sortedSessions
    expect(code).toContain("globalSync.sortedSessions")
  })
})
