import { describe, test, expect } from "bun:test"

// Test the validation logic that will be used in DialogAddMcp
// These tests verify the validation rules before the component is created

describe("DialogAddMcp validation", () => {
  // Validation rules:
  // 1. Name is required (non-empty after trim)
  // 2. For local type: command is required (non-empty after trim)
  // 3. For remote type: URL is required and must start with http:// or https://

  const validateName = (name: string): string | null => {
    if (!name.trim()) return "Name is required"
    return null
  }

  const validateCommand = (command: string): string | null => {
    if (!command.trim()) return "Command is required"
    return null
  }

  const validateUrl = (url: string): string | null => {
    if (!url.trim()) return "URL is required"
    if (!/^https?:\/\//.test(url.trim())) return "URL must start with http:// or https://"
    return null
  }

  describe("name validation", () => {
    test("rejects empty name", () => {
      expect(validateName("")).toBe("Name is required")
    })

    test("rejects whitespace-only name", () => {
      expect(validateName("   ")).toBe("Name is required")
    })

    test("accepts valid name", () => {
      expect(validateName("my-mcp-server")).toBeNull()
    })

    test("accepts name with surrounding whitespace (trimmed)", () => {
      expect(validateName("  my-server  ")).toBeNull()
    })
  })

  describe("command validation (local type)", () => {
    test("rejects empty command", () => {
      expect(validateCommand("")).toBe("Command is required")
    })

    test("rejects whitespace-only command", () => {
      expect(validateCommand("   ")).toBe("Command is required")
    })

    test("accepts valid command", () => {
      expect(validateCommand("npx @modelcontextprotocol/server-filesystem")).toBeNull()
    })
  })

  describe("URL validation (remote type)", () => {
    test("rejects empty URL", () => {
      expect(validateUrl("")).toBe("URL is required")
    })

    test("rejects whitespace-only URL", () => {
      expect(validateUrl("   ")).toBe("URL is required")
    })

    test("rejects URL without protocol", () => {
      expect(validateUrl("mcp.example.com")).toBe("URL must start with http:// or https://")
    })

    test("rejects URL with invalid protocol", () => {
      expect(validateUrl("ftp://mcp.example.com")).toBe("URL must start with http:// or https://")
    })

    test("accepts http URL", () => {
      expect(validateUrl("http://mcp.example.com")).toBeNull()
    })

    test("accepts https URL", () => {
      expect(validateUrl("https://mcp.example.com")).toBeNull()
    })

    test("accepts URL with surrounding whitespace (trimmed)", () => {
      expect(validateUrl("  https://mcp.example.com  ")).toBeNull()
    })
  })

  describe("command splitting", () => {
    // The component splits command by whitespace for the API call
    const splitCommand = (command: string): string[] => command.trim().split(/\s+/)

    test("splits simple command", () => {
      expect(splitCommand("npx server")).toEqual(["npx", "server"])
    })

    test("splits command with multiple arguments", () => {
      expect(splitCommand("npx @modelcontextprotocol/server-filesystem /path/to/dir")).toEqual([
        "npx",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/dir",
      ])
    })

    test("handles extra whitespace", () => {
      expect(splitCommand("  npx   server  ")).toEqual(["npx", "server"])
    })
  })
})
