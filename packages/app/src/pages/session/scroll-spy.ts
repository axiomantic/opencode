import { createSignal, onCleanup } from "solid-js"

type Position = { top: number; height: number }
type Options = { useObserver?: boolean; root?: HTMLElement }

export function createScrollSpy(options: Options = {}) {
  const positions = new Map<string, Position>()
  const intersections = new Map<string, number>()
  const [activeId, setActiveId] = createSignal<string>()

  let observer: IntersectionObserver | undefined

  if (options.useObserver && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId
          if (!id) continue
          intersections.set(id, entry.intersectionRatio)
        }

        let best: string | undefined
        let ratio = 0

        for (const [id, r] of intersections) {
          if (r > ratio) {
            ratio = r
            best = id
          }
        }

        if (best && best !== activeId()) {
          setActiveId(best)
        }
      },
      {
        root: options.root ?? null,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    )

    onCleanup(() => observer?.disconnect())
  }

  const findActive = (scrollTop: number) => {
    let active: string | undefined
    let closest = Infinity

    for (const [id, pos] of positions) {
      const distance = Math.abs(pos.top - scrollTop)
      if (pos.top <= scrollTop + 100 && distance < closest) {
        closest = distance
        active = id
      }
    }

    return active
  }

  return {
    register(id: string, position: Position) {
      positions.set(id, position)
    },

    unregister(id: string) {
      positions.delete(id)
      intersections.delete(id)
    },

    observe(element: HTMLElement) {
      observer?.observe(element)
    },

    unobserve(element: HTMLElement) {
      observer?.unobserve(element)
    },

    updateScroll(scrollTop: number) {
      if (observer) return
      const active = findActive(scrollTop)
      if (active !== activeId()) {
        setActiveId(active)
      }
    },

    activeId,

    refresh(getPosition: (id: string) => Position | undefined) {
      for (const id of positions.keys()) {
        const pos = getPosition(id)
        if (pos) positions.set(id, pos)
      }
    },

    dispose() {
      observer?.disconnect()
    },
  }
}
