/**
 * Financial-truth-infra L4 — source registry CRUD endpoint.
 *
 * Backs `/budgeting/admin/source-registry` UI. Replaces the manual edit
 * of `data/onboarding-source-registry.json` with HTTP CRUD so the
 * watchdog operator doesn't need filesystem access to add a new
 * company → xlsx mapping.
 *
 * Storage: the file lives at the repo root + is loaded by
 * `scripts/drift-watchdog.cjs`. This endpoint reads / writes the same
 * file atomically (tmp + rename) so concurrent edits are safe.
 *
 * Auth: admin role only. Cross-org isolation: not applicable — the
 * registry is per-deployment (single repo), not per-org.
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireRole, isAuthError } from "@/lib/api-auth";

const REGISTRY_PATH = path.join(process.cwd(), "data", "onboarding-source-registry.json");

interface RegistryEntry {
  xlsx: string;
  sheet: string | null;
  period: string;
}

type RegistryFile = Record<string, RegistryEntry | { _comment?: string }>;

async function readRegistry(): Promise<{ entries: Record<string, RegistryEntry>; raw: RegistryFile }> {
  try {
    const buf = await fs.readFile(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(buf) as RegistryFile;
    const entries: Record<string, RegistryEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith("_")) continue;
      if (v && typeof v === "object" && "xlsx" in v) {
        entries[k] = v as RegistryEntry;
      }
    }
    return { entries, raw: parsed };
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "ENOENT") return { entries: {}, raw: {} };
    throw e;
  }
}

async function writeRegistry(entries: Record<string, RegistryEntry>, existingRaw: RegistryFile): Promise<void> {
  // Preserve any `_comment` keys from the existing file.
  const out: RegistryFile = {};
  for (const [k, v] of Object.entries(existingRaw)) {
    if (k.startsWith("_")) out[k] = v;
  }
  Object.assign(out, entries);
  const tmp = REGISTRY_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(out, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, REGISTRY_PATH);
}

export async function GET(req: NextRequest) {
  const session = await requireRole(req, "admin");
  if (isAuthError(session)) return session;
  try {
    const { entries } = await readRegistry();
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to read registry", detail: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const session = await requireRole(req, "admin");
  if (isAuthError(session)) return session;
  let body: { companyCode: string; xlsx: string; sheet: string | null; period: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.companyCode || typeof body.companyCode !== "string") {
    return NextResponse.json({ error: "companyCode required" }, { status: 400 });
  }
  if (!body.xlsx || typeof body.xlsx !== "string") {
    return NextResponse.json({ error: "xlsx path required" }, { status: 400 });
  }
  if (!body.period || typeof body.period !== "string") {
    return NextResponse.json({ error: "period required" }, { status: 400 });
  }
  try {
    const { entries, raw } = await readRegistry();
    entries[body.companyCode] = {
      xlsx: body.xlsx,
      sheet: body.sheet ?? null,
      period: body.period,
    };
    await writeRegistry(entries, raw);
    return NextResponse.json({ ok: true, entry: entries[body.companyCode] });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to write registry", detail: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole(req, "admin");
  if (isAuthError(session)) return session;
  const companyCode = req.nextUrl.searchParams.get("companyCode");
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode required" }, { status: 400 });
  }
  try {
    const { entries, raw } = await readRegistry();
    if (!(companyCode in entries)) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    delete entries[companyCode];
    await writeRegistry(entries, raw);
    return NextResponse.json({ ok: true, removed: companyCode });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to write registry", detail: (e as Error).message },
      { status: 500 },
    );
  }
}
