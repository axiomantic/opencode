import { describe, expect, test } from "bun:test";

describe("Session page", () => {
  test("session cleanup effect exists", async () => {
    const code = await Bun.file(import.meta.dir + "/session.tsx").text();
    expect(code).toContain("cleanupSessionCaches");
    expect(code).toContain("sessionCleanup");
    expect(code).toContain("30000"); // 30 second grace period
  });
});
