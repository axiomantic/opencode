import { describe, expect, test } from "bun:test"
import { createMcpBridge } from "../../src/plugin/mcp-bridge"
import { McpNotConnectedError } from "@opencode-ai/plugin"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("McpBridge", () => {
  describe("status", () => {
    test("returns object of server statuses", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createMcpBridge()
          const status = await bridge.status()

          expect(typeof status).toBe("object")
          // May be empty if no MCP servers configured
        },
      })
    })
  })

  describe("tools", () => {
    test("throws McpNotConnectedError for non-existent server", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createMcpBridge()

          await expect(bridge.tools("nonexistent-server-12345")).rejects.toThrow(McpNotConnectedError)
        },
      })
    })
  })

  describe("server management", () => {
    test("addServer does not throw for valid config", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createMcpBridge()

          // This will attempt to connect but may fail - we just verify it completes
          // In a real test environment, we'd mock the MCP module
          const result = await bridge.addServer("test-server", {
            type: "local",
            command: ["echo", "test"],
          })
          // Should resolve (may be undefined, that's ok)
          expect(result).toBeUndefined()
        },
      })
    })

    test("disconnect does not throw for unknown server", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createMcpBridge()

          // Should not throw even for unknown server
          const result = await bridge.disconnect("unknown-server")
          // Should resolve (may be undefined, that's ok)
          expect(result).toBeUndefined()
        },
      })
    })
  })
})
