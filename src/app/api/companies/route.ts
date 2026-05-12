import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, isAuthError } from '@/lib/api-auth';

// GET: Companies for the caller's organization (roots + 2 levels of descendants)
//
// Phase 7.H — holding-tree depth was bumped from 1 to 2 levels of nested
// `children`. AZMADE's tree is now AZMADE (root) → AAC/ATL/SPARK/ZTP/LLS
// (level=1 sub-groups) → AAC-MAIN/ATL-DBZ/SPARK-MAIN/etc. (level=2 op-cos).
// The previous 1-level fetch surfaced the level=1 sub-groups but dropped
// the op-cos that actually hold BudgetLines — picking SPARK in the
// budgeting dropdown showed "zero" because SPARK-MAIN (its child) was
// the row tagged with the BudgetLines, and SPARK-MAIN never made the
// dropdown. Three-level include covers every holding we currently
// support (AZSEKER is 2-deep, AZMADE is 3-deep). A future 4-level
// holding would need another `children: { include: { children: ... } }`
// hop OR a `?flat=true` opt-in mode.
export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  // defense-in-depth; getSession already filters empty orgId → null → 401
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  try {
    const companies = await prisma.company.findMany({
      where: {
        organizationId: session.orgId,
        parentCompanyId: null,
      },
      include: {
        children: {
          orderBy: { sortOrder: 'asc' },
          include: {
            children: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    // Architect Round-1 closure (Turn 40-sub5 / Turn 42-sub10) —
    // multiple terminal panels self-fetch /api/companies on mount
    // (PanelGrid, RelatedFunctionsMenu, AlertsPanel, ScenarioPanel).
    // Until a shared `useCompanies()` hook lands (separate 🔄), serve
    // a 10s private cache so the browser short-circuits the dup
    // requests within a single user-session burst. Tenant-scoped
    // (per session) so `private` (NOT `public`) — the response body
    // is org-specific and mustn't leak to a shared CDN.
    return NextResponse.json(companies, {
      headers: {
        'Cache-Control': 'private, max-age=10',
      },
    });
  } catch (error) {
    console.error('Error fetching companies:', error);
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 });
  }
}

// POST: Create a company or sub-group in the caller's organization (manager+)
export async function POST(request: NextRequest) {
  const session = await requireRole(request, 'manager');
  if (isAuthError(session)) return session;
  // defense-in-depth; getSession already filters empty orgId → null → 401
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      parentCompanyId,
      code,
      name,
      industry,
      level,
      country,
      baseCurrencyCode,
    } = body;

    if (!code || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Guard: level (if supplied) must be 1 or 2 and consistent with parent presence.
    // Turn 14 reframe: level=2 + parent=null is now legitimate (e.g. AAC is a
    // single operational company directly under AZMADE org, not under any
    // sub-group). The old "level=2 requires parentCompanyId" invariant was
    // dropped — operational entities can sit directly under the org when
    // there's no meaningful intermediate sub-group.
    if (level !== undefined) {
      if (typeof level !== 'number' || (level !== 1 && level !== 2)) {
        return NextResponse.json(
          { error: 'level must be 1 or 2' },
          { status: 400 },
        );
      }
      if (level === 1 && parentCompanyId) {
        return NextResponse.json(
          { error: 'level=1 cannot have a parentCompanyId' },
          { status: 400 },
        );
      }
      // level=2 with parentCompanyId=null is allowed (direct-org-child).
      // level=2 with parentCompanyId set still requires the parent to be
      // resolvable and same-org — checked below.
    }

    // If a parent is specified, ensure it belongs to the caller's org
    if (parentCompanyId) {
      const parent = await prisma.company.findFirst({
        where: { id: parentCompanyId, organizationId: session.orgId },
        select: { id: true },
      });
      if (!parent) {
        return NextResponse.json({ error: 'Invalid parentCompanyId' }, { status: 400 });
      }
    }

    const company = await prisma.company.create({
      data: {
        organizationId: session.orgId,
        parentCompanyId: parentCompanyId || null,
        code,
        name,
        industry: industry || null,
        level: level ?? (parentCompanyId ? 2 : 1),
        country: country || null,
        baseCurrencyCode: baseCurrencyCode || null,
        isActive: true,
      },
    });

    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    console.error('Error creating company:', error);
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 });
  }
}
