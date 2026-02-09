import { Component, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { DialogAddMcp } from "./dialog-add-mcp"

type McpStatus = "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"

export const SettingsMcp: Component = () => {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()

  const [store, setStore] = createStore({
    loading: null as string | null,
  })

  const servers = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, status]) => ({
        name,
        status: status.status as McpStatus,
        error: status.status === "failed" ? status.error : undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = async (name: string) => {
    if (store.loading) return
    setStore("loading", name)

    try {
      const status = sync.data.mcp?.[name]
      if (!status) return
      if (status.status === "connected") {
        await sdk.client.mcp.disconnect({ name })
      } else {
        await sdk.client.mcp.connect({ name })
      }
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStore("loading", null)
    }
  }

  const retry = async (name: string) => {
    if (store.loading) return
    setStore("loading", name)

    try {
      await sdk.client.mcp.connect({ name })
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStore("loading", null)
    }
  }

  const authenticate = async (name: string) => {
    if (store.loading) return
    setStore("loading", name)

    try {
      await sdk.client.mcp.auth.authenticate({ name })
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStore("loading", null)
    }
  }

  const statusDotClass = (status: McpStatus) => {
    switch (status) {
      case "connected":
        return "bg-icon-success-base"
      case "disabled":
        return "bg-border-weak-base"
      case "failed":
      case "needs_client_registration":
        return "bg-icon-critical-base"
      case "needs_auth":
        return "bg-icon-warning-base"
      default:
        return "bg-border-weak-base"
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.mcp.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.mcp.section.configured")}</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={servers().length > 0}
              fallback={<div class="py-4 text-14-regular text-text-weak">{language.t("settings.mcp.empty")}</div>}
            >
              <For each={servers()}>
                {(server) => (
                  <div class="flex flex-col border-b border-border-weak-base last:border-none">
                    <div class="flex flex-wrap items-center justify-between gap-4 py-3">
                      <div class="flex items-center gap-3 min-w-0">
                        <div class={`size-1.5 rounded-full shrink-0 ${statusDotClass(server.status)}`} />
                        <span class="text-14-medium text-text-strong truncate">{server.name}</span>
                        <span class="text-11-regular text-text-weaker">
                          {language.t(`mcp.status.${server.status}`)}
                        </span>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={server.status === "failed"}>
                          <Button
                            size="small"
                            variant="ghost"
                            disabled={store.loading === server.name}
                            onClick={() => retry(server.name)}
                          >
                            {language.t("settings.mcp.action.retry")}
                          </Button>
                        </Show>
                        <Show when={server.status === "needs_auth"}>
                          <Button
                            size="small"
                            variant="ghost"
                            disabled={store.loading === server.name}
                            onClick={() => authenticate(server.name)}
                          >
                            {language.t("settings.mcp.action.authenticate")}
                          </Button>
                        </Show>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={server.status !== "disabled"}
                            disabled={store.loading === server.name}
                            onChange={() => toggle(server.name)}
                          />
                        </div>
                      </div>
                    </div>
                    <Show when={server.status === "failed" && server.error}>
                      <div class="text-12-regular text-text-critical-base pl-6 pb-3">{server.error}</div>
                    </Show>
                    <Show when={server.status === "needs_client_registration"}>
                      <div class="text-12-regular text-text-critical-base pl-6 pb-3">
                        {language.t("mcp.error.needs_client_registration")}
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <Button
          variant="secondary"
          size="large"
          icon="plus-small"
          class="self-start"
          onClick={() => dialog.show(() => <DialogAddMcp />)}
        >
          {language.t("settings.mcp.action.add")}
        </Button>

        <p class="text-12-regular text-text-weak">{language.t("settings.mcp.configNote")}</p>
      </div>
    </div>
  )
}
