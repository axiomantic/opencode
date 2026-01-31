type CacheEntry<T> = {
  value: T
  expiresAt: number | undefined
}

type CacheOpts<T> = {
  maxEntries: number
  ttlMs?: number
  onEvict?: (key: string, value: T) => void
}

export function createLruCache<T>(opts: CacheOpts<T>) {
  const entries = new Map<string, CacheEntry<T>>()
  const order: string[] = []
  let evictions = 0

  const touch = (key: string) => {
    const idx = order.indexOf(key)
    if (idx > -1) order.splice(idx, 1)
    order.push(key)
  }

  const evictOldest = () => {
    const oldest = order.shift()
    if (!oldest) return
    const entry = entries.get(oldest)
    entries.delete(oldest)
    evictions++
    if (entry && opts.onEvict) opts.onEvict(oldest, entry.value)
  }

  const isExpired = (entry: CacheEntry<T>) => {
    if (!entry.expiresAt) return false
    return Date.now() > entry.expiresAt
  }

  const cache = {
    get(key: string): T | undefined {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (isExpired(entry)) {
        cache.delete(key)
        return undefined
      }
      touch(key)
      return entry.value
    },

    set(key: string, value: T) {
      if (entries.has(key)) {
        entries.set(key, {
          value,
          expiresAt: opts.ttlMs ? Date.now() + opts.ttlMs : undefined,
        })
        touch(key)
        return
      }

      while (entries.size >= opts.maxEntries) {
        evictOldest()
      }

      entries.set(key, {
        value,
        expiresAt: opts.ttlMs ? Date.now() + opts.ttlMs : undefined,
      })
      order.push(key)
    },

    delete(key: string) {
      const entry = entries.get(key)
      if (!entry) return
      entries.delete(key)
      const idx = order.indexOf(key)
      if (idx > -1) order.splice(idx, 1)
      evictions++
      if (opts.onEvict) opts.onEvict(key, entry.value)
    },

    clear() {
      entries.clear()
      order.length = 0
    },

    has(key: string) {
      const entry = entries.get(key)
      if (!entry) return false
      if (isExpired(entry)) {
        cache.delete(key)
        return false
      }
      return true
    },

    stats() {
      return { size: entries.size, evictions }
    },
  }

  return cache
}
