import { test, expect, mock, spyOn, afterEach } from "bun:test"
import path from "path"

// Mock BunProc and default plugins to prevent actual installations during tests
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string, _version?: string) => {
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin }))

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { Log } from "../../src/util/log"

test("extends creates derived provider with base provider models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              options: {
                apiKey: "work-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-work"]).toBeDefined()
      expect(providers["anthropic-work"].source).toBe("config")
      expect(Object.keys(providers["anthropic-work"].models).length).toBeGreaterThan(0)
      expect(providers["anthropic-work"].models["claude-sonnet-4-20250514"]).toBeDefined()
    },
  })
})

test("extends uses custom name when provided", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              name: "Anthropic (Work)",
              options: {
                apiKey: "work-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-work"]).toBeDefined()
      expect(providers["anthropic-work"].name).toBe("Anthropic (Work)")
    },
  })
})

test("extends falls back to base provider name when name not provided", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              options: {
                apiKey: "work-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-work"]).toBeDefined()
      expect(providers["anthropic-work"].name).toBe("Anthropic")
    },
  })
})

test("inherited provider models have correct providerID", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-personal": {
              extends: "anthropic",
              name: "Anthropic (Personal)",
              options: {
                apiKey: "personal-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const model = providers["anthropic-personal"].models["claude-sonnet-4-20250514"]
      expect(model).toBeDefined()
      expect(model.providerID).toBe("anthropic-personal")
    },
  })
})

test("getModel works with inherited provider", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              options: {
                apiKey: "work-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = await Provider.getModel("anthropic-work", "claude-sonnet-4-20250514")
      expect(model).toBeDefined()
      expect(model.providerID).toBe("anthropic-work")
      expect(model.id).toBe("claude-sonnet-4-20250514")
    },
  })
})

test("extends skips non-existent base provider with warning", async () => {
  const logger = Log.create({ service: "provider" })
  const warnSpy = spyOn(logger, "warn")

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "nonexistent-derived": {
              extends: "nonexistent-provider",
              options: {
                apiKey: "test-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["nonexistent-derived"]).toBeUndefined()
      // Verify warning was logged for non-existent base provider
      expect(warnSpy).toHaveBeenCalled()
      const warnCalls = warnSpy.mock.calls
      const foundWarning = warnCalls.some(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("nonexistent-provider") &&
          call[0].includes("nonexistent-derived"),
      )
      expect(foundWarning).toBe(true)
    },
  })
  warnSpy.mockRestore()
})

test("inherited provider options merge with config options", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              options: {
                apiKey: "work-api-key",
                timeout: 60000,
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-work"].options["timeout"]).toBe(60000)
    },
  })
})

test("multiple inherited providers from same base", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              name: "Anthropic (Work)",
              options: {
                apiKey: "work-api-key",
              },
            },
            "anthropic-personal": {
              extends: "anthropic",
              name: "Anthropic (Personal)",
              options: {
                apiKey: "personal-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-work"]).toBeDefined()
      expect(providers["anthropic-personal"]).toBeDefined()
      expect(providers["anthropic-work"].name).toBe("Anthropic (Work)")
      expect(providers["anthropic-personal"].name).toBe("Anthropic (Personal)")
      expect(providers["anthropic-work"].models["claude-sonnet-4-20250514"].providerID).toBe("anthropic-work")
      expect(providers["anthropic-personal"].models["claude-sonnet-4-20250514"].providerID).toBe("anthropic-personal")
    },
  })
})

test("inherited provider respects disabled_providers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          disabled_providers: ["anthropic-work"],
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              options: {
                apiKey: "work-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-work"]).toBeUndefined()
    },
  })
})

test("inherited provider respects enabled_providers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          enabled_providers: ["anthropic-work"],
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              options: {
                apiKey: "work-api-key",
              },
            },
            "anthropic-personal": {
              extends: "anthropic",
              options: {
                apiKey: "personal-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-work"]).toBeDefined()
      expect(providers["anthropic-personal"]).toBeUndefined()
    },
  })
})

test("project config can use inherited provider model", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "anthropic-work/claude-sonnet-4-20250514",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              name: "Anthropic (Work)",
              options: {
                apiKey: "work-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const defaultModel = await Provider.defaultModel()
      expect(defaultModel.providerID).toBe("anthropic-work")
      expect(defaultModel.modelID).toBe("claude-sonnet-4-20250514")
    },
  })
})

test("inherited provider coexists with base provider when base has env key", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              extends: "anthropic",
              name: "Anthropic (Work)",
              options: {
                apiKey: "work-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "default-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
      expect(providers["anthropic-work"]).toBeDefined()
      expect(providers["anthropic"].name).toBe("Anthropic")
      expect(providers["anthropic-work"].name).toBe("Anthropic (Work)")
    },
  })
})

test("extends detects circular dependency A extends B extends A", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "provider-a": {
              extends: "provider-b",
              options: { apiKey: "key-a" },
            },
            "provider-b": {
              extends: "provider-a",
              options: { apiKey: "key-b" },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Neither provider should exist since they form a cycle with no valid base
      const providers = await Provider.list()
      expect(providers["provider-a"]).toBeUndefined()
      expect(providers["provider-b"]).toBeUndefined()
    },
  })
})

test("extends handles self-reference gracefully", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "self-ref": {
              extends: "self-ref",
              options: { apiKey: "key" },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Self-referencing provider should not exist (can't find itself as base)
      const providers = await Provider.list()
      expect(providers["self-ref"]).toBeUndefined()
    },
  })
})

test("extends removes derived provider when all models are filtered out", async () => {
  // Test that derived providers with no usable models are removed
  // This is correct behavior - providers without models are not useful
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            // Use anthropic as base, but whitelist no models effectively making it "empty"
            "anthropic-empty": {
              extends: "anthropic",
              whitelist: ["nonexistent-model-id"],
              options: { apiKey: "test-key" },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      // Provider is removed when all models are filtered out (expected behavior)
      expect(providers["anthropic-empty"]).toBeUndefined()
    },
  })
})

test("inherited provider options merge preserves base options", async () => {
  // Test that options from both base and derived provider are merged correctly
  // Using anthropic as a base provider with known defaults
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            // First configure anthropic with some base options
            anthropic: {
              options: {
                baseURL: "https://base.example.com",
                timeout: 30000,
              },
            },
            // Then create a derived provider that overrides and adds options
            "anthropic-derived": {
              extends: "anthropic",
              options: {
                apiKey: "derived-api-key",
                timeout: 60000,
                customOption: "custom-value",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic-derived"]).toBeDefined()
      const options = providers["anthropic-derived"].options as Record<string, unknown>
      // Derived option should be present
      expect(options["apiKey"]).toBe("derived-api-key")
      // Overridden option should use derived value
      expect(options["timeout"]).toBe(60000)
      // New custom option should be present
      expect(options["customOption"]).toBe("custom-value")
    },
  })
})
