import type { JSX } from "solid-js"
import { VList, type VListHandle } from "virtua/solid"

type Message = { id: string; role: string }

export type VirtualizedMessageListHandle = {
  scrollToIndex: (index: number, opts?: { align?: "start" | "center" | "end" | "nearest" }) => void
}

export function VirtualizedMessageList<T extends Message>(props: {
  messages: T[]
  renderMessage: (message: T) => JSX.Element
  overscan?: number
  ref?: (handle: VirtualizedMessageListHandle) => void
}) {
  let listRef: VListHandle | undefined

  const handle: VirtualizedMessageListHandle = {
    scrollToIndex: (index, opts) => listRef?.scrollToIndex(index, opts),
  }

  if (props.ref) props.ref(handle)

  return (
    <VList ref={(r) => (listRef = r)} data={props.messages} overscan={props.overscan ?? 4}>
      {(message) => props.renderMessage(message)}
    </VList>
  )
}
