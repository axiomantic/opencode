import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { iconNames, type IconName } from "@opencode-ai/ui/icons/provider"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { DialogProfile } from "./dialog-profile"
import { getBaseType } from "@/lib/provider-utils"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderMeta = { source?: ProviderSource; extends?: string }

type ProviderInfo = {
  id: string
  name: string
  source?: ProviderSource
  extends?: string
}

type GroupedProvider = {
  base: ProviderInfo
  profiles: ProviderInfo[]
}

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  const icon = (id: string): IconName => {
    if (iconNames.includes(id as IconName)) return id as IconName
    return "synthetic"
  }

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
  })

  // Group connected providers by their base type
  const grouped = createMemo((): GroupedProvider[] => {
    const items = connected()
    const configProviders = globalSync.data.config.provider ?? {}
    const groups = new Map<string, GroupedProvider>()

    for (const item of items) {
      const providerConfig = configProviders[item.id]
      const baseType = providerConfig?.extends ? getBaseType(item.id, configProviders) : item.id

      const info: ProviderInfo = {
        id: item.id,
        name: item.name,
        source: (item as ProviderMeta).source,
        extends: providerConfig?.extends,
      }

      const existing = groups.get(baseType)
      if (existing) {
        // This is a profile of an existing base
        if (info.extends) {
          existing.profiles.push(info)
        }
      } else {
        // This is a new base provider
        groups.set(baseType, {
          base: info,
          profiles: [],
        })
      }
    }

    // Sort profiles within each group
    for (const group of groups.values()) {
      group.profiles.sort((a, b) => a.name.localeCompare(b.name))
    }

    return Array.from(groups.values())
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: unknown) => (item as ProviderMeta).source

  const type = (item: ProviderInfo) => {
    if (item.extends) return "Profile"
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderInfo) => source(item) !== "env"

  const canEdit = (item: ProviderInfo) => {
    // Can edit profiles (items with extends) or config-based providers
    const current = source(item)
    return item.extends || current === "config"
  }

  const isConfigCustom = (providerID: string) => {
    const provider = globalSync.data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const isProfile = (item: ProviderInfo) => !!item.extends

  const disableProvider = async (providerID: string, name: string) => {
    const before = globalSync.data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    globalSync.set("config", "disabled_providers", next)

    await globalSync
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    if (isConfigCustom(providerID)) {
      await globalSDK.client.auth.remove({ providerID }).catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await globalSDK.client.auth
      .remove({ providerID })
      .then(async () => {
        await globalSDK.client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const deleteProfile = async (profileId: string, name: string) => {
    // Remove auth and disable the profile
    await globalSDK.client.auth.remove({ providerID: profileId }).catch(() => undefined)
    await disableProvider(profileId, name)
  }

  const openEditDialog = (item: ProviderInfo, baseType: string, baseName: string) => {
    dialog.show(() => <DialogProfile mode="edit" providerType={baseType} providerName={baseName} profileId={item.id} />)
  }

  const openAddProfileDialog = (baseType: string, baseName: string) => {
    dialog.show(() => <DialogProfile mode="create" providerType={baseType} providerName={baseName} />)
  }

  const ProviderRow = (props: { item: ProviderInfo; indent?: boolean; baseType: string; baseName: string }) => (
    <div
      class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none"
      classList={{ "pl-8": props.indent }}
    >
      <div class="flex items-center gap-3 min-w-0">
        <Show when={!props.indent}>
          <ProviderIcon id={icon(props.item.id)} class="size-5 shrink-0 icon-strong-base" />
        </Show>
        <Show when={props.indent}>
          <div class="size-5 shrink-0 flex items-center justify-center">
            <div class="w-2 h-2 rounded-full bg-border-strong-base" />
          </div>
        </Show>
        <span class="text-14-medium text-text-strong truncate">{props.item.name}</span>
        <Tag>{type(props.item)}</Tag>
        <Show when={props.item.extends}>
          <span class="text-12-regular text-text-weak">extends {props.item.extends}</span>
        </Show>
      </div>
      <div class="flex items-center gap-2">
        <Show when={canEdit(props.item)}>
          <IconButton
            icon="edit"
            variant="ghost"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Edit"
            onClick={() => openEditDialog(props.item, props.baseType, props.baseName)}
          />
        </Show>
        <Show
          when={canDisconnect(props.item)}
          fallback={
            <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
              Connected from your environment variables
            </span>
          }
        >
          <Show
            when={isProfile(props.item)}
            fallback={
              <Button size="large" variant="ghost" onClick={() => void disconnect(props.item.id, props.item.name)}>
                {language.t("common.disconnect")}
              </Button>
            }
          >
            <IconButton
              icon="trash"
              variant="ghost"
              class="opacity-0 group-hover:opacity-100 transition-opacity text-icon-critical-base"
              aria-label="Delete"
              onClick={() => void deleteProfile(props.item.id, props.item.name)}
            />
          </Show>
        </Show>
      </div>
    </div>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.providers.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.connected")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={grouped().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={grouped()}>
                {(group) => (
                  <>
                    {/* Base provider row */}
                    <ProviderRow item={group.base} baseType={group.base.id} baseName={group.base.name} />

                    {/* Profile rows */}
                    <For each={group.profiles}>
                      {(profile) => (
                        <ProviderRow item={profile} indent baseType={group.base.id} baseName={group.base.name} />
                      )}
                    </For>

                    {/* Add profile button - available for all connected providers */}
                    <div class="pl-8 py-2 border-b border-border-weak-base last:border-none">
                      <Button
                        size="small"
                        variant="ghost"
                        icon="plus-small"
                        class="text-text-interactive-base"
                        onClick={() => openAddProfileDialog(group.base.id, group.base.name)}
                      >
                        Add profile
                      </Button>
                    </div>
                  </>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.popular")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <For each={popular()}>
              {(item) => (
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-x-3">
                      <ProviderIcon id={icon(item.id)} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{item.name}</span>
                      <Show when={item.id === "opencode"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                    </div>
                    <Show when={item.id === "opencode"}>
                      <span class="text-12-regular text-text-weak pl-8">
                        {language.t("dialog.provider.opencode.note")}
                      </span>
                    </Show>
                    <Show when={item.id === "anthropic"}>
                      <span class="text-12-regular text-text-weak pl-8">
                        {language.t("dialog.provider.anthropic.note")}
                      </span>
                    </Show>
                    <Show when={item.id.startsWith("github-copilot")}>
                      <span class="text-12-regular text-text-weak pl-8">
                        {language.t("dialog.provider.copilot.note")}
                      </span>
                    </Show>
                    <Show when={item.id === "openai"}>
                      <span class="text-12-regular text-text-weak pl-8">
                        {language.t("dialog.provider.openai.note")}
                      </span>
                    </Show>
                    <Show when={item.id === "google"}>
                      <span class="text-12-regular text-text-weak pl-8">
                        {language.t("dialog.provider.google.note")}
                      </span>
                    </Show>
                    <Show when={item.id === "openrouter"}>
                      <span class="text-12-regular text-text-weak pl-8">
                        {language.t("dialog.provider.openrouter.note")}
                      </span>
                    </Show>
                    <Show when={item.id === "vercel"}>
                      <span class="text-12-regular text-text-weak pl-8">
                        {language.t("dialog.provider.vercel.note")}
                      </span>
                    </Show>
                  </div>
                  <Button
                    size="large"
                    variant="secondary"
                    icon="plus-small"
                    onClick={() => {
                      dialog.show(() => <DialogConnectProvider provider={item.id} />)
                    }}
                  >
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>

            <div class="flex items-center justify-between gap-4 h-16 border-b border-border-weak-base last:border-none">
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-x-3">
                  <ProviderIcon id={icon("synthetic")} class="size-5 shrink-0 icon-strong-base" />
                  <span class="text-14-medium text-text-strong">Custom provider</span>
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </div>
                <span class="text-12-regular text-text-weak pl-8">Add an OpenAI-compatible provider by base URL.</span>
              </div>
              <Button
                size="large"
                variant="secondary"
                icon="plus-small"
                onClick={() => {
                  dialog.show(() => <DialogCustomProvider back="close" />)
                }}
              >
                {language.t("common.connect")}
              </Button>
            </div>
          </div>

          <Button
            variant="ghost"
            class="px-0 py-0 mt-5 text-14-medium text-text-interactive-base text-left justify-start hover:bg-transparent active:bg-transparent"
            onClick={() => {
              dialog.show(() => <DialogSelectProvider />)
            }}
          >
            {language.t("dialog.provider.viewAll")}
          </Button>
        </div>
      </div>
    </div>
  )
}
