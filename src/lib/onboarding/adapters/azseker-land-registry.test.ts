import { describe, it, expect } from "vitest"
import { parseLandRegistryFromAoa } from "./azseker-land-registry"

const HEADER = [
  "S/S",
  "Qeydiyyat nömrəsi",
  "Yüklü edilən əmlakın reyestr nömrəsi",
  "Qeydiyyat tarixi",
  "Bələdiyyə",
  "Şirkətin əvvəlki adı",
  "Əsas öhdəliyin mahiyyəti",
  "Torpaq sahəsinin ölçüsü -ha",
  "İllik ödənişi",
  "Müddəti",
  "Yüklü edilən torpaq sahəsinin kateqoriya",
  "Daşınmaz əmlak üzərində qüvvədə olan dig",
  "Ünvanı",
]

describe("parseLandRegistryFromAoa", () => {
  it("parses real-world layout (Ağcabədi 4800 ha parcel)", () => {
    const aoa: unknown[][] = [
      ['"EDEN AGRO" MƏHDUD MƏSULİYYƏTLİ CƏMİYYƏT'],
      HEADER,
      [
        1,
        "1725022423",
        "608011001798",
        "31.10.2025",
        "Ağcabədi rayon İcra Hakimiyyəti",
        "Əkinçi BOFT MMC",
        "Ağcabədi rayon İHB-nın 11.07.2017-ci il sərəncamı",
        4800,
        72000,
        "11.07.2017-49 (qırx doqquz ) il",
        "Ehtiyat fondu torpaqları",
        "İcarə",
        "Ağcabədi rayon, ərazisi 4800 ha torpaq sahəsi",
      ],
    ]
    const result = parseLandRegistryFromAoa(aoa)
    expect(result.parcels).toHaveLength(1)
    const p = result.parcels[0]
    expect(p.hectares).toBe(4800)
    expect(p.annualRentAzn).toBe(72000)
    expect(p.previousOwner).toBe("Əkinçi BOFT MMC")
    expect(p.region).toBe("Ağcabədi")
    expect(p.registrationDate).toBe("2025-10-31")
    expect(p.leaseStart).toBe("2017-07-11")
    expect(p.leaseEnd).toBe("2066-07-11") // 2017 + 49 years
    expect(p.rightsGranted).toBe("İcarə")
  })

  it("parses date-range term correctly", () => {
    const aoa: unknown[][] = [
      [],
      HEADER,
      [
        7,
        "1725022433",
        "607011001506",
        "31.10.2025",
        "Beyləqan rayon İcra Hakimiyyəti",
        "Qarabağ Taxıl MMC",
        "",
        263.36,
        18500,
        "23.08.2012-23.08.2061",
        "Ehtiyat fondu torpaqları",
        "İcarə, İcarə",
        "Beyləqan rauyonu, ərazisi 263.36 ha torpaq sahəsi",
      ],
    ]
    const result = parseLandRegistryFromAoa(aoa)
    const p = result.parcels[0]
    expect(p.leaseStart).toBe("2012-08-23")
    expect(p.leaseEnd).toBe("2061-08-23")
    expect(p.region).toBe("Beyləqan")
  })

  it("totals hectares and annual rent across all parcels", () => {
    const aoa: unknown[][] = [
      [],
      HEADER,
      [
        1,
        "r1",
        "a1",
        "31.10.2025",
        "Ağcabədi rayon İcra Hakimiyyəti",
        "Qarabağ Taxıl MMC",
        "",
        100,
        5000,
        "01.01.2020-01.01.2070",
        "cat",
        "İcarə",
        "Ağcabədi rayon, 100 ha",
      ],
      [
        2,
        "r2",
        "a2",
        "31.10.2025",
        "Beyləqan rayon İcra Hakimiyyəti",
        "Qarabağ Taxıl MMC",
        "",
        250,
        15000,
        "01.01.2020-01.01.2070",
        "cat",
        "İcarə",
        "Beyləqan rayonu, 250 ha",
      ],
    ]
    const result = parseLandRegistryFromAoa(aoa)
    expect(result.totalHectares).toBe(350)
    expect(result.totalAnnualRentAzn).toBe(20000)
  })

  it("stops on Yekun (total) row", () => {
    const aoa: unknown[][] = [
      [],
      HEADER,
      [
        1,
        "r1",
        "a1",
        "31.10.2025",
        "Ağcabədi",
        "X",
        "",
        100,
        5000,
        "01.01.2020-01.01.2070",
        "cat",
        "İcarə",
        "Ağcabədi rayon",
      ],
      ["Yekun", "", "", "", "", "", "", 100, 5000],
      // Anything below should not be parsed
      [
        99,
        "r99",
        "a99",
        "31.10.2025",
        "Yevlax",
        "X",
        "",
        9999,
        9999,
        "",
        "",
        "",
        "Yevlax rayon",
      ],
    ]
    const result = parseLandRegistryFromAoa(aoa)
    expect(result.parcels).toHaveLength(1)
  })

  it("skips zero-hectare rows with warning", () => {
    const aoa: unknown[][] = [
      [],
      HEADER,
      [
        1,
        "r1",
        "a1",
        "31.10.2025",
        "Ağcabədi",
        "X",
        "",
        0,
        0,
        "",
        "",
        "",
        "Ağcabədi rayon",
      ],
    ]
    const result = parseLandRegistryFromAoa(aoa)
    expect(result.parcels).toHaveLength(0)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toMatch(/zero hectares/)
  })
})
