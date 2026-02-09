import { For, Show, createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { Icon } from "@opencode-ai/ui/icon"

export function SessionBreadcrumbs(props: { sessionID: string }) {
  const sync = useSync()
  const navigate = useNavigate()
  const params = useParams()

  const session = createMemo(() => sync.session.get(props.sessionID))

  const ancestry = createMemo(() => {
    const s = session()
    if (!s?.ancestry?.length) return []
    return s.ancestry.map((id) => sync.session.get(id)).filter((x): x is NonNullable<typeof x> => !!x)
  })

  const breadcrumbs = createMemo(() => [...ancestry()].reverse())

  return (
    <Show when={breadcrumbs().length > 0}>
      <nav class="flex items-center gap-1 px-4 py-2 text-sm text-text-weak overflow-x-auto">
        <For each={breadcrumbs()}>
          {(ancestor, index) => (
            <>
              <button
                class="hover:text-text-base hover:underline truncate max-w-[200px]"
                onClick={() => navigate(`/${params.dir}/session/${ancestor.id}`)}
              >
                {ancestor.title || "Untitled"}
              </button>
              <Show when={index() < breadcrumbs().length - 1 || session()}>
                <Icon name="chevron-right" size="small" class="shrink-0 text-text-weaker" />
              </Show>
            </>
          )}
        </For>
        <span class="text-text-base truncate max-w-[200px]">{session()?.title || "Current"}</span>
      </nav>
    </Show>
  )
}
