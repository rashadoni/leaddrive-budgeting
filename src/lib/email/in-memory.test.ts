// @vitest-environment node
/**
 * Phase 7.G Turn LXXIII — guard tests for InMemoryEmailService.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { InMemoryEmailService } from "./in-memory"

describe("InMemoryEmailService", () => {
  let svc: InMemoryEmailService

  beforeEach(() => {
    svc = new InMemoryEmailService()
  })

  it("send returns ok=true with messageId", async () => {
    const result = await svc.send({
      to: { email: "x@y.com" },
      subject: "Hi",
      body: "body",
      lang: "en",
    })
    expect(result.ok).toBe(true)
    expect(result.messageId).toMatch(/^mem-\d+-/)
  })

  it("records sent emails in order", async () => {
    await svc.send({ to: { email: "a@x" }, subject: "1", body: "b1", lang: "en" })
    await svc.send({ to: { email: "b@x" }, subject: "2", body: "b2", lang: "ru" })
    const sent = svc.getSentEmails()
    expect(sent).toHaveLength(2)
    expect(sent[0].subject).toBe("1")
    expect(sent[1].subject).toBe("2")
    expect(sent[1].lang).toBe("ru")
  })

  it("preserves multi-recipient list", async () => {
    await svc.send({
      to: [{ email: "a@x" }, { email: "b@x" }, { email: "c@x" }],
      subject: "Bulk",
      body: "...",
      lang: "en",
    })
    const sent = svc.getSentEmails()
    expect(Array.isArray(sent[0].to)).toBe(true)
    expect((sent[0].to as Array<{ email: string }>).length).toBe(3)
  })

  it("preserves metadata bag for audit/debugging", async () => {
    await svc.send({
      to: { email: "x@y" },
      subject: "S",
      body: "B",
      lang: "en",
      metadata: { kind: "approval_request_created", requesterUserId: "u1" },
    })
    expect(svc.getSentEmails()[0].metadata).toEqual({
      kind: "approval_request_created",
      requesterUserId: "u1",
    })
  })

  it("clear() empties the log + resets nextId", async () => {
    await svc.send({ to: { email: "x@y" }, subject: "S", body: "B", lang: "en" })
    svc.clear()
    expect(svc.getSentEmails()).toHaveLength(0)
    const result = await svc.send({ to: { email: "x@y" }, subject: "S", body: "B", lang: "en" })
    expect(result.messageId).toMatch(/^mem-1-/) // counter restarted
  })
})
