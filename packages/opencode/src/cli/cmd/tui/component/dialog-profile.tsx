import { createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useTheme } from "../context/theme"
import { DialogModel } from "./dialog-model"
import { detectCycle, getSiblings, getEffectiveValue, maskApiKey } from "../util/provider"
import { useToast } from "../ui/toast"

const PROFILE_ID = /^[a-z0-9][a-z0-9-_]*$/

interface DialogProfileProps {
  mode: "create" | "edit"
  providerType: string
  providerName: string
  profileId?: string
}

export function DialogProfile(props: DialogProfileProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const toast = useToast()

  const providers = createMemo(() => sync.data.config.provider ?? {})
  const existing = createMemo(() => (props.profileId ? providers()[props.profileId] : undefined))

  const [step, setStep] = createSignal<"id" | "extends" | "apikey">(props.mode === "create" ? "id" : "apikey")
  const [profileId, setProfileId] = createSignal(props.profileId ?? "")
  const [extendsId, setExtendsId] = createSignal(existing()?.extends ?? "")
  const [saving, setSaving] = createSignal(false)

  // Get sibling profiles that can be extended
  const siblings = createMemo(() => {
    const id = props.mode === "edit" ? props.profileId! : profileId()
    return getSiblings(id, props.providerType, providers())
  })

  // Get inherited API key for placeholder display
  const inheritedApiKey = createMemo(() => {
    const ext = extendsId()
    if (!ext) return undefined
    const result = getEffectiveValue(ext, providers(), (c) => c.options?.apiKey)
    return result.value ? maskApiKey(result.value) : undefined
  })

  const save = async (apiKey: string) => {
    if (saving()) return
    setSaving(true)

    const id = props.mode === "edit" ? props.profileId! : profileId()
    const ext = extendsId() || undefined

    // Check for cycles before saving
    if (ext && detectCycle(id, ext, providers())) {
      toast.error("Extending this profile would create a circular dependency")
      setSaving(false)
      return
    }

    const config = {
      name: props.providerName,
      extends: ext,
      options: {},
    }

    // Save API key separately if provided
    if (apiKey.trim()) {
      await sdk.client.auth.set({
        providerID: id,
        auth: { type: "api", key: apiKey.trim() },
      })
    }

    // Update config
    await sdk.client.config.update({
      config: { provider: { [id]: config } },
    })

    await sdk.client.instance.dispose()
    await sync.bootstrap()

    dialog.replace(() => <DialogModel providerID={props.providerType} />)
  }

  // Step 1: Profile ID (create mode only)
  if (step() === "id") {
    return (
      <DialogPrompt
        title={`Add ${props.providerName} Profile`}
        placeholder="my-profile"
        onConfirm={(value) => {
          const id = value.trim()
          if (!id) return
          if (!PROFILE_ID.test(id)) return
          if (providers()[id]) return
          setProfileId(id)
          // Skip extends step if no siblings
          if (siblings().length === 0) {
            setStep("apikey")
          } else {
            setStep("extends")
          }
        }}
        description={() => (
          <text fg={theme.textMuted}>Lowercase letters, numbers, hyphens, or underscores</text>
        )}
      />
    )
  }

  // Step 2: Extends selection (if siblings exist)
  if (step() === "extends") {
    const options = createMemo(() => {
      const result: { title: string; value: string; description?: string }[] = [
        {
          title: "None (standalone profile)",
          value: "",
        },
      ]
      for (const id of siblings()) {
        const config = providers()[id]
        result.push({
          title: config?.name ?? id,
          value: id,
          description: id === props.providerType ? "Base provider" : undefined,
        })
      }
      return result
    })

    return (
      <DialogSelect
        title="Extend another profile?"
        options={options()}
        current={extendsId()}
        onSelect={(option) => {
          setExtendsId(option.value)
          setStep("apikey")
        }}
      />
    )
  }

  // Step 3: API Key
  const placeholder = inheritedApiKey() ?? "Enter API key"
  const description = inheritedApiKey()
    ? `Inherited from ${extendsId()}`
    : extendsId()
      ? "Leave empty to use inherited value"
      : undefined

  return (
    <DialogPrompt
      title={props.mode === "create" ? `${props.providerName} API Key` : `Edit ${existing()?.name || props.profileId}`}
      placeholder={placeholder}
      onConfirm={save}
      description={
        description
          ? () => (
              <text fg={theme.textMuted}>{description}</text>
            )
          : undefined
      }
    />
  )
}
