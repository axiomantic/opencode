import { describe, expect, test, beforeEach } from "bun:test"
import { perfFlags, setPerfFlag, resetPerfFlags } from "./perf-flags"

describe("perfFlags", () => {
  beforeEach(() => resetPerfFlags())

  test("defaults all flags to false", () => {
    expect(perfFlags.messageVirtualization).toBe(false)
    expect(perfFlags.sessionListVirtualization).toBe(false)
    expect(perfFlags.sessionCleanup).toBe(false)
    expect(perfFlags.childStoreEviction).toBe(false)
    expect(perfFlags.scrollSpyOptimized).toBe(false)
  })

  test("setPerfFlag enables a flag", () => {
    setPerfFlag("messageVirtualization", true)
    expect(perfFlags.messageVirtualization).toBe(true)
  })

  test("resetPerfFlags restores defaults", () => {
    setPerfFlag("messageVirtualization", true)
    resetPerfFlags()
    expect(perfFlags.messageVirtualization).toBe(false)
  })
})
