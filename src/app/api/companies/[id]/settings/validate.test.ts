/**
 * Phase 7.I — Zod validator tests for per-industry Company.settings.
 */

import { describe, it, expect } from "vitest"
import {
  AgroCropsSettingsSchema,
  HospitalitySettingsSchema,
  FoodProcessingSettingsSchema,
  GenericSettingsSchema,
  settingsSchemaForIndustry,
} from "./validate"

describe("AgroCropsSettingsSchema", () => {
  it("accepts the canonical AzerSheker EDEN settings shape", () => {
    const r = AgroCropsSettingsSchema.safeParse({
      hectaresPlanted: 12000,
      region: "salyan",
      cropType: "sugarcane",
      yieldTarget: 65,
    })
    expect(r.success).toBe(true)
  })

  it("rejects unknown region (must match weather adapter table)", () => {
    const r = AgroCropsSettingsSchema.safeParse({
      hectaresPlanted: 12000,
      region: "neverland",
    })
    expect(r.success).toBe(false)
  })

  it("rejects negative hectares (impossible value)", () => {
    expect(
      AgroCropsSettingsSchema.safeParse({ hectaresPlanted: -1 }).success,
    ).toBe(false)
  })

  it("allows partial submission (all fields optional)", () => {
    expect(AgroCropsSettingsSchema.safeParse({}).success).toBe(true)
    expect(
      AgroCropsSettingsSchema.safeParse({ region: "imishli" }).success,
    ).toBe(true)
  })

  it("rejects unknown crop type (must match enum)", () => {
    expect(
      AgroCropsSettingsSchema.safeParse({ cropType: "fish" }).success,
    ).toBe(false)
  })
})

describe("HospitalitySettingsSchema", () => {
  it("accepts a hotel with rooms + season profile", () => {
    const r = HospitalitySettingsSchema.safeParse({
      totalRooms: 220,
      seasonalityProfile: "summer_peak",
      region: "Baku",
    })
    expect(r.success).toBe(true)
  })

  it("rejects totalRooms 0 (every hotel has at least 1)", () => {
    expect(HospitalitySettingsSchema.safeParse({ totalRooms: 0 }).success).toBe(false)
  })

  it("rejects unrecognized seasonality profile", () => {
    expect(
      HospitalitySettingsSchema.safeParse({ seasonalityProfile: "monsoon" })
        .success,
    ).toBe(false)
  })
})

describe("FoodProcessingSettingsSchema", () => {
  it("accepts an AZSF-shaped sugar refinery config", () => {
    const r = FoodProcessingSettingsSchema.safeParse({
      processingCapacityTonsYr: 50000,
      extractionRateTarget: 88,
      mainInputCommodity: "sugarcane",
    })
    expect(r.success).toBe(true)
  })

  it("rejects extraction rate above 100%", () => {
    expect(
      FoodProcessingSettingsSchema.safeParse({ extractionRateTarget: 101 })
        .success,
    ).toBe(false)
  })
})

describe("GenericSettingsSchema", () => {
  it("accepts a small key-value bag", () => {
    expect(
      GenericSettingsSchema.safeParse({ foo: "bar", n: 42, flag: true })
        .success,
    ).toBe(true)
  })

  it("rejects more than 32 keys (defensive blob cap)", () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 40; i += 1) big[`k${i}`] = "v"
    expect(GenericSettingsSchema.safeParse(big).success).toBe(false)
  })

  it("rejects nested objects (primitive-only)", () => {
    expect(
      GenericSettingsSchema.safeParse({ a: { nested: "thing" } }).success,
    ).toBe(false)
  })
})

describe("settingsSchemaForIndustry — dispatch", () => {
  it("dispatches to agro_crops schema for agro_crops industry", () => {
    const s = settingsSchemaForIndustry("agro_crops")
    expect(s.safeParse({ region: "salyan", hectaresPlanted: 5000 }).success).toBe(true)
    expect(s.safeParse({ totalRooms: 100 }).success).toBe(false) // hospitality field
  })

  it("dispatches to hospitality schema for hospitality industry", () => {
    const s = settingsSchemaForIndustry("hospitality")
    expect(s.safeParse({ totalRooms: 100 }).success).toBe(true)
  })

  it("uses generic schema for unknown industries", () => {
    const s = settingsSchemaForIndustry("renewables")
    expect(s.safeParse({ panelCount: 1000, region: "Sumqayit" }).success).toBe(true)
  })

  it("uses generic schema for null industry (defensive)", () => {
    const s = settingsSchemaForIndustry(null)
    expect(s.safeParse({}).success).toBe(true)
  })
})
