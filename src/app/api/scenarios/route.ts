import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch available scenarios for the holding
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('organizationId');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const scenarios = await prisma.scenario.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(scenarios);
  } catch (error: any) {
    console.error('Error fetching scenarios:', error);
    return NextResponse.json({ error: 'Failed to fetch scenarios' }, { status: 500 });
  }
}

// POST: Apply a scenario (Trigger computation with overrides)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { organizationId, scenarioId, period } = body;

    if (!organizationId || !scenarioId || !period) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Fetch the scenario to get the overrides
    const scenario = await prisma.scenario.findUnique({
      where: { id: scenarioId }
    });

    if (!scenario) {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }

    // Here we would push a job to the queue, passing the scenario.overrides
    // For now, return accepted status.
    console.log(`[Queue] Added scenario ${scenario.code} run for org ${organizationId}`);

    return NextResponse.json({ 
      message: 'Scenario execution queued',
      scenarioCode: scenario.code,
      overrides: scenario.overrides
    }, { status: 202 });
  } catch (error: any) {
    console.error('Error applying scenario:', error);
    return NextResponse.json({ error: 'Failed to apply scenario' }, { status: 500 });
  }
}
