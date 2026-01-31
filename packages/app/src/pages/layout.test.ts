import { describe, expect, test } from "bun:test"

describe("layout session list virtualization", () => {
  test("LocalWorkspace uses virtualized list when flag enabled", async () => {
    const code = await Bun.file("src/pages/layout.tsx").text()
    expect(code).toContain("VirtualizedSessionList")
    expect(code).toContain("sessionListVirtualization")
  })

  test("SortableWorkspace uses virtualized list when flag enabled", async () => {
    const code = await Bun.file("src/pages/layout.tsx").text()
    // Count <VirtualizedSessionList usages (JSX component, not import)
    const matches = code.match(/<VirtualizedSessionList/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
