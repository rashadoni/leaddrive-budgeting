import { describe, it, expect, afterEach } from "vitest"
import { getQueueBackend, isBullMqEnabled } from "./feature-flag"

describe("queue/feature-flag", () => {
  const originalBackend = process.env.QUEUE_BACKEND
  afterEach(() => {
    if (originalBackend === undefined) {
      delete process.env.QUEUE_BACKEND
    } else {
      process.env.QUEUE_BACKEND = originalBackend
    }
  })

  it("defaults to inprocess when env is not set", () => {
    delete process.env.QUEUE_BACKEND
    expect(getQueueBackend()).toBe("inprocess")
    expect(isBullMqEnabled()).toBe(false)
  })

  it("returns bullmq when env set to 'bullmq' (case-insensitive)", () => {
    process.env.QUEUE_BACKEND = "BullMQ"
    expect(getQueueBackend()).toBe("bullmq")
    expect(isBullMqEnabled()).toBe(true)
  })

  it("treats any non-'bullmq' value as inprocess fallback", () => {
    process.env.QUEUE_BACKEND = "rabbitmq"
    expect(getQueueBackend()).toBe("inprocess")
    expect(isBullMqEnabled()).toBe(false)
  })

  it("treats empty string as inprocess", () => {
    process.env.QUEUE_BACKEND = ""
    expect(getQueueBackend()).toBe("inprocess")
  })
})
