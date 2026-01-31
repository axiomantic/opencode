import { describe, expect, test } from "bun:test"

describe("VirtualizedSessionList", () => {
  test("component exports VirtualizedSessionList", async () => {
    const code = await Bun.file(
      "src/components/virtualized-session-list.tsx",
    ).text()
    expect(code).toContain("export function VirtualizedSessionList")
    expect(code).toContain("VList")
    expect(code).toContain("virtua/solid")
  })

  test("component accepts sessions and renderSession props", async () => {
    const code = await Bun.file(
      "src/components/virtualized-session-list.tsx",
    ).text()
    expect(code).toContain("sessions:")
    expect(code).toContain("renderSession:")
    expect(code).toContain("overscan")
  })
})
