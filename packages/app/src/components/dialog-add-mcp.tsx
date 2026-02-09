import { Component, Match, Show, Switch as SolidSwitch } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"

type Step = "type" | "local" | "remote"

export const DialogAddMcp: Component = () => {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()

  const [store, setStore] = createStore({
    step: "type" as Step,
    name: "",
    command: "",
    url: "",
    error: "",
    submitting: false,
  })

  const typeOptions = [
    {
      id: "local" as const,
      name: language.t("dialog.addMcp.type.local"),
      description: language.t("dialog.addMcp.type.local.description"),
    },
    {
      id: "remote" as const,
      name: language.t("dialog.addMcp.type.remote"),
      description: language.t("dialog.addMcp.type.remote.description"),
    },
  ]

  const goBack = () => {
    if (store.step === "type") {
      dialog.close()
    } else {
      setStore({ step: "type", error: "" })
    }
  }

  const selectType = (type: "local" | "remote") => {
    setStore({ step: type, name: "", command: "", url: "", error: "" })
  }

  const validate = (): boolean => {
    if (!store.name.trim()) {
      setStore("error", language.t("dialog.addMcp.error.nameRequired"))
      return false
    }

    if (store.step === "local" && !store.command.trim()) {
      setStore("error", language.t("dialog.addMcp.error.commandRequired"))
      return false
    }

    if (store.step === "remote") {
      if (!store.url.trim()) {
        setStore("error", language.t("dialog.addMcp.error.urlRequired"))
        return false
      }
      if (!/^https?:\/\//.test(store.url.trim())) {
        setStore("error", language.t("dialog.addMcp.error.invalidUrl"))
        return false
      }
    }

    return true
  }

  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    if (store.submitting) return

    setStore("error", "")
    if (!validate()) return

    setStore("submitting", true)

    const config =
      store.step === "local"
        ? { type: "local" as const, command: store.command.trim().split(/\s+/) }
        : { type: "remote" as const, url: store.url.trim() }

    try {
      await sdk.client.mcp.add({ name: store.name.trim(), config })
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.addMcp.toast.added.title"),
      })
    } catch (err) {
      setStore("error", err instanceof Error ? err.message : String(err))
    } finally {
      setStore("submitting", false)
    }
  }

  return (
    <Dialog
      title={
        store.step === "type" ? (
          language.t("dialog.addMcp.title")
        ) : (
          <IconButton
            tabIndex={-1}
            icon="arrow-left"
            variant="ghost"
            onClick={goBack}
            aria-label={language.t("common.goBack")}
          />
        )
      }
      transition
    >
      <SolidSwitch>
        <Match when={store.step === "type"}>
          <List items={() => typeOptions} key={(x) => x?.id ?? ""} onSelect={(x) => x && selectType(x.id)}>
            {(item) => (
              <div class="flex flex-col gap-0.5">
                <span class="text-14-medium text-text-strong">{item.name}</span>
                <span class="text-12-regular text-text-weak">{item.description}</span>
              </div>
            )}
          </List>
        </Match>

        <Match when={store.step === "local"}>
          <form onSubmit={submit} class="flex flex-col gap-6 px-5 pb-5">
            <div class="flex items-center gap-3">
              <span class="text-16-medium text-text-strong">{language.t("dialog.addMcp.type.local")}</span>
            </div>

            <div class="flex flex-col gap-4">
              <TextField
                autofocus
                label={language.t("dialog.addMcp.field.name")}
                placeholder={language.t("dialog.addMcp.field.name.placeholder")}
                value={store.name}
                onChange={(v) => setStore("name", v)}
              />
              <TextField
                label={language.t("dialog.addMcp.field.command")}
                placeholder={language.t("dialog.addMcp.field.command.placeholder")}
                description={language.t("dialog.addMcp.field.command.hint")}
                value={store.command}
                onChange={(v) => setStore("command", v)}
              />
            </div>

            <Show when={store.error}>
              <div class="text-12-regular text-text-critical-base">{store.error}</div>
            </Show>

            <Button type="submit" size="large" variant="primary" disabled={store.submitting} class="self-start">
              {store.submitting ? language.t("common.loading") : language.t("dialog.addMcp.action.add")}
            </Button>
          </form>
        </Match>

        <Match when={store.step === "remote"}>
          <form onSubmit={submit} class="flex flex-col gap-6 px-5 pb-5">
            <div class="flex items-center gap-3">
              <span class="text-16-medium text-text-strong">{language.t("dialog.addMcp.type.remote")}</span>
            </div>

            <div class="flex flex-col gap-4">
              <TextField
                autofocus
                label={language.t("dialog.addMcp.field.name")}
                placeholder={language.t("dialog.addMcp.field.name.placeholder")}
                value={store.name}
                onChange={(v) => setStore("name", v)}
              />
              <TextField
                label={language.t("dialog.addMcp.field.url")}
                placeholder={language.t("dialog.addMcp.field.url.placeholder")}
                description={language.t("dialog.addMcp.field.url.hint")}
                value={store.url}
                onChange={(v) => setStore("url", v)}
              />
            </div>

            <Show when={store.error}>
              <div class="text-12-regular text-text-critical-base">{store.error}</div>
            </Show>

            <Button type="submit" size="large" variant="primary" disabled={store.submitting} class="self-start">
              {store.submitting ? language.t("common.loading") : language.t("dialog.addMcp.action.add")}
            </Button>
          </form>
        </Match>
      </SolidSwitch>
    </Dialog>
  )
}
