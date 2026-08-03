/**
 * Financial-truth-infra L4 — source registry CRUD endpoint.
 *
 * Backs `/budgeting/admin/source-registry` UI. Metadata is persisted in
 * PostgreSQL so it survives container replacement and scale-to-zero.
 *
 * Auth: admin role only. Cross-org isolation: not applicable — the
 * registry is per-deployment (single repo), not per-org.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { prismaAdmin } from "@/lib/db/prisma-admin";

interface RegistryEntry {
  xlsx: string;
  sheet: string | null;
  period: string;
}

export async function GET(req: NextRequest) {
  const session = await requireRole(req, "admin");
  if (isAuthError(session)) return session;
  try {
    const rows = await prismaAdmin.sourceRegistryEntry.findMany({
      orderBy: { companyCode: "asc" },
    });
    const entries = Object.fromEntries(
      rows.map((row) => [
        row.companyCode,
        { xlsx: row.xlsx, sheet: row.sheet, period: row.period } satisfies RegistryEntry,
      ]),
    );
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
    const entry = await prismaAdmin.sourceRegistryEntry.upsert({
      where: { companyCode: body.companyCode },
      create: {
        companyCode: body.companyCode,
        xlsx: body.xlsx,
        sheet: body.sheet ?? null,
        period: body.period,
      },
      update: {
        xlsx: body.xlsx,
        sheet: body.sheet ?? null,
        period: body.period,
      },
    });
    return NextResponse.json({
      ok: true,
      entry: { xlsx: entry.xlsx, sheet: entry.sheet, period: entry.period },
    });
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
    const result = await prismaAdmin.sourceRegistryEntry.deleteMany({
      where: { companyCode },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, removed: companyCode });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to write registry", detail: (e as Error).message },
      { status: 500 },
    );
  }
}
