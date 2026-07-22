// @vitest-environment happy-dom

import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/../messages/en.json"
import ruMessages from "@/../messages/ru.json"
import azMessages from "@/../messages/az.json"

const MESSAGES: Record<string, unknown> = {
  en: enMessages,
  ru: ruMessages,
  az: azMessages,
}

function lookupAt(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const part of path) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function makeT(locale: string, namespace: string) {
  const namespaceParts = namespace ? namespace.split(".") : []
  const t = (key: string, values?: Record<string, unknown>) => {
    const path = [...namespaceParts, ...key.split(".")]
    const template = lookupAt(MESSAGES[locale], path)
    if (typeof template !== "string") return path.join(".")
    return template.replace(/\{(\w+)\}/g, (_match, name) =>
      values?.[name] === undefined ? `{${name}}` : String(values[name]),
    )
  }
  ;(t as typeof t & { has: (key: string) => boolean }).has = (key: string) =>
    typeof lookupAt(MESSAGES[locale], [...namespaceParts, ...key.split(".")]) === "string"
  return t
}

function event(id: string, ruleId: string, message: string) {
  return {
    id,
    period: "2026",
    ruleId,
    ruleName: "Stored English rule name",
    severity: "critical",
    message,
    messageKey: `alerts.messages.${ruleId}`,
    messageParams: { code: "AAC", redCount: 4 },
    affectedCompanyIds: ["co_a"],
    affectedIndicatorCodes: ["IND_A", "IND_B"],
    emittedAt: "2026-05-05T10:00:00.000Z",
  }
}

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.restoreAllMocks()
})

async function mount(locale: "ru" | "az") {
  vi.resetModules()
  vi.doMock("next-intl", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next-intl")>()
    return {
      ...actual,
      useLocale: () => locale,
      useTranslations: (namespace?: string) => makeT(locale, namespace ?? ""),
    }
  })
  global.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        events: [
          event("built-in", "company-mostly-red", "AAC has 4 red indicators — needs review"),
          event("custom", "custom-risk-rule", "Custom stored source-language text"),
        ],
        nextCursor: null,
        hasMore: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as never

  const { AlertEventsFeed } = await import("./AlertEventsFeed")
  render(<AlertEventsFeed period="2026" />)
  await screen.findAllByTestId("alert-event-row")
}

describe("AlertEventsFeed locale integration", () => {
  it("renders built-in RU message from stored key/params and keeps custom fallback", async () => {
    await mount("ru")
    expect(screen.getByText("AAC: 4 красных индикаторов — требуется проверка")).toBeTruthy()
    expect(screen.getByText("У компании много красных индикаторов", { exact: false })).toBeTruthy()
    expect(screen.queryByText("AAC has 4 red indicators — needs review")).toBeNull()
    expect(screen.getByText("Custom stored source-language text")).toBeTruthy()
  })

  it("renders built-in AZ message from stored key/params and keeps custom fallback", async () => {
    await mount("az")
    expect(screen.getByText("AAC: 4 qırmızı göstərici — yoxlama tələb olunur")).toBeTruthy()
    expect(screen.getByText("Şirkətin çoxsaylı qırmızı göstəriciləri var", { exact: false })).toBeTruthy()
    expect(screen.queryByText("AAC has 4 red indicators — needs review")).toBeNull()
    expect(screen.getByText("Custom stored source-language text")).toBeTruthy()
  })
})
