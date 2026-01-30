import { describe, expect, test } from "bun:test"
import { createToolsBridge } from "../../src/plugin/tools-bridge"
import { ToolPermissionError } from "@opencode-ai/plugin"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("ToolsBridge", () => {
  describe("permissions", () => {
    test("denies tool in deny list", async () => {
      const bridge = createToolsBridge({
        pluginName: "test-plugin",
        permissions: {
          tools: {
            deny: ["bash", "write"],
          },
        },
      })

      await expect(bridge.call("bash", { command: "ls" })).rejects.toThrow(ToolPermissionError)
    })

    test("allows tool not in deny list", async () => {
      const bridge = createToolsBridge({
        pluginName: "test-plugin",
        permissions: {
          tools: {
            deny: ["bash"],
          },
        },
      })

      // This will throw ToolNotFoundError in test env (no actual tools), not PermissionError
      const result = bridge.call("read", { filePath: "/tmp/test" })
      await expect(result).rejects.not.toThrow(ToolPermissionError)
    })

    test("allow list acts as whitelist", async () => {
      const bridge = createToolsBridge({
        pluginName: "test-plugin",
        permissions: {
          tools: {
            allow: ["read", "glob"],
          },
        },
      })

      // bash not in allow list - should be denied
      await expect(bridge.call("bash", { command: "ls" })).rejects.toThrow(ToolPermissionError)
    })

    test("skipPermissions bypasses checks", async () => {
      const bridge = createToolsBridge({
        pluginName: "test-plugin",
        permissions: {
          tools: {
            deny: ["bash"],
          },
        },
      })

      // With skipPermissions, should not throw PermissionError (may throw ToolNotFoundError)
      const result = bridge.call("bash", { command: "ls" }, { skipPermissions: true })
      await expect(result).rejects.not.toThrow(ToolPermissionError)
    })
  })

  describe("list and has", () => {
    test("list returns array of tools", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createToolsBridge({ pluginName: "test-plugin" })
          const tools = await bridge.list()

          expect(Array.isArray(tools)).toBe(true)
          // Should have some built-in tools
          expect(tools.length).toBeGreaterThan(0)
        },
      })
    })

    test("has returns true for existing tool", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createToolsBridge({ pluginName: "test-plugin" })

          // read is a built-in tool
          const hasRead = await bridge.has("read")
          expect(hasRead).toBe(true)
        },
      })
    })

    test("has returns false for non-existent tool", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createToolsBridge({ pluginName: "test-plugin" })

          const hasNonexistent = await bridge.has("this-tool-does-not-exist-12345")
          expect(hasNonexistent).toBe(false)
        },
      })
    })
  })

  describe("tool info", () => {
    test("list includes tool metadata", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bridge = createToolsBridge({ pluginName: "test-plugin" })
          const tools = await bridge.list()

          const readTool = tools.find((t) => t.id === "read")
          expect(readTool).toBeDefined()
          expect(readTool?.source).toBe("builtin")
          expect(readTool?.description).toBeDefined()
        },
      })
    })
  })
})
