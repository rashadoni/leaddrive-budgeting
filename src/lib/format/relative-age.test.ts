/**
 * The bucket edges are the whole contract. Five surfaces used to disagree
 * about them; these assertions are what "they now agree" means, so they are
 * written at the exact boundary minutes (0, 1, 59, 60, 1439, 1440) rather
 * than at comfortable values in the middle of each range.
 *
 * The az/ru/en wording itself is pinned by the catalogue guard and the
 * placeholder-parity guard in src/lib/i18n/ — this file pins the selection
 * logic, and asserts against message KEYS so it cannot pass while the
 * catalogue says something else.
 */
import { describe, it, expect } from "vitest"
import {
  bucketRelativeAge,
  formatRelativeAge,
  minutesSince,
} from "./relative-age"
import en from "../../../messages/en.json"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"

/** Echoes the key back so a test can assert which message was chosen. */
const key: (k: string, v?: Record<string, string | number>) => string = (
  k,
  v,
) => (v ? `${k}(${JSON.stringify(v)})` : k)

describe("bucketRelativeAge — bucket boundaries", () => {
  it("0 minutes is justNow, not '0 minutes ago'", () => {
    expect(bucketRelativeAge(0)).toEqual({ bucket: "justNow", n: 0 })
  })

  it("1 minute is the first minutes value", () => {
    expect(bucketRelativeAge(1)).toEqual({ bucket: "minutes", n: 1 })
  })

  it("59 minutes is still minutes", () => {
    expect(bucketRelativeAge(59)).toEqual({ bucket: "minutes", n: 59 })
  })

  it("60 minutes flips to 1 hour", () => {
    expect(bucketRelativeAge(60)).toEqual({ bucket: "hours", n: 1 })
  })

  it("1439 minutes is 23 hours — floored, so it never renders as '24 h'", () => {
    // Math.round(1439 / 60) is 24, which would read as a day inside the
    // hours bucket. This is the case that forces floor over round.
    expect(bucketRelativeAge(1439)).toEqual({ bucket: "hours", n: 23 })
  })

  it("1440 minutes flips to 1 day", () => {
    expect(bucketRelativeAge(1440)).toEqual({ bucket: "days", n: 1 })
  })
})

describe("bucketRelativeAge — inputs that are not clean integers", () => {
  it("floors a fractional minute rather than rounding it up a bucket", () => {
    // Two call sites hold hours as a float and pass hours * 60.
    expect(bucketRelativeAge(0.99)).toEqual({ bucket: "justNow", n: 0 })
    expect(bucketRelativeAge(59.99)).toEqual({ bucket: "minutes", n: 59 })
    expect(bucketRelativeAge(119.99)).toEqual({ bucket: "hours", n: 1 })
    expect(bucketRelativeAge(1439.99)).toEqual({ bucket: "hours", n: 23 })
  })

  it("clamps a negative age (clock skew) to justNow", () => {
    expect(bucketRelativeAge(-1)).toEqual({ bucket: "justNow", n: 0 })
    expect(bucketRelativeAge(-10_000)).toEqual({ bucket: "justNow", n: 0 })
  })

  it("does not throw on a non-finite age", () => {
    expect(bucketRelativeAge(NaN)).toEqual({ bucket: "justNow", n: 0 })
    expect(bucketRelativeAge(Infinity)).toEqual({ bucket: "justNow", n: 0 })
  })

  it("keeps counting days without an upper bucket", () => {
    expect(bucketRelativeAge(365 * 1440)).toEqual({ bucket: "days", n: 365 })
  })
})

describe("formatRelativeAge — key selection", () => {
  it("defaults to the long variant and passes n only when the message takes one", () => {
    expect(formatRelativeAge(0, key)).toBe("long.justNow")
    expect(formatRelativeAge(1, key)).toBe('long.minutes({"n":1})')
    expect(formatRelativeAge(59, key)).toBe('long.minutes({"n":59})')
    expect(formatRelativeAge(60, key)).toBe('long.hours({"n":1})')
    expect(formatRelativeAge(1439, key)).toBe('long.hours({"n":23})')
    expect(formatRelativeAge(1440, key)).toBe('long.days({"n":1})')
  })

  it("selects the short variant for the dense terminal chips", () => {
    expect(formatRelativeAge(0, key, "short")).toBe("short.justNow")
    expect(formatRelativeAge(59, key, "short")).toBe('short.minutes({"n":59})')
    expect(formatRelativeAge(60, key, "short")).toBe('short.hours({"n":1})')
    expect(formatRelativeAge(1440, key, "short")).toBe('short.days({"n":1})')
  })
})

describe("formatRelativeAge — against the real catalogues", () => {
  const catalogues = { en, az, ru } as Record<
    string,
    { relativeAge: Record<string, Record<string, string>> }
  >

  /** Resolves "long.hours" against a real locale, interpolating {n}. */
  const real =
    (lang: string): ((k: string, v?: Record<string, string | number>) => string) =>
    (k, v) => {
      const [variant, bucket] = k.split(".")
      const msg = catalogues[lang].relativeAge[variant]?.[bucket]
      if (msg === undefined) throw new Error(`missing relativeAge.${k} in ${lang}`)
      return msg.replace(/\{n\}/g, String(v?.n ?? ""))
    }

  it("renders every bucket in every locale, in both variants", () => {
    for (const lang of ["en", "az", "ru"]) {
      for (const variant of ["long", "short"] as const) {
        for (const minutes of [0, 1, 59, 60, 1439, 1440]) {
          const out = formatRelativeAge(minutes, real(lang), variant)
          expect(out.length, `${lang} ${variant} @${minutes}min`).toBeGreaterThan(0)
          expect(out, `${lang} ${variant} @${minutes}min`).not.toContain("{n}")
        }
      }
    }
  })

  it("uses the unambiguous az hour word — 's' also abbreviates saniyə/second", () => {
    // The disagreement that started this: adminDataSources rendered
    // "{n} s əvvəl" while four other surfaces rendered "{n} saat əvvəl".
    expect(formatRelativeAge(60, real("az"))).toBe("1 saat əvvəl")
    expect(formatRelativeAge(0, real("az"))).toBe("indicə")
    expect(formatRelativeAge(1440, real("az"))).toBe("1 gün əvvəl")
  })

  it("gives every locale a sub-minute answer that is not '0 min ago'", () => {
    // adminDataSources rendered "0 min ago" and adminDriftDashboard
    // "0.0 hours ago" before the migration; neither had a justNow bucket.
    expect(formatRelativeAge(0, real("en"))).toBe("just now")
    expect(formatRelativeAge(0, real("ru"))).toBe("только что")
    expect(formatRelativeAge(0.5, real("en"), "short")).toBe("now")
  })
})

describe("minutesSince", () => {
  const NOW = 1_700_000_000_000

  it("returns null for a missing timestamp so the caller picks its own null wording", () => {
    expect(minutesSince(null, NOW)).toBeNull()
    expect(minutesSince(undefined, NOW)).toBeNull()
    expect(minutesSince("", NOW)).toBeNull()
  })

  it("returns null for an unparseable timestamp", () => {
    expect(minutesSince("not-a-date", NOW)).toBeNull()
  })

  it("returns fractional minutes — the flooring belongs to bucketRelativeAge", () => {
    expect(minutesSince(new Date(NOW - 30_000).toISOString(), NOW)).toBe(0.5)
    expect(minutesSince(new Date(NOW - 90_000).toISOString(), NOW)).toBe(1.5)
  })

  it("composes with bucketRelativeAge at the boundaries", () => {
    const ago = (ms: number) => new Date(NOW - ms).toISOString()
    expect(bucketRelativeAge(minutesSince(ago(59_999), NOW)!)).toEqual({
      bucket: "justNow",
      n: 0,
    })
    expect(bucketRelativeAge(minutesSince(ago(60_000), NOW)!)).toEqual({
      bucket: "minutes",
      n: 1,
    })
    expect(bucketRelativeAge(minutesSince(ago(86_400_000), NOW)!)).toEqual({
      bucket: "days",
      n: 1,
    })
  })

  it("goes negative for a future timestamp, which bucketRelativeAge clamps", () => {
    const future = minutesSince(new Date(NOW + 10_000).toISOString(), NOW)
    expect(future).toBeLessThan(0)
    expect(bucketRelativeAge(future!)).toEqual({ bucket: "justNow", n: 0 })
  })
})
