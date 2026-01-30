import { describe, expect, test, afterEach } from "bun:test"
import { Auth } from "../../src/auth"

// Track auth entries created during tests for cleanup
const createdAuthKeys: string[] = []

afterEach(async () => {
  // Clean up any auth entries created during tests
  for (const key of createdAuthKeys) {
    await Auth.remove(key)
  }
  createdAuthKeys.length = 0
})

async function setTestAuth(key: string, info: Auth.Info) {
  createdAuthKeys.push(key)
  await Auth.set(key, info)
}

describe("Auth.resolve", () => {
  test("returns direct auth when provider has own credentials", async () => {
    await setTestAuth("test-anthropic", { type: "api", key: "test-key-123" })

    const auth = await Auth.resolve("test-anthropic", {
      provider: {
        "test-anthropic": {},
      },
    })

    expect(auth).toBeDefined()
    expect(auth?.type).toBe("api")
    expect((auth as Auth.Info & { type: "api" }).key).toBe("test-key-123")
  })

  test("walks extends chain to find parent auth", async () => {
    // Only the parent has auth credentials
    await setTestAuth("test-parent", { type: "api", key: "parent-key-456" })

    const auth = await Auth.resolve("test-child", {
      provider: {
        "test-child": { extends: "test-parent" },
        "test-parent": {},
      },
    })

    expect(auth).toBeDefined()
    expect(auth?.type).toBe("api")
    expect((auth as Auth.Info & { type: "api" }).key).toBe("parent-key-456")
  })

  test("returns undefined when no auth in chain", async () => {
    const auth = await Auth.resolve("nonexistent-provider", {
      provider: {},
    })
    expect(auth).toBeUndefined()
  })

  test("handles circular extends gracefully via max depth", async () => {
    // provider-a extends provider-b, provider-b extends provider-a
    // Neither has auth, so it should hit max depth and return undefined
    const auth = await Auth.resolve("circular-a", {
      provider: {
        "circular-a": { extends: "circular-b" },
        "circular-b": { extends: "circular-a" },
      },
    })
    expect(auth).toBeUndefined()
  })

  test("handles missing extends field", async () => {
    const auth = await Auth.resolve("standalone-provider", {
      provider: {
        "standalone-provider": {}, // No extends field, no auth
      },
    })
    expect(auth).toBeUndefined()
  })

  test("stops at first auth found in chain", async () => {
    // Both child and parent have auth, should return child's auth
    await setTestAuth("test-child-with-auth", { type: "api", key: "child-key" })
    await setTestAuth("test-parent-with-auth", { type: "api", key: "parent-key" })

    const auth = await Auth.resolve("test-child-with-auth", {
      provider: {
        "test-child-with-auth": { extends: "test-parent-with-auth" },
        "test-parent-with-auth": {},
      },
    })

    expect(auth).toBeDefined()
    expect((auth as Auth.Info & { type: "api" }).key).toBe("child-key")
  })

  test("walks multiple levels of extends chain", async () => {
    // grandchild -> child -> parent (only parent has auth)
    await setTestAuth("test-grandparent", { type: "api", key: "grandparent-key" })

    const auth = await Auth.resolve("test-grandchild", {
      provider: {
        "test-grandchild": { extends: "test-child-middle" },
        "test-child-middle": { extends: "test-grandparent" },
        "test-grandparent": {},
      },
    })

    expect(auth).toBeDefined()
    expect((auth as Auth.Info & { type: "api" }).key).toBe("grandparent-key")
  })
})
