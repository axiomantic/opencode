// packages/app/src/pages/layout.test.ts
import { describe, expect, test } from "bun:test";

describe("layout prefetch cleanup", () => {
  test("prefetch cleanup exists", async () => {
    const code = await Bun.file(import.meta.dir + "/layout.tsx").text();
    expect(code).toContain("cleanupPrefetch");
  });
});
