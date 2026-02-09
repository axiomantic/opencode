import { Component, createMemo, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { useLocal } from "@/context/local"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Button } from "@opencode-ai/ui/button"
import { extractPromptFromParts } from "@/utils/prompt"
import { useLanguage } from "@/context/language"
import type { TextPart as SDKTextPart } from "@opencode-ai/sdk/v2/client"

interface RewindableMessage {
  id: string
  text: string
  time: string
}

interface RewindOption {
  id: string
  title: string
  description: string
  mode: "full" | "conversation" | "code" | "summarize"
  disabled?: boolean
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export const DialogRewind: Component = () => {
  const params = useParams()
  const sync = useSync()
  const sdk = useSDK()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()

  const sessionID = () => params.id ?? ""
  const session = createMemo(() => {
    const id = sessionID()
    return sync.data.session.find((s) => s.id === id)
  })
  const hasVcs = createMemo(() => sync.data.vcs !== undefined)
  const isAlreadyReverted = createMemo(() => !!session()?.revert)

  // Get user messages for selection
  const messages = createMemo((): RewindableMessage[] => {
    const id = sessionID()
    if (!id) return []

    const msgs = sync.data.message[id] ?? []
    const revertID = session()?.revert?.messageID
    const result: RewindableMessage[] = []

    for (const message of msgs) {
      if (message.role !== "user") continue
      // Don't show already-reverted messages
      if (revertID && message.id >= revertID) continue

      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((x): x is SDKTextPart => x.type === "text" && !x.synthetic && !x.ignored)
      if (!textPart) continue

      result.push({
        id: message.id,
        text: textPart.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }

    return result.reverse()
  })

  const restorePrompt = (messageID: string) => {
    const parts = sync.data.part[messageID]
    if (!parts) return
    const restored = extractPromptFromParts(parts, {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })
    prompt.set(restored)
  }

  const handleUnrevert = async () => {
    await sdk.client.session.unrevert({ sessionID: sessionID() })
    prompt.reset()
    dialog.close()
  }

  return (
    <Show
      when={!isAlreadyReverted()}
      fallback={
        <Dialog title={language.t("dialog.rewind.alreadyReverted.title")}>
          <div class="flex flex-col gap-4">
            <p class="text-text-dimmed">{language.t("dialog.rewind.alreadyReverted.description")}</p>
            <div class="flex gap-2">
              <Button onClick={handleUnrevert}>{language.t("dialog.rewind.unrevert")}</Button>
              <Button variant="ghost" onClick={() => dialog.close()}>
                {language.t("common.cancel")}
              </Button>
            </div>
          </div>
        </Dialog>
      }
    >
      <Dialog title={language.t("dialog.rewind.title")} size="large">
        <List
          class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
          search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.rewind.empty")}
          key={(x) => x.id}
          items={messages}
          filterKeys={["text"]}
          onSelect={(item) => {
            if (!item) return
            // Open the mode selection dialog
            dialog.show(() => <DialogRewindMode messageID={item.id} />)
          }}
        >
          {(item) => (
            <div class="w-full flex items-center gap-2">
              <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
              <span class="text-text-dimmed shrink-0 font-normal">{item.time}</span>
            </div>
          )}
        </List>
      </Dialog>
    </Show>
  )
}

// Second dialog: Select rewind mode
const DialogRewindMode: Component<{ messageID: string }> = (props) => {
  const params = useParams()
  const sync = useSync()
  const sdk = useSDK()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()

  const sessionID = () => params.id ?? ""
  const hasVcs = createMemo(() => sync.data.vcs !== undefined)

  const restorePrompt = () => {
    const parts = sync.data.part[props.messageID]
    if (!parts) return
    const restored = extractPromptFromParts(parts, {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })
    prompt.set(restored)
  }

  const handleRevert = async (mode: "full" | "conversation" | "code") => {
    await sdk.client.session.revert({
      sessionID: sessionID(),
      messageID: props.messageID,
      mode,
    })
    restorePrompt()
    dialog.close()
  }

  const handleSummarize = async () => {
    const model = local.model.current()
    if (!model) return
    await sdk.client.session.summarize({
      sessionID: sessionID(),
      fromMessageID: props.messageID,
      providerID: model.provider.id,
      modelID: model.id,
    })
    restorePrompt()
    dialog.close()
  }

  const options = createMemo((): RewindOption[] => [
    {
      id: "full",
      title: language.t("dialog.rewind.full.title"),
      description: language.t("dialog.rewind.full.description"),
      mode: "full",
      disabled: !hasVcs(),
    },
    {
      id: "conversation",
      title: language.t("dialog.rewind.conversation.title"),
      description: language.t("dialog.rewind.conversation.description"),
      mode: "conversation",
    },
    {
      id: "code",
      title: language.t("dialog.rewind.code.title"),
      description: language.t("dialog.rewind.code.description"),
      mode: "code",
      disabled: !hasVcs(),
    },
    {
      id: "summarize",
      title: language.t("dialog.rewind.summarize.title"),
      description: language.t("dialog.rewind.summarize.description"),
      mode: "summarize",
    },
  ])

  return (
    <Dialog title={language.t("dialog.rewind.mode.title")}>
      <List
        class="flex-1 min-h-0"
        emptyMessage=""
        key={(x) => x.id}
        items={options().filter((x) => !x.disabled)}
        onSelect={(item) => {
          if (!item) return
          if (item.mode === "summarize") {
            handleSummarize()
          } else {
            handleRevert(item.mode)
          }
        }}
      >
        {(item) => (
          <div class="w-full flex flex-col gap-0.5 py-1">
            <span class="font-medium">{item.title}</span>
            <span class="text-text-dimmed text-sm">{item.description}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
