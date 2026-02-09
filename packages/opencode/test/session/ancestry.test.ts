import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session ancestry", () => {
  test("root session has empty ancestry and depth 0", async () => {
    await Instance.provide({
      directory: projectRoot,
      async fn() {
        const session = await Session.create({})

        expect(session.ancestry).toEqual([])
        expect(session.depth).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  test("child session has parent in ancestry and depth 1", async () => {
    await Instance.provide({
      directory: projectRoot,
      async fn() {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        expect(child.ancestry).toEqual([parent.id])
        expect(child.depth).toBe(1)

        await Session.remove(child.id)
        await Session.remove(parent.id)
      },
    })
  })

  test("grandchild has full ancestry chain and depth 2", async () => {
    await Instance.provide({
      directory: projectRoot,
      async fn() {
        const grandparent = await Session.create({})
        const parent = await Session.create({ parentID: grandparent.id })
        const grandchild = await Session.create({ parentID: parent.id })

        expect(grandchild.ancestry).toEqual([parent.id, grandparent.id])
        expect(grandchild.depth).toBe(2)

        await Session.remove(grandchild.id)
        await Session.remove(parent.id)
        await Session.remove(grandparent.id)
      },
    })
  })
})
