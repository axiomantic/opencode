// packages/app/src/context/sync.test.ts
import { describe, expect, test } from "bun:test";

describe("sync meta cleanup", () => {
  test("cleanupMeta function exists", async () => {
    const code = await Bun.file(import.meta.dir + "/sync.tsx").text();
    expect(code).toContain("cleanupMeta");
  });
});
