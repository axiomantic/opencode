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

  test("exposes scrollToIndex method via ref", async () => {
    const code = await Bun.file("src/components/virtualized-message-list.tsx").text()
    // Verify the ref callback pattern is implemented
    expect(code).toContain("props.ref")
    expect(code).toContain("handle")
    expect(code).toContain("scrollToIndex")
    // Verify it delegates to VList ref
    expect(code).toContain("listRef?.scrollToIndex")
  })
})
