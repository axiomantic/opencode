import { describe, expect, test } from "bun:test"

describe("layout session list virtualization", () => {
  test("LocalWorkspace uses virtualized list when flag enabled", async () => {
    const code = await Bun.file("src/pages/layout.tsx").text()
    expect(code).toContain("VirtualizedSessionList")
    expect(code).toContain("sessionListVirtualization")
  })
})
