import { describe, expect, it } from "vitest";

import {
  codeFromName,
  deriveDimensionPlan,
  findHeaderRow,
  guessChannelType,
  normalizeHeader,
  parseMasterCells,
  type OutletRow,
} from "./master-import";

describe("normalizeHeader", () => {
  it("folds Turkish/Azeri dotted İ before lowercasing", () => {
    // 'İ'.toLowerCase() === "i̇" — the naive path would never match.
    expect(normalizeHeader("Stok Adİ")).toBe("stok adi");
    expect(normalizeHeader("BÖLGƏ")).toBe("bölgə");
  });

  it("collapses whitespace and strips trailing colons", () => {
    expect(normalizeHeader("  Cari   Kodu : ")).toBe("cari kodu");
  });
});

describe("codeFromName", () => {
  it("transliterates Azeri characters and slugs to uppercase", () => {
    expect(codeFromName("Bakı-Mərkəz")).toBe("BAKI_MERKEZ");
    expect(codeFromName("Gəncə")).toBe("GENCE");
    expect(codeFromName("Şəki  zona 2")).toBe("SEKI_ZONA_2");
  });
});

describe("guessChannelType", () => {
  it("classifies channel names", () => {
    expect(guessChannelType("Modern Trade")).toBe("modern_trade");
    expect(guessChannelType("HoReCa")).toBe("horeca");
    expect(guessChannelType("Topdan satış")).toBe("wholesale");
    expect(guessChannelType("Ənənəvi ticarət")).toBe("traditional");
  });
});

const OUTLET_CELLS: unknown[][] = [
  ["MARS OVERSEAS BAKU — MÜŞTƏRİ SİYAHISI"], // title row (must be skipped)
  [],
  ["Cari Kodu", "Cari Adı", "VÖEN", "Bölgə", "Kanal", "Plasiyer", "Şəbəkə"],
  ["C001", "Araz Market Nizami", "1234567890", "Bakı", "Modern Trade", "R01", "ARAZ"],
  ["C002", "Tut açarı köşkü", "", "Gəncə", "Ənənəvi", "R02", ""],
  ["C003", "", "", "Bakı", "Ənənəvi", "", ""], // missing name -> row error
  ["C001", "Dup kod", "", "Bakı", "Modern Trade", "", ""], // duplicate code
  [],
];

describe("parseMasterCells — outlets", () => {
  const parsed = parseMasterCells("master_outlets", OUTLET_CELLS);

  it("finds the header row below title rows", () => {
    expect(parsed.headerRowIndex).toBe(2);
  });

  it("parses valid rows and drops empty optionals", () => {
    expect(parsed.rows).toHaveLength(2);
    const first = parsed.rows[0] as OutletRow;
    expect(first).toMatchObject({
      externalCode: "C001",
      name: "Araz Market Nizami",
      taxId: "1234567890",
      regionName: "Bakı",
      channelName: "Modern Trade",
      repCode: "R01",
      chainCode: "ARAZ",
    });
    const second = parsed.rows[1] as OutletRow;
    expect(second.taxId).toBeUndefined();
    expect(second.repCode).toBe("R02");
  });

  it("reports row-level errors with 1-based row numbers", () => {
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]).toMatchObject({ row: 6 });
    expect(parsed.errors[0].message).toContain("name");
    expect(parsed.errors[1].message).toContain('Duplicate code "C001"');
  });
});

describe("parseMasterCells — header failures", () => {
  it("fails loudly when no header row is recognizable", () => {
    const parsed = parseMasterCells("master_skus", [["foo", "bar"], ["1", "2"]]);
    expect(parsed.headerRowIndex).toBe(-1);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0].message).toContain("Header row not recognized");
  });

  it("fails when a required column is absent", () => {
    // brand+category present, code+name missing -> matched 2 fields, but
    // required columns are reported.
    const parsed = parseMasterCells("master_skus", [
      ["Brend", "Kateqoriya"],
      ["Pepsi", "CSD"],
    ]);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors[0].message).toContain("Missing required column");
    expect(parsed.errors[0].message).toContain("externalCode");
  });
});

describe("parseMasterCells — skus with Mikro-style headers", () => {
  it("maps Stok Kodu / Stok Adı / Marka / Grup", () => {
    const parsed = parseMasterCells("master_skus", [
      ["Stok Kodu", "Stok Adı", "Marka", "Grup", "Barkod", "Ambalaj"],
      ["S1", "Pepsi 1L", "Pepsi", "CSD", "869000000", "1L PET"],
    ]);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows[0]).toMatchObject({
      externalCode: "S1",
      name: "Pepsi 1L",
      brand: "Pepsi",
      category: "CSD",
      barcode: "869000000",
      packageSize: "1L PET",
    });
  });
});

describe("deriveDimensionPlan", () => {
  it("derives distinct regions/channels/rep codes from outlet rows", () => {
    const parsed = parseMasterCells("master_outlets", OUTLET_CELLS);
    const plan = deriveDimensionPlan("master_outlets", parsed.rows);
    expect(plan.regions).toEqual([
      { code: "BAKI", name: "Bakı" },
      { code: "GENCE", name: "Gəncə" },
    ]);
    expect(plan.channels).toEqual([
      { code: "MODERN_TRADE", name: "Modern Trade", channelType: "modern_trade" },
      { code: "ENENEVI", name: "Ənənəvi", channelType: "traditional" },
    ]);
    expect(plan.referencedRepCodes.sort()).toEqual(["R01", "R02"]);
  });
});

describe("findHeaderRow", () => {
  it("requires at least 2 matched fields", () => {
    expect(findHeaderRow("master_reps", [["Kod"], ["R1"]])).toBeNull();
  });
});
