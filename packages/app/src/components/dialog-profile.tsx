import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import type { IconName } from "@opencode-ai/ui/icons/provider"
import { iconNames } from "@opencode-ai/ui/icons/provider"
import { createMemo, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { detectCycle, getSiblings, getEffectiveValue, maskApiKey } from "@/lib/provider-utils"

const PROFILE_ID = /^[a-z0-9][a-z0-9-_]*$/

type Props = {
  mode: "create" | "edit"
  providerType: string
  providerName: string
  profileId?: string
  onClose?: () => void
}

export function DialogProfile(props: Props) {
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const providers = createMemo(() => globalSync.data.config.provider ?? {})

  const existing = createMemo(() => (props.profileId ? providers()[props.profileId] : undefined))

  const [form, setForm] = createStore({
    profileId: props.profileId ?? "",
    name: existing()?.name ?? "",
    extends: existing()?.extends ?? "",
    apiKey: "",
    baseURL: existing()?.options?.baseURL ?? "",
    saving: false,
  })

  const [errors, setErrors] = createStore({
    profileId: undefined as string | undefined,
    name: undefined as string | undefined,
  })

  const icon = (id: string): IconName => {
    if (iconNames.includes(id as IconName)) return id as IconName
    return "synthetic"
  }

  // Get sibling profiles that can be extended
  const siblings = createMemo(() => {
    const id = props.mode === "edit" ? props.profileId! : form.profileId
    return getSiblings(id, props.providerType, providers())
  })

  // Get inherited values for placeholder display
  const inheritedApiKey = createMemo(() => {
    if (!form.extends) return undefined
    const result = getEffectiveValue(form.extends, providers(), (c) => c.options?.apiKey)
    return result.value ? maskApiKey(result.value) : undefined
  })

  const inheritedBaseURL = createMemo(() => {
    if (!form.extends) return undefined
    const result = getEffectiveValue(form.extends, providers(), (c) => c.options?.baseURL)
    return result.value
  })

  const inheritedName = createMemo(() => {
    if (!form.extends) return undefined
    const parent = providers()[form.extends]
    return parent?.name
  })

  const goBack = () => {
    props.onClose?.()
    dialog.close()
  }

  const validate = () => {
    const profileId = form.profileId.trim()
    const name = form.name.trim()

    const idError =
      props.mode === "create"
        ? !profileId
          ? "Profile ID is required"
          : !PROFILE_ID.test(profileId)
            ? "Use lowercase letters, numbers, hyphens, or underscores"
            : providers()[profileId]
              ? "Profile ID already exists"
              : undefined
        : undefined

    const nameError = !name && !form.extends ? "Display name is required (or extend another profile)" : undefined

    setErrors(
      produce((draft) => {
        draft.profileId = idError
        draft.name = nameError
      }),
    )

    return !idError && !nameError
  }

  const save = async (e: SubmitEvent) => {
    e.preventDefault()
    if (form.saving) return
    if (!validate()) return

    setForm("saving", true)

    const profileId = props.mode === "edit" ? props.profileId! : form.profileId.trim()
    const name = form.name.trim()
    const apiKey = form.apiKey.trim()
    const baseURL = form.baseURL.trim()
    const extendsValue = form.extends || undefined

    // Check for cycles before saving
    if (extendsValue && detectCycle(profileId, extendsValue, providers())) {
      showToast({
        variant: "error",
        title: "Invalid configuration",
        description: "Extending this profile would create a circular dependency",
      })
      setForm("saving", false)
      return
    }

    const config = {
      ...(name ? { name } : {}),
      ...(extendsValue ? { extends: extendsValue } : {}),
      options: {
        ...(baseURL ? { baseURL } : {}),
      },
    }

    // Save API key separately if provided
    const authPromise = apiKey
      ? globalSDK.client.auth.set({
          providerID: profileId,
          auth: { type: "api", key: apiKey },
        })
      : Promise.resolve()

    authPromise
      .then(() => globalSync.updateConfig({ provider: { [profileId]: config } }))
      .then(() => {
        dialog.close()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: props.mode === "create" ? "Profile created" : "Profile updated",
          description: `${name || profileId} has been ${props.mode === "create" ? "created" : "updated"}`,
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => {
        setForm("saving", false)
      })
  }

  const title = props.mode === "create" ? `Add ${props.providerName} Profile` : `Edit ${existing()?.name || props.profileId}`

  return (
    <Dialog
      title={
        <IconButton tabIndex={-1} icon="arrow-left" variant="ghost" onClick={goBack} aria-label={language.t("common.goBack")} />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={icon(props.providerType)} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">{title}</div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <Show when={props.mode === "create"}>
            <TextField
              autofocus
              label="Profile ID"
              placeholder="my-profile"
              description="Lowercase letters, numbers, hyphens, or underscores"
              value={form.profileId}
              onChange={setForm.bind(null, "profileId")}
              validationState={errors.profileId ? "invalid" : undefined}
              error={errors.profileId}
            />
          </Show>

          <TextField
            autofocus={props.mode === "edit"}
            label="Display name"
            placeholder={inheritedName() ?? props.providerName}
            value={form.name}
            onChange={setForm.bind(null, "name")}
            validationState={errors.name ? "invalid" : undefined}
            error={errors.name}
          />

          <Show when={siblings().length > 0}>
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-text-weak">Extends</label>
              <Select
                options={["", ...siblings()]}
                current={form.extends}
                placeholder="None (standalone profile)"
                label={(id) => {
                  if (!id) return "None (standalone profile)"
                  const config = providers()[id]
                  return config?.name ?? id
                }}
                onSelect={(id) => setForm("extends", id ?? "")}
                variant="secondary"
                size="large"
              />
              <span class="text-12-regular text-text-weak">
                Inherit configuration from another profile of this provider
              </span>
            </div>
          </Show>

          <TextField
            label="API Key"
            placeholder={inheritedApiKey() ?? "Enter API key"}
            description={
              inheritedApiKey()
                ? `Inherited from ${form.extends}`
                : form.extends
                  ? "No inherited value - enter API key"
                  : undefined
            }
            value={form.apiKey}
            onChange={setForm.bind(null, "apiKey")}
          />

          <TextField
            label="Base URL (optional)"
            placeholder={inheritedBaseURL() ?? "https://api.example.com/v1"}
            description={inheritedBaseURL() ? `Inherited from ${form.extends}` : undefined}
            value={form.baseURL}
            onChange={setForm.bind(null, "baseURL")}
          />

          <Button class="w-auto self-start" type="submit" size="large" variant="primary" disabled={form.saving}>
            {form.saving ? "Saving..." : props.mode === "create" ? "Create Profile" : "Save Changes"}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
