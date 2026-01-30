import { test, expect, mock } from "bun:test"
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

test("inherit creates derived provider with base provider models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              inherit: "anthropic",
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

test("inherit uses custom name when provided", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              inherit: "anthropic",
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

test("inherit falls back to base provider name when name not provided", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "anthropic-work": {
              inherit: "anthropic",
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
              inherit: "anthropic",
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
              inherit: "anthropic",
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

test("inherit skips non-existent base provider with warning", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            "nonexistent-derived": {
              inherit: "nonexistent-provider",
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
    },
  })
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
              inherit: "anthropic",
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
              inherit: "anthropic",
              name: "Anthropic (Work)",
              options: {
                apiKey: "work-api-key",
              },
            },
            "anthropic-personal": {
              inherit: "anthropic",
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
              inherit: "anthropic",
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
              inherit: "anthropic",
              options: {
                apiKey: "work-api-key",
              },
            },
            "anthropic-personal": {
              inherit: "anthropic",
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
              inherit: "anthropic",
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
              inherit: "anthropic",
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
