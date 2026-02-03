import type { Config } from "@opencode-ai/sdk/v2/client"

type ProviderConfig = NonNullable<Config["provider"]>[string]

/**
 * Detect if extending `extendsId` from `profileId` would create a cycle.
 * Returns true if a cycle would be created.
 */
export function detectCycle(
  profileId: string,
  extendsId: string | undefined,
  providers: Record<string, ProviderConfig>,
): boolean {
  if (!extendsId) return false
  if (extendsId === profileId) return true

  const visited = new Set<string>([profileId])
  let current = extendsId

  while (current) {
    if (visited.has(current)) return true
    visited.add(current)
    const config = providers[current]
    if (!config?.extends) break
    current = config.extends
  }

  return false
}

/**
 * Get sibling profiles (same provider type) that can be extended.
 * Excludes the profile itself and profiles that would create cycles.
 */
export function getSiblings(
  profileId: string,
  providerType: string,
  providers: Record<string, ProviderConfig>,
): string[] {
  const siblings: string[] = []

  for (const [id, config] of Object.entries(providers)) {
    if (id === profileId) continue
    // Check if this provider extends the same base type or is the base type
    const baseType = config.extends ?? id
    if (baseType !== providerType && id !== providerType) continue
    // Skip if extending this would create a cycle
    if (detectCycle(profileId, id, providers)) continue
    siblings.push(id)
  }

  return siblings
}

/**
 * Get the base provider type for a profile.
 * Follows the extends chain to find the root provider.
 */
export function getBaseType(profileId: string, providers: Record<string, ProviderConfig>): string {
  const config = providers[profileId]
  if (!config?.extends) return profileId

  const visited = new Set<string>([profileId])
  let current = config.extends

  while (current) {
    if (visited.has(current)) return profileId // Cycle detected, return original
    visited.add(current)
    const parentConfig = providers[current]
    if (!parentConfig?.extends) return current
    current = parentConfig.extends
  }

  return profileId
}

/**
 * Get the effective value for a field, resolving inheritance.
 * Returns the value from the profile or its parent chain.
 */
export function getEffectiveValue<T>(
  profileId: string,
  providers: Record<string, ProviderConfig>,
  getValue: (config: ProviderConfig) => T | undefined,
): { value: T | undefined; inherited: boolean; source: string | undefined } {
  const config = providers[profileId]
  const directValue = config ? getValue(config) : undefined

  if (directValue !== undefined) {
    return { value: directValue, inherited: false, source: undefined }
  }

  if (!config?.extends) {
    return { value: undefined, inherited: false, source: undefined }
  }

  const visited = new Set<string>([profileId])
  let current = config.extends

  while (current) {
    if (visited.has(current)) break
    visited.add(current)

    const parentConfig = providers[current]
    if (!parentConfig) break

    const parentValue = getValue(parentConfig)
    if (parentValue !== undefined) {
      return { value: parentValue, inherited: true, source: current }
    }

    if (!parentConfig.extends) break
    current = parentConfig.extends
  }

  return { value: undefined, inherited: false, source: undefined }
}

/**
 * Mask an API key for display (first 3 chars...last 4 chars, e.g., "sk-...abcd")
 */
export function maskApiKey(key: string | undefined): string {
  if (!key) return ""
  if (key.length <= 8) return "••••••••"
  const prefix = key.slice(0, 3)
  const suffix = key.slice(-4)
  return `${prefix}...${suffix}`
}

/**
 * Group providers by their base type.
 * Returns a map of base type -> list of profile IDs (including the base itself if it exists in config)
 */
export function groupByBaseType(providers: Record<string, ProviderConfig>): Map<string, string[]> {
  const groups = new Map<string, string[]>()

  for (const id of Object.keys(providers)) {
    const baseType = getBaseType(id, providers)
    const group = groups.get(baseType) ?? []
    group.push(id)
    groups.set(baseType, group)
  }

  return groups
}
