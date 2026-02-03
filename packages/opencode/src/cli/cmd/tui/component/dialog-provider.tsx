import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2"
import { DialogModel } from "./dialog-model"
import { DialogProfile } from "./dialog-profile"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { getBaseType } from "../util/provider"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const connected = createMemo(() => new Set(sync.data.provider_next.connected))
  const configProviders = createMemo(() => sync.data.config.provider ?? {})

  const options = createMemo(() => {
    type OptionType = {
      title: string
      value: string
      description?: string
      category?: string
      footer?: string
      onSelect: () => void | Promise<void>
    }

    const result: OptionType[] = []

    // Group providers by base type
    const grouped = new Map<string, { base: (typeof sync.data.provider_next.all)[number]; profiles: string[] }>()

    for (const provider of sync.data.provider_next.all) {
      const config = configProviders()[provider.id]
      const baseType = config?.extends ? getBaseType(provider.id, configProviders()) : provider.id

      const existing = grouped.get(baseType)
      if (existing) {
        // This is a profile of an existing base
        if (config?.extends) {
          existing.profiles.push(provider.id)
        }
      } else {
        // This is a new base provider
        grouped.set(baseType, {
          base: provider,
          profiles: [],
        })
      }
    }

    // Sort groups by priority
    const sortedGroups = Array.from(grouped.entries()).sort(
      ([a], [b]) => (PROVIDER_PRIORITY[a] ?? 99) - (PROVIDER_PRIORITY[b] ?? 99),
    )

    for (const [baseType, group] of sortedGroups) {
      const provider = group.base
      const isConnected = connected().has(provider.id)
      const category = baseType in PROVIDER_PRIORITY ? "Popular" : "Other"

      // Add base provider
      result.push({
        title: provider.name,
        value: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(Claude Max or API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
        }[provider.id],
        category,
        footer: isConnected ? "Connected" : undefined,
        onSelect: () => handleProviderSelect(provider.id, provider.name),
      })

      // Add profiles under the base provider
      for (const profileId of group.profiles) {
        const profileConfig = configProviders()[profileId]
        const profileName = profileConfig?.name ?? profileId
        const isProfileConnected = connected().has(profileId)

        result.push({
          title: `  ${profileName}`,
          value: profileId,
          description: `extends ${profileConfig?.extends}`,
          category,
          footer: isProfileConnected ? "Connected" : undefined,
          onSelect: () => handleProviderSelect(profileId, profileName),
        })
      }

      // Add "Add profile" option for connected providers
      if (isConnected) {
        result.push({
          title: "  + Add profile",
          value: `__add_profile__${provider.id}`,
          category,
          onSelect: () => {
            dialog.replace(() => (
              <DialogProfile mode="create" providerType={provider.id} providerName={provider.name} />
            ))
          },
        })
      }
    }

    return result

    async function handleProviderSelect(providerId: string, providerName: string) {
      const methods = sync.data.provider_auth[providerId] ?? [
        {
          type: "api",
          label: "API key",
        },
      ]
      let index: number | null = 0
      if (methods.length > 1) {
        index = await new Promise<number | null>((resolve) => {
          dialog.replace(
            () => (
              <DialogSelect
                title="Select auth method"
                options={methods.map((x, i) => ({
                  title: x.label,
                  value: i,
                }))}
                onSelect={(option) => resolve(option.value)}
              />
            ),
            () => resolve(null),
          )
        })
      }
      if (index == null) return
      const method = methods[index]
      if (method.type === "oauth") {
        const result = await sdk.client.provider.oauth.authorize({
          providerID: providerId,
          method: index,
        })
        if (result.data?.method === "code") {
          dialog.replace(() => (
            <CodeMethod providerID={providerId} title={method.label} index={index} authorization={result.data!} />
          ))
        }
        if (result.data?.method === "auto") {
          dialog.replace(() => (
            <AutoMethod providerID={providerId} title={method.label} index={index} authorization={result.data!} />
          ))
        }
      }
      if (method.type === "api") {
        return dialog.replace(() => <ApiMethod providerID={providerId} title={method.label} />)
      }
    }
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        props.providerID === "opencode" ? (
          <box gap={1}>
            <text fg={theme.textMuted}>
              OpenCode Zen gives you access to all the best coding models at the cheapest prices with a single API key.
            </text>
            <text fg={theme.text}>
              Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
            </text>
          </box>
        ) : undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}
