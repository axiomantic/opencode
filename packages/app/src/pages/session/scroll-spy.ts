import { createSignal } from "solid-js"

type Position = { top: number; height: number }

export function createScrollSpy() {
  const positions = new Map<string, Position>()
  const [activeId, setActiveId] = createSignal<string>()

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
    },

    updateScroll(scrollTop: number) {
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
  }
}
