import { describe, expect, test } from "bun:test"

describe("Session page scroll-spy integration", () => {
  test("imports scroll-spy module", async () => {
    const code = await Bun.file("src/pages/session.tsx").text()
    expect(code).toContain("createScrollSpy")
    expect(code).toContain("scrollSpyOptimized")
  })
})
