import { createMemo, Show } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import type { PromptInfo } from "@tui/component/prompt/history"

export interface DialogRewindProps {
  sessionID: string
  messageID: string
  setPrompt?: (prompt: PromptInfo) => void
}

export function DialogRewind(props: DialogRewindProps) {
  const sdk = useSDK()
  const local = useLocal()
  const sync = useSync()

  const hasVcs = createMemo(() => sync.data.vcs !== undefined)
  const session = createMemo(() => sync.data.session.find((s) => s.id === props.sessionID))

  function restorePrompt() {
    if (!props.setPrompt) return
    const parts = sync.data.part[props.messageID]
    if (!parts) return
    const promptInfo = parts.reduce(
      (agg, part) => {
        if (part.type === "text" && !part.synthetic) agg.input += part.text
        if (part.type === "file") agg.parts.push(part)
        return agg
      },
      { input: "", parts: [] as PromptInfo["parts"] },
    )
    props.setPrompt(promptInfo)
  }

  return (
    <Show
      when={!session()?.revert}
      fallback={
        <DialogSelect
          title="Session Already Reverted"
          options={[
            {
              title: "Restore All",
              value: "unrevert",
              description: "Restore previously reverted messages and code",
              onSelect: async (dialog) => {
                await sdk.client.session.unrevert({ sessionID: props.sessionID })
                dialog.clear()
              },
            },
            {
              title: "Cancel",
              value: "cancel",
              description: "Keep current revert state",
              onSelect: (dialog) => dialog.clear(),
            },
          ]}
        />
      }
    >
      <DialogSelect
        title="Rewind to this message"
        options={[
          {
            title: "Restore Everything",
            value: "full",
            description: "Revert code and hide messages from this point",
            disabled: !hasVcs(),
            onSelect: async (dialog) => {
              await sdk.client.session.revert({
                sessionID: props.sessionID,
                messageID: props.messageID,
                mode: "full",
              })
              restorePrompt()
              dialog.clear()
            },
          },
          {
            title: "Conversation Only",
            value: "conversation",
            description: "Hide messages but keep code changes",
            onSelect: async (dialog) => {
              await sdk.client.session.revert({
                sessionID: props.sessionID,
                messageID: props.messageID,
                mode: "conversation",
              })
              restorePrompt()
              dialog.clear()
            },
          },
          {
            title: "Code Only",
            value: "code",
            description: "Revert code but keep conversation visible",
            disabled: !hasVcs(),
            onSelect: async (dialog) => {
              await sdk.client.session.revert({
                sessionID: props.sessionID,
                messageID: props.messageID,
                mode: "code",
              })
              restorePrompt()
              dialog.clear()
            },
          },
          {
            title: "Summarize",
            value: "summarize",
            description: "Compress messages from here into a summary",
            onSelect: async (dialog) => {
              const model = local.model.current()
              if (!model) {
                dialog.clear()
                return
              }
              await sdk.client.session.summarize({
                sessionID: props.sessionID,
                fromMessageID: props.messageID,
                providerID: model.providerID,
                modelID: model.modelID,
              })
              restorePrompt()
              dialog.clear()
            },
          },
        ]}
      />
    </Show>
  )
}
