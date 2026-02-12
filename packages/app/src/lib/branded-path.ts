/**
 * Branded path types to prevent accidental comparison between semantically
 * different path strings.
 *
 * - `InstanceDirectory`: The raw input directory for an opencode instance
 *   (i.e., `Session.directory`, `Path.directory`).
 * - `GitWorktree`: The git worktree root path
 *   (i.e., `Path.worktree`, `Project.worktree`).
 *
 * These are structurally identical at runtime (both are plain strings),
 * but TypeScript treats them as incompatible types, preventing bugs where
 * one is mistakenly compared to the other.
 */

declare const InstanceDirectoryBrand: unique symbol
declare const GitWorktreeBrand: unique symbol

/** The raw input directory for an opencode instance (Session.directory, Path.directory). */
export type InstanceDirectory = string & { readonly [InstanceDirectoryBrand]: typeof InstanceDirectoryBrand }

/** The git worktree root path (Path.worktree, Project.worktree). */
export type GitWorktree = string & { readonly [GitWorktreeBrand]: typeof GitWorktreeBrand }

/** Cast a plain string to InstanceDirectory at a data boundary. */
export function asInstanceDirectory(s: string): InstanceDirectory {
  return s as InstanceDirectory
}

/** Cast a plain string to GitWorktree at a data boundary. */
export function asGitWorktree(s: string): GitWorktree {
  return s as GitWorktree
}

/**
 * Path with branded directory and worktree fields.
 * Use at data boundaries where SDK Path enters the store.
 */
export type BrandedPath = {
  home: string
  state: string
  config: string
  worktree: GitWorktree
  directory: InstanceDirectory
}

/**
 * Utility to brand a raw SDK Path at a data boundary.
 * No runtime cost; just applies the branded type overlay.
 */
export function brandPath(path: { home: string; state: string; config: string; worktree: string; directory: string }): BrandedPath {
  return path as BrandedPath
}

/**
 * Utility to brand a raw SDK Session's directory field at a data boundary.
 * Returns the session with directory typed as InstanceDirectory.
 */
export type BrandedSession<S extends { directory: string }> = Omit<S, "directory"> & { directory: InstanceDirectory }
