import { describe, expect, test } from "bun:test"
import { createLruCache } from "./cache"

describe("createLruCache", () => {
  test("evicts least recently used when at capacity", () => {
    const cache = createLruCache<string>({ maxEntries: 3 })

    cache.set("a", "value-a")
    cache.set("b", "value-b")
    cache.set("c", "value-c")

    expect(cache.get("a")).toBe("value-a")
    expect(cache.get("b")).toBe("value-b")
    expect(cache.get("c")).toBe("value-c")

    // Access 'a' to make it recently used
    cache.get("a")

    // Add 'd', should evict 'b' (least recently used)
    cache.set("d", "value-d")

    expect(cache.get("a")).toBe("value-a")
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("c")).toBe("value-c")
    expect(cache.get("d")).toBe("value-d")
  })

  test("respects TTL expiration", async () => {
    const cache = createLruCache<string>({ maxEntries: 10, ttlMs: 50 })

    cache.set("key", "value")
    expect(cache.get("key")).toBe("value")

    await new Promise((r) => setTimeout(r, 60))

    expect(cache.get("key")).toBeUndefined()
  })

  test("calls onEvict callback", () => {
    const evicted: string[] = []
    const cache = createLruCache<string>({
      maxEntries: 2,
      onEvict: (key, value) => evicted.push(`${key}:${value}`),
    })

    cache.set("a", "1")
    cache.set("b", "2")
    cache.set("c", "3") // evicts 'a'

    expect(evicted).toEqual(["a:1"])
  })

  test("delete removes entry and calls onEvict", () => {
    const evicted: string[] = []
    const cache = createLruCache<string>({
      maxEntries: 10,
      onEvict: (key) => evicted.push(key),
    })

    cache.set("a", "1")
    cache.delete("a")

    expect(cache.get("a")).toBeUndefined()
    expect(evicted).toEqual(["a"])
  })

  test("clear removes all entries", () => {
    const cache = createLruCache<string>({ maxEntries: 10 })

    cache.set("a", "1")
    cache.set("b", "2")
    cache.clear()

    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("b")).toBeUndefined()
    expect(cache.stats().size).toBe(0)
  })

  test("stats returns current size and eviction count", () => {
    const cache = createLruCache<string>({ maxEntries: 2 })

    cache.set("a", "1")
    cache.set("b", "2")
    expect(cache.stats()).toEqual({ size: 2, evictions: 0 })

    cache.set("c", "3")
    expect(cache.stats()).toEqual({ size: 2, evictions: 1 })
  })
})
