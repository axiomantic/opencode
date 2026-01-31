import { describe, expect, test } from "bun:test"

describe("Performance feature flags", () => {
  test("sessionListVirtualization flag is used in layout", async () => {
    const layoutCode = await Bun.file("src/pages/layout.tsx").text()

    // Verify flag is used
    expect(layoutCode).toContain("sessionListVirtualization")
    // Verify virtualized component is imported
    expect(layoutCode).toContain("VirtualizedSessionList")
    // Verify perfFlags is imported
    expect(layoutCode).toContain("perfFlags")
  })

  test("virtualized session list component exists", async () => {
    const exists = await Bun.file(
      "src/components/virtualized-session-list.tsx",
    ).exists()
    expect(exists).toBe(true)
  })

  test("virtualized session list uses virtua", async () => {
    const code = await Bun.file(
      "src/components/virtualized-session-list.tsx",
    ).text()
    expect(code).toContain("VList")
    expect(code).toContain("virtua/solid")
  })

  test("perf-flags utility exists with sessionListVirtualization", async () => {
    const code = await Bun.file("src/utils/perf-flags.ts").text()
    expect(code).toContain("sessionListVirtualization")
  })
})
