import { Show, createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

export function ReturnControlButton(props: { sessionID: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  const session = createMemo(() => sync.session.get(props.sessionID))

  const isSubagent = createMemo(() => !!session()?.parentID)

  const ownership = createMemo(() => {
    return sync.data.session_ownership[props.sessionID]?.owner ?? "agent"
  })

  const showButton = createMemo(() => isSubagent() && ownership() === "user")

  const handleReturn = async () => {
    try {
      await sdk.client.session.signal({
        sessionID: props.sessionID,
        signal: "complete",
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <Show when={showButton()}>
      <Button variant="secondary" class="h-8 px-3 py-1.5" onClick={handleReturn}>
        <Icon name="arrow-up" size="small" class="mr-1.5" />
        Return Control
      </Button>
    </Show>
  )
}
