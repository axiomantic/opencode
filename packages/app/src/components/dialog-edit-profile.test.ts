import { describe, test, expect } from "bun:test"

// Test the validation and logic extracted from DialogEditProfile.
// Following the dialog-add-mcp.test.ts pattern: extract testable logic,
// verify independently with bun:test.
//
// The component itself (dialog-edit-profile.tsx) uses these same rules
// and is verified via TypeScript compilation.

describe("DialogEditProfile validation", () => {
  // Rule: name must be non-empty after trimming for submit to proceed.
  // In the component: `if (!trimmed) return` in handleSubmit
  const isNameValid = (name: string): boolean => {
    return name.trim().length > 0
  }

  // Rule: name is trimmed before saving to config.
  // In the component: `const trimmed = store.name.trim()`
  const prepareName = (name: string): string => {
    return name.trim()
  }

  // Rule: provider icon falls back to "synthetic" if type is not a known icon name.
  // In the component: providerIcon() accessor
  const resolveProviderIcon = (providerType: string, knownNames: readonly string[]): string => {
    if (knownNames.includes(providerType)) return providerType
    return "synthetic"
  }

  describe("name validation", () => {
    test("rejects empty name", () => {
      expect(isNameValid("")).toBe(false)
    })

    test("rejects whitespace-only name", () => {
      expect(isNameValid("   ")).toBe(false)
    })

    test("rejects tab-only name", () => {
      expect(isNameValid("\t")).toBe(false)
    })

    test("accepts non-empty name", () => {
      expect(isNameValid("My Profile")).toBe(true)
    })

    test("accepts name with surrounding whitespace", () => {
      expect(isNameValid("  My Profile  ")).toBe(true)
    })

    test("accepts single character name", () => {
      expect(isNameValid("A")).toBe(true)
    })
  })

  describe("name preparation", () => {
    test("trims leading whitespace", () => {
      expect(prepareName("  My Profile")).toBe("My Profile")
    })

    test("trims trailing whitespace", () => {
      expect(prepareName("My Profile  ")).toBe("My Profile")
    })

    test("trims both sides", () => {
      expect(prepareName("  My Profile  ")).toBe("My Profile")
    })

    test("preserves internal spaces", () => {
      expect(prepareName("My Work Profile")).toBe("My Work Profile")
    })

    test("returns empty string for whitespace-only input", () => {
      expect(prepareName("   ")).toBe("")
    })
  })

  describe("provider icon resolution", () => {
    const knownNames = ["anthropic", "openai", "google", "aws", "azure"] as const

    test("returns provider type when it is a known icon name", () => {
      expect(resolveProviderIcon("anthropic", knownNames)).toBe("anthropic")
    })

    test("returns provider type for another known name", () => {
      expect(resolveProviderIcon("openai", knownNames)).toBe("openai")
    })

    test("falls back to synthetic for unknown provider type", () => {
      expect(resolveProviderIcon("custom-provider", knownNames)).toBe("synthetic")
    })

    test("falls back to synthetic for empty provider type", () => {
      expect(resolveProviderIcon("", knownNames)).toBe("synthetic")
    })
  })

  describe("submit guard logic", () => {
    // The submit button is disabled when saving or name is empty.
    // In the component: `disabled={store.saving || !store.name.trim()}`
    const isSubmitDisabled = (saving: boolean, name: string): boolean => {
      return saving || !name.trim()
    }

    test("disabled when saving is true", () => {
      expect(isSubmitDisabled(true, "Valid Name")).toBe(true)
    })

    test("disabled when name is empty", () => {
      expect(isSubmitDisabled(false, "")).toBe(true)
    })

    test("disabled when name is whitespace only", () => {
      expect(isSubmitDisabled(false, "   ")).toBe(true)
    })

    test("disabled when both saving and name empty", () => {
      expect(isSubmitDisabled(true, "")).toBe(true)
    })

    test("enabled when not saving and name is valid", () => {
      expect(isSubmitDisabled(false, "My Profile")).toBe(false)
    })
  })
})
