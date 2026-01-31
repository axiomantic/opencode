import { describe, expect, test } from "bun:test"

describe("VirtualizedMessageList", () => {
  test("component file exists and exports correctly", async () => {
    const code = await Bun.file("src/components/virtualized-message-list.tsx").text()
    expect(code).toContain("export function VirtualizedMessageList")
    expect(code).toContain("VirtualizedMessageListHandle")
    expect(code).toContain("scrollToIndex")
    expect(code).toContain("VList")
    expect(code).toContain('from "virtua/solid"')
  })
})
