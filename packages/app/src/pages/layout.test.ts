import { describe, expect, test } from "bun:test"

describe("Layout render optimizations", () => {
  test("uses findLast instead of slice().reverse().find()", async () => {
    const code = await Bun.file("src/pages/layout.tsx").text()
    // Should not contain the inefficient pattern
    expect(code).not.toContain(".slice().reverse().find(")
    // Should use findLast
    expect(code).toContain("findLast")
  })
})
