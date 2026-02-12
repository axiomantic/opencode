import { describe, test, expect } from "bun:test"
import {
  asInstanceDirectory,
  asGitWorktree,
  brandPath,
  type InstanceDirectory,
  type GitWorktree,
  type BrandedPath,
  type BrandedSession,
} from "./branded-path"

describe("branded-path", () => {
  describe("runtime behavior", () => {
    test("asInstanceDirectory returns the input string unchanged", () => {
      const input = "/home/user/project"
      const result: string = asInstanceDirectory(input)
      expect(result).toBe(input)
      expect(typeof result).toBe("string")
    })

    test("asGitWorktree returns the input string unchanged", () => {
      const input = "/home/user/project"
      const result: string = asGitWorktree(input)
      expect(result).toBe(input)
      expect(typeof result).toBe("string")
    })

    test("both functions work with empty strings", () => {
      const a: string = asInstanceDirectory("")
      const b: string = asGitWorktree("")
      expect(a).toBe("")
      expect(b).toBe("")
    })

    test("both functions preserve path content exactly", () => {
      const paths = [
        "/Users/test/Development/my-project",
        "/home/user/.config/opencode",
        "C:\\Users\\test\\project",
        "/path/with spaces/and (parens)",
      ]
      for (const path of paths) {
        const dir: string = asInstanceDirectory(path)
        const wt: string = asGitWorktree(path)
        expect(dir).toBe(path)
        expect(wt).toBe(path)
      }
    })
  })

  describe("type safety", () => {
    test("InstanceDirectory is not assignable to GitWorktree", () => {
      const dir = asInstanceDirectory("/test")
      const worktree = asGitWorktree("/test")

      // Same string value, but different branded types
      // This comparison should be a type error:
      // @ts-expect-error - InstanceDirectory should not be comparable to GitWorktree
      const _invalid: boolean = dir === worktree

      // These self-comparisons should be fine (no error expected)
      const _validDir: boolean = dir === asInstanceDirectory("/other")
      const _validWorktree: boolean = worktree === asGitWorktree("/other")
    })

    test("InstanceDirectory is not assignable to GitWorktree variable", () => {
      const dir = asInstanceDirectory("/test")
      // @ts-expect-error - InstanceDirectory should not be assignable to GitWorktree
      const _asWorktree: GitWorktree = dir
    })

    test("GitWorktree is not assignable to InstanceDirectory variable", () => {
      const worktree = asGitWorktree("/test")
      // @ts-expect-error - GitWorktree should not be assignable to InstanceDirectory
      const _asDir: InstanceDirectory = worktree
    })

    test("plain string is not assignable to branded types without casting", () => {
      const plain = "/test"
      // @ts-expect-error - plain string should not be assignable to InstanceDirectory
      const _asDir: InstanceDirectory = plain
      // @ts-expect-error - plain string should not be assignable to GitWorktree
      const _asWorktree: GitWorktree = plain
    })
  })

  describe("brandPath", () => {
    test("returns the same object reference (zero-cost cast)", () => {
      const raw = { home: "/home", state: "/state", config: "/cfg", worktree: "/wt", directory: "/dir" }
      const branded = brandPath(raw)
      // Same reference, not a copy
      expect(branded as unknown).toBe(raw as unknown)
      // Fields preserved
      expect(branded.home).toBe("/home")
      expect(branded.state).toBe("/state")
      expect(branded.config).toBe("/cfg")
    })

    test("branded path fields have correct branded types", () => {
      const branded = brandPath({ home: "", state: "", config: "", worktree: "/wt", directory: "/dir" })
      // These should type-check: branded.directory is InstanceDirectory, branded.worktree is GitWorktree
      const _dir: InstanceDirectory = branded.directory
      const _wt: GitWorktree = branded.worktree

      // Cross-assignment should fail
      // @ts-expect-error - BrandedPath.directory (InstanceDirectory) should not be assignable to GitWorktree
      const _crossDir: GitWorktree = branded.directory
      // @ts-expect-error - BrandedPath.worktree (GitWorktree) should not be assignable to InstanceDirectory
      const _crossWt: InstanceDirectory = branded.worktree
    })
  })

  describe("BrandedSession type", () => {
    test("brands the directory field of a session-like object", () => {
      type RawSession = { id: string; directory: string; title: string }
      const raw: RawSession = { id: "s1", directory: "/dir", title: "Test" }
      const branded = raw as BrandedSession<RawSession>

      // directory is now InstanceDirectory
      const _dir: InstanceDirectory = branded.directory
      // other fields preserved
      const _id: string = branded.id
      const _title: string = branded.title

      // Should fail: directory is InstanceDirectory, not GitWorktree
      // @ts-expect-error - BrandedSession.directory should not be assignable to GitWorktree
      const _crossDir: GitWorktree = branded.directory
    })
  })

  describe("bug prevention: session.directory vs project.worktree", () => {
    test("comparing session.directory with path.directory compiles (both InstanceDirectory)", () => {
      // This represents the CORRECT filter: session.directory === data.path.directory
      const sessionDir = asInstanceDirectory("/home/user/project")
      const pathDir = asInstanceDirectory("/home/user/project")
      // Should compile fine: InstanceDirectory === InstanceDirectory
      const _valid: boolean = sessionDir === pathDir
      expect(_valid).toBe(true)
    })

    test("comparing session.directory with project.worktree is a type error", () => {
      // This represents the BUG: session.directory === props.project.worktree
      const sessionDir = asInstanceDirectory("/home/user/project")
      const projectWorktree = asGitWorktree("/home/user/project")

      // @ts-expect-error - This is the exact bug we want to prevent!
      // InstanceDirectory (session.directory) should not be comparable to GitWorktree (project.worktree)
      const _invalid: boolean = sessionDir === projectWorktree

      // At runtime they may be equal, but the TYPE SYSTEM should catch this
      expect(true).toBe(true)
    })

    test("comparing project.worktree with project.worktree compiles (both GitWorktree)", () => {
      const wt1 = asGitWorktree("/home/user/project")
      const wt2 = asGitWorktree("/home/user/other")
      // Should compile fine: GitWorktree === GitWorktree
      const _valid: boolean = wt1 === wt2
      expect(_valid).toBe(false)
    })
  })
})
