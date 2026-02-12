import { describe, test, expect } from "bun:test"

// Test the deleteProfile two-step deletion orchestration logic.
//
// Contract:
// 1. Remove auth credentials first (more likely to fail)
// 2. Remove config entry (null = delete)
// 3. Auth-first: if auth fails, abort entirely (no config delete, no dispose)
// 4. If config fails, still dispose() but don't close dialog
// 5. On success: dispose, close dialog, report success
// 6. dispose() failures are always swallowed (catch(() => undefined))

export type DeleteProfileDeps = {
  removeAuth: () => Promise<void>
  removeConfig: () => Promise<void>
  dispose: () => Promise<void>
  closeDialog: () => void
}

export type DeleteProfileResult = {
  outcome: "success" | "auth-failed" | "config-failed"
  authRemoved: boolean
  configRemoved: boolean
  disposed: boolean
  dialogClosed: boolean
}

// This function will be implemented to match the deleteProfile handler's logic.
// It is NOT exported from the component; we define and test the algorithm here
// to verify the orchestration contract before implementing it in the component.
export async function deleteProfileLogic(deps: DeleteProfileDeps): Promise<DeleteProfileResult> {
  const result: DeleteProfileResult = {
    outcome: "success",
    authRemoved: false,
    configRemoved: false,
    disposed: false,
    dialogClosed: false,
  }

  // Step 1: Remove auth credentials first (more likely to fail)
  try {
    await deps.removeAuth()
    result.authRemoved = true
  } catch {
    result.outcome = "auth-failed"
    return result
  }

  // Step 2: Remove config entry (null = delete)
  try {
    await deps.removeConfig()
    result.configRemoved = true
  } catch {
    result.outcome = "config-failed"
    await deps.dispose().catch(() => undefined)
    result.disposed = true
    return result
  }

  // Step 3: Success - dispose, close dialog
  await deps.dispose().catch(() => undefined)
  result.disposed = true
  deps.closeDialog()
  result.dialogClosed = true
  return result
}

describe("deleteProfile orchestration", () => {
  test("success: removes auth, then config, then disposes and closes dialog", async () => {
    const result = await deleteProfileLogic({
      removeAuth: async () => {},
      removeConfig: async () => {},
      dispose: async () => {},
      closeDialog: () => {},
    })

    expect(result.outcome).toBe("success")
    expect(result.authRemoved).toBe(true)
    expect(result.configRemoved).toBe(true)
    expect(result.disposed).toBe(true)
    expect(result.dialogClosed).toBe(true)
  })

  test("auth failure: aborts without removing config or disposing", async () => {
    const result = await deleteProfileLogic({
      removeAuth: async () => {
        throw new Error("auth service unavailable")
      },
      removeConfig: async () => {},
      dispose: async () => {},
      closeDialog: () => {},
    })

    expect(result.outcome).toBe("auth-failed")
    expect(result.authRemoved).toBe(false)
    expect(result.configRemoved).toBe(false)
    expect(result.disposed).toBe(false)
    expect(result.dialogClosed).toBe(false)
  })

  test("config failure: auth removed, disposes but does not close dialog", async () => {
    const result = await deleteProfileLogic({
      removeAuth: async () => {},
      removeConfig: async () => {
        throw new Error("config write failed")
      },
      dispose: async () => {},
      closeDialog: () => {},
    })

    expect(result.outcome).toBe("config-failed")
    expect(result.authRemoved).toBe(true)
    expect(result.configRemoved).toBe(false)
    expect(result.disposed).toBe(true)
    expect(result.dialogClosed).toBe(false)
  })

  test("config failure with dispose failure: swallows dispose error", async () => {
    const result = await deleteProfileLogic({
      removeAuth: async () => {},
      removeConfig: async () => {
        throw new Error("config write failed")
      },
      dispose: async () => {
        throw new Error("dispose also failed")
      },
      closeDialog: () => {},
    })

    expect(result.outcome).toBe("config-failed")
    expect(result.authRemoved).toBe(true)
    expect(result.configRemoved).toBe(false)
    expect(result.disposed).toBe(true)
    expect(result.dialogClosed).toBe(false)
  })

  test("success with dispose failure: still closes dialog", async () => {
    const result = await deleteProfileLogic({
      removeAuth: async () => {},
      removeConfig: async () => {},
      dispose: async () => {
        throw new Error("dispose failed")
      },
      closeDialog: () => {},
    })

    expect(result.outcome).toBe("success")
    expect(result.authRemoved).toBe(true)
    expect(result.configRemoved).toBe(true)
    expect(result.disposed).toBe(true)
    expect(result.dialogClosed).toBe(true)
  })

  test("execution order: auth before config before dispose before close", async () => {
    const order: string[] = []

    await deleteProfileLogic({
      removeAuth: async () => {
        order.push("auth")
      },
      removeConfig: async () => {
        order.push("config")
      },
      dispose: async () => {
        order.push("dispose")
      },
      closeDialog: () => {
        order.push("close")
      },
    })

    expect(order).toEqual(["auth", "config", "dispose", "close"])
  })
})
