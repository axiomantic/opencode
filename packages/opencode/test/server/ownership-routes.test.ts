import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Helper to create auth headers for tests
function authHeaders(): HeadersInit {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return {}
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  const encoded = Buffer.from(`${username}:${password}`).toString("base64")
  return { Authorization: `Basic ${encoded}` }
}

describe("session ownership routes", () => {
  test("GET /session/:sessionID/ownership returns owner 'agent' by default", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        const response = await app.request(`/session/${session.id}/ownership`, {
          headers: authHeaders(),
        })
        expect(response.status).toBe(200)

        const body = await response.json()
        expect(body.owner).toBe("agent")
        expect(body.sessionID).toBe(session.id)
      },
    })
  })

  test("POST /session/:sessionID/signal accepts complete signal and returns success", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        const response = await app.request(`/session/${session.id}/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ signal: "complete" }),
        })
        expect(response.status).toBe(200)

        const body = await response.json()
        expect(body.success).toBe(true)
      },
    })
  })

  test("GET /session/ownership lists all ownership states", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        const response = await app.request("/session/ownership", {
          headers: authHeaders(),
        })
        expect(response.status).toBe(200)

        const body = await response.json()
        expect(body.data).toBeInstanceOf(Array)
      },
    })
  })
})
