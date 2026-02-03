import { createMemo, createSignal, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useTheme } from "../context/theme"
import { DialogModel } from "./dialog-model"
import { detectCycle, getSiblings, getEffectiveValue, maskApiKey } from "../util/provider"
import { useToast } from "../ui/toast"
import { Link } from "../ui/link"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2"

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

  // Check if provider supports OAuth
  const oauthMethods = createMemo(() => {
    const methods = sync.data.provider_auth[props.providerType] ?? []
    return methods.filter((m) => m.type === "oauth")
  })
  const hasOauth = createMemo(() => oauthMethods().length > 0)

  const [step, setStep] = createSignal<"id" | "extends" | "auth-method" | "apikey" | "oauth">(
    props.mode === "create" ? "id" : hasOauth() ? "auth-method" : "apikey",
  )
  const [profileId, setProfileId] = createSignal(props.profileId ?? "")
  const [extendsId, setExtendsId] = createSignal(existing()?.extends ?? "")
  const [oauthMethodIndex, setOauthMethodIndex] = createSignal(0)
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

  const saveConfig = async (id: string) => {
    const ext = extendsId() || props.providerType

    // Check for cycles before saving
    if (ext && detectCycle(id, ext, providers())) {
      toast.error("Extending this profile would create a circular dependency")
      return false
    }

    const config = {
      name: props.providerName,
      extends: ext,
      options: {},
    }

    // Update config
    await sdk.client.config.update({
      config: { provider: { [id]: config } },
    })

    return true
  }

  const save = async (apiKey: string) => {
    if (saving()) return
    setSaving(true)

    const id = props.mode === "edit" ? props.profileId! : profileId()

    if (!(await saveConfig(id))) {
      setSaving(false)
      return
    }

    // Save API key separately if provided
    if (apiKey.trim()) {
      await sdk.client.auth.set({
        providerID: id,
        auth: { type: "api", key: apiKey.trim() },
      })
    }

    await sdk.client.instance.dispose()
    await sync.bootstrap()

    dialog.replace(() => <DialogModel providerID={props.providerType} />)
  }

  const startOauth = async (methodIndex: number) => {
    const id = props.mode === "edit" ? props.profileId! : profileId()

    if (!(await saveConfig(id))) {
      return
    }

    setOauthMethodIndex(methodIndex)
    const result = await sdk.client.provider.oauth.authorize({
      providerID: id,
      method: methodIndex,
      baseProvider: props.providerType,
    })

    if (result.data?.method === "code") {
      setStep("oauth")
    }
    if (result.data?.method === "auto") {
      setStep("oauth")
    }
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
            // Go to auth method selection if OAuth available, otherwise API key
            setStep(hasOauth() ? "auth-method" : "apikey")
          } else {
            setStep("extends")
          }
        }}
        description={() => <text fg={theme.textMuted}>Lowercase letters, numbers, hyphens, or underscores</text>}
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
          // Go to auth method selection if OAuth available, otherwise API key
          setStep(hasOauth() ? "auth-method" : "apikey")
        }}
      />
    )
  }

  // Step 3: Auth method selection (if OAuth available)
  if (step() === "auth-method") {
    const options = createMemo(() => {
      const result: { title: string; value: string; index?: number }[] = []

      // Add OAuth options
      for (let i = 0; i < oauthMethods().length; i++) {
        const method = oauthMethods()[i]
        result.push({
          title: `Login with ${method.label}`,
          value: `oauth-${i}`,
          index: i,
        })
      }

      // Add API key option
      result.push({
        title: "Use API Key",
        value: "apikey",
      })

      return result
    })

    return (
      <DialogSelect
        title="Authentication method"
        options={options()}
        onSelect={(option) => {
          if (option.value === "apikey") {
            setStep("apikey")
          } else {
            const methodIndex = (option as { index?: number }).index ?? 0
            startOauth(methodIndex)
          }
        }}
      />
    )
  }

  // Step 4: OAuth flow
  if (step() === "oauth") {
    const id = props.mode === "edit" ? props.profileId! : profileId()
    return (
      <ProfileOauthFlow
        profileId={id}
        providerType={props.providerType}
        methodIndex={oauthMethodIndex()}
        onComplete={() => {
          dialog.replace(() => <DialogModel providerID={props.providerType} />)
        }}
      />
    )
  }

  // Step 5: API Key
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
      description={description ? () => <text fg={theme.textMuted}>{description}</text> : undefined}
    />
  )
}

interface ProfileOauthFlowProps {
  profileId: string
  providerType: string
  methodIndex: number
  onComplete: () => void
}

function ProfileOauthFlow(props: ProfileOauthFlowProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()

  const [authorization, setAuthorization] = createSignal<ProviderAuthAuthorization | null>(null)
  const [error, setError] = createSignal(false)

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const auth = authorization()
      if (!auth) return
      const code = auth.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? auth.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    // Start OAuth flow
    const result = await sdk.client.provider.oauth.authorize({
      providerID: props.profileId,
      method: props.methodIndex,
      baseProvider: props.providerType,
    })

    if (!result.data) {
      setError(true)
      return
    }

    setAuthorization(result.data)

    // For auto method, wait for callback
    if (result.data.method === "auto") {
      const callbackResult = await sdk.client.provider.oauth.callback({
        providerID: props.profileId,
        method: props.methodIndex,
      })
      if (callbackResult.error) {
        setError(true)
        return
      }
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      props.onComplete()
    }
  })

  const auth = authorization()

  if (error()) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <text fg={theme.error}>OAuth authorization failed</text>
      </box>
    )
  }

  if (!auth) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <text fg={theme.textMuted}>Starting OAuth flow...</text>
      </box>
    )
  }

  // Code method - need user to enter code
  if (auth.method === "code") {
    return (
      <DialogPrompt
        title="Enter authorization code"
        placeholder="Enter code from browser"
        onConfirm={async (code) => {
          const result = await sdk.client.provider.oauth.callback({
            providerID: props.profileId,
            method: props.methodIndex,
            code,
          })
          if (result.error) {
            setError(true)
            return
          }
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          props.onComplete()
        }}
        description={() => (
          <box gap={1}>
            <Link href={auth.url} fg={theme.primary} />
            <text fg={theme.textMuted}>{auth.instructions}</text>
          </box>
        )}
      />
    )
  }

  // Auto method - waiting for authorization
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Authorize Profile
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <Link href={auth.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{auth.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}
