import { describe, expect, test } from "bun:test"
import { createScrollSpy } from "./scroll-spy"
import { createRoot } from "solid-js"

describe("createScrollSpy", () => {
  test("tracks active message id", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const spy = createScrollSpy()

        spy.register("msg-1", { top: 0, height: 100 })
        spy.register("msg-2", { top: 100, height: 100 })
        spy.register("msg-3", { top: 200, height: 100 })

        spy.updateScroll(0)
        expect(spy.activeId()).toBe("msg-1")

        spy.updateScroll(150)
        expect(spy.activeId()).toBe("msg-2")

        dispose()
        resolve()
      })
    })
  })

  test("unregister removes message", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const spy = createScrollSpy()

        spy.register("msg-1", { top: 0, height: 100 })
        spy.unregister("msg-1")

        expect(spy.activeId()).toBeUndefined()

        dispose()
        resolve()
      })
    })
  })

  test("supports IntersectionObserver mode", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const spy = createScrollSpy({ useObserver: true })

        expect(spy.observe).toBeDefined()
        expect(spy.unobserve).toBeDefined()

        dispose()
        resolve()
      })
    })
  })

  test("supports resize observation", async () => {
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const spy = createScrollSpy({ useObserver: true })

        expect(spy.observeResize).toBeDefined()

        dispose()
        resolve()
      })
    })
  })
})
