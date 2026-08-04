/**
 * Structural guard for docs/USER_GUIDE.{en,ru,az}.md — the source of the
 * in-app guide at /guide.
 *
 * 2026-08-04: the three documents had drifted into a state nothing checked.
 * §9.2.5 (FX risk) was printed BEFORE §9.2 and was missing from the contents
 * list entirely; §7.3.6 and §7.3.5 both preceded §7.3; Risk Registry,
 * Compliance, Concentration and FX — all read inside the Risk Terminal — sat
 * at top level as siblings of it; and Trade Tower was stranded after the
 * self-check checklist. The contents list was hand-maintained, so it could
 * disagree with the body without anything failing.
 *
 * These assertions are about SHAPE, not wording: numbering ascends, children
 * nest under their parent, the three languages carry the same skeleton, and
 * every contents link resolves to an anchor the app actually renders.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const LANGS = ["en", "ru", "az"] as const;

/** Byte-identical to slugify() in GuideViewer.tsx — that function decides the
 *  `id` on every rendered heading, so it decides whether a link resolves. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[✀-➿]/g, "")
    .replace(/[\u{1f000}-\u{1f9ff}]/gu, "")
    .replace(/[`~!@#$%^&*()+={}\[\]|\\:;"'<>,.?/]/g, "")
    .replace(/[\s ]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface Heading {
  level: number;
  /** Dotted section number, e.g. "3" or "9.2.5". Null for unnumbered ones. */
  number: string | null;
  raw: string;
}

function readGuide(lang: string) {
  return readFileSync(
    join(process.cwd(), `docs/USER_GUIDE.${lang}.md`),
    "utf8",
  );
}

function headings(md: string): Heading[] {
  // Strip fenced blocks so a `## comment` inside one is not read as a heading,
  // matching what extractToc() does before building the sidebar.
  const withoutCode = md.replace(/```[\s\S]*?```/g, "");
  const out: Heading[] = [];
  for (const line of withoutCode.split("\n")) {
    const m = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    // A number token only counts when it is followed by the title — "### 60
    // saniyədə nə yoxlamaq" is prose that starts with a digit, not §60.
    const numbered = /^((?:\d+\.)+\d+|\d+)\.?\s+\S/.exec(m[2]);
    const isSectionNumber =
      numbered != null && (numbered[1].includes(".") || m[1].length === 2);
    out.push({
      level: m[1].length,
      number: isSectionNumber ? numbered[1] : null,
      raw: m[2],
    });
  }
  return out;
}

function numeric(n: string): number[] {
  return n.split(".").map(Number);
}

/** Lexicographic compare of dotted section numbers: 9.2 < 9.2.5 < 10. */
function compare(a: string, b: string): number {
  const [x, y] = [numeric(a), numeric(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? -1) - (y[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe.each(LANGS)("USER_GUIDE.%s.md structure", (lang) => {
  const md = readGuide(lang);
  const all = headings(md);
  const numbered = all.filter((h) => h.number != null) as Array<
    Heading & { number: string }
  >;

  it("numbers the sections in ascending order", () => {
    const order = numbered.map((h) => h.number);
    const sorted = [...order].sort(compare);
    // Reported as whole lists so a failure names the section that jumped.
    expect(order).toEqual(sorted);
  });

  it("gives every section a unique number", () => {
    const order = numbered.map((h) => h.number);
    expect(new Set(order).size).toBe(order.length);
  });

  it("nests each sub-section under the section it belongs to", () => {
    for (const h of numbered) {
      if (!h.number.includes(".")) {
        expect(h.level, `§${h.number} "${h.raw}" should be an H2`).toBe(2);
        continue;
      }
      const parent = h.number.slice(0, h.number.lastIndexOf("."));
      const parentHeading = numbered.find((p) => p.number === parent);
      expect(parentHeading, `§${h.number} has no parent §${parent}`).toBeDefined();
      expect(
        h.level,
        `§${h.number} "${h.raw}" must sit one level below §${parent}`,
      ).toBeGreaterThan(parentHeading!.level);
    }
  });

  it("points every contents link at an anchor the app renders", () => {
    const ids = new Set(all.map((h) => slugify(h.raw)));
    const dead: string[] = [];
    for (const m of md.matchAll(/\]\(#([^)]+)\)/g)) {
      if (!ids.has(m[1])) dead.push(m[1]);
    }
    expect(dead).toEqual([]);
  });

  it("lists every numbered section in the contents", () => {
    const contents = md.slice(0, md.indexOf("\n## 1."));
    const listed = new Set(
      [...contents.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]),
    );
    const absent = numbered
      .filter((h) => !listed.has(slugify(h.raw)))
      .map((h) => `${h.number} ${h.raw}`);
    expect(absent).toEqual([]);
  });
});

describe("USER_GUIDE — the three languages carry the same skeleton", () => {
  it("numbers the same sections at the same levels", () => {
    const skeleton = (lang: string) =>
      headings(readGuide(lang))
        .filter((h) => h.number != null)
        .map((h) => `${h.number}@h${h.level}`);

    const en = skeleton("en");
    expect(skeleton("ru"), "ru drifted from en").toEqual(en);
    expect(skeleton("az"), "az drifted from en").toEqual(en);
  });

  it("keeps the Risk Terminal chapter carrying its own indicator families", () => {
    // The specific regression this file was written for: these four are read
    // inside the terminal, so they belong under §3, not beside it.
    for (const lang of LANGS) {
      const numbers = headings(readGuide(lang))
        .filter((h) => h.number != null)
        .map((h) => h.number);
      expect(numbers, lang).toEqual(
        expect.arrayContaining(["3.2", "3.3", "3.4", "3.5"]),
      );
    }
  });
});
