import { describe, expect, test } from "bun:test"

describe("Session page scroll-spy integration", () => {
  test("imports scroll-spy module", async () => {
    const code = await Bun.file("src/pages/session.tsx").text()
    expect(code).toContain("createScrollSpy")
    expect(code).toContain("scrollSpyOptimized")
  })

  test("querySelectorAll is conditional on flag", async () => {
    const code = await Bun.file("src/pages/session.tsx").text()
    // The getActiveMessageId function should check for scrollSpy
    expect(code).toContain("if (scrollSpy)")
    expect(code).toContain("scrollSpy.activeId()")
  })
})
