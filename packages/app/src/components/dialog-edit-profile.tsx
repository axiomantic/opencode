import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { showToast } from "@opencode-ai/ui/toast"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { iconNames } from "@opencode-ai/ui/icons/provider"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

export function DialogEditProfile(props: {
  profileId: string
  currentName: string
  providerType: string
}) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const [store, setStore] = createStore({
    name: props.currentName,
    saving: false,
  })

  const providerIcon = (): IconName => {
    if (iconNames.includes(props.providerType as IconName)) return props.providerType as IconName
    return "synthetic"
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const trimmed = store.name.trim()
    if (!trimmed) return

    setStore("saving", true)
    try {
      await globalSync.updateConfig({
        provider: {
          [props.profileId]: { name: trimmed },
        },
      })
      await globalSDK.client.global.dispose().catch(() => undefined)
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("profile.edit.toast.success.title"),
        description: language.t("profile.edit.toast.success.description", { name: trimmed }),
      })
    } catch (err: unknown) {
      setStore("saving", false)
      const message = err instanceof Error ? err.message : String(err)
      showToast({
        title: language.t("common.requestFailed"),
        description: message,
      })
    }
  }

  return (
    <Dialog title={language.t("dialog.profile.edit.title")} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex items-center gap-3 pb-2">
          <ProviderIcon id={providerIcon()} class="size-5 shrink-0 icon-strong-base" />
          <span class="text-14-regular text-text-base">{props.providerType}</span>
        </div>
        <TextField
          autofocus
          type="text"
          label={language.t("profile.edit.name.label")}
          value={store.name}
          onChange={(v) => setStore("name", v)}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={store.saving || !store.name.trim()}>
            {store.saving ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
