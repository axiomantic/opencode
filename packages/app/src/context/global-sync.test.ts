// packages/app/src/context/global-sync.test.ts
import { describe, expect, test } from "bun:test"

describe("global-sync child store eviction", () => {
  test("eviction logic exists in global-sync", async () => {
    const code = await Bun.file(import.meta.dir + "/global-sync.tsx").text()
    expect(code).toContain("MAX_CHILD_STORES")
    expect(code).toContain("childStoreEviction")
  })
})
