type PerfFlagKey =
  | "messageVirtualization"
  | "sessionListVirtualization"
  | "sessionCleanup"
  | "childStoreEviction"
  | "scrollSpyOptimized"

const defaults: Record<PerfFlagKey, boolean> = {
  messageVirtualization: false,
  sessionListVirtualization: false,
  sessionCleanup: false,
  childStoreEviction: false,
  scrollSpyOptimized: false,
}

export const perfFlags = { ...defaults }

export function setPerfFlag(key: PerfFlagKey, value: boolean) {
  perfFlags[key] = value
}

export function resetPerfFlags() {
  for (const key of Object.keys(defaults) as PerfFlagKey[]) {
    perfFlags[key] = defaults[key]
  }
}

// Enable via console: window.__setPerfFlag?.("messageVirtualization", true)
if (typeof window !== "undefined") {
  ;(window as unknown as Record<string, unknown>).__setPerfFlag = setPerfFlag
  ;(window as unknown as Record<string, unknown>).__perfFlags = perfFlags
}
