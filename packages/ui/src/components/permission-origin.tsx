import { Show, createMemo, type ComponentProps, splitProps } from "solid-js"
import { Icon } from "./icon"

export interface PermissionOriginProps extends ComponentProps<"button"> {
  originSessionID?: string
  currentSessionID: string
  onNavigate?: (sessionID: string) => void
}

export function PermissionOrigin(props: PermissionOriginProps) {
  const [local, rest] = splitProps(props, ["originSessionID", "currentSessionID", "onNavigate", "class", "classList"])

  const isFromChild = createMemo(() => {
    return local.originSessionID && local.originSessionID !== local.currentSessionID
  })

  return (
    <Show when={isFromChild()}>
      <button
        {...rest}
        data-component="permission-origin"
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
        onClick={() => local.onNavigate?.(local.originSessionID!)}
      >
        <Icon name="square-arrow-top-right" size="small" />
        <span>From subagent</span>
      </button>
    </Show>
  )
}
