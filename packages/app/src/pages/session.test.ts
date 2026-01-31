import { describe, expect, test } from "bun:test"

describe("Session page virtualization", () => {
  test("uses virtualized list when flag enabled", async () => {
    const code = await Bun.file("src/pages/session.tsx").text()
    expect(code).toContain("VirtualizedMessageList")
    expect(code).toContain("messageVirtualization")
  })
})
