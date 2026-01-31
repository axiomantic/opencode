import { type JSX } from "solid-js"
import { VList } from "virtua/solid"

type Session = { id: string; directory: string; time: { created: number } }

export function VirtualizedSessionList<T extends Session>(props: {
  sessions: T[]
  renderSession: (session: T) => JSX.Element
  overscan?: number
}) {
  return (
    <VList data={props.sessions} overscan={props.overscan ?? 3}>
      {(session) => props.renderSession(session)}
    </VList>
  )
}
