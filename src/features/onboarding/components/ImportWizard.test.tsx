// @vitest-environment happy-dom
/**
 * Phase 7.B onboarding wizard regression coverage — locks the
 * select → review → applied state machine + the 3 fetch contracts the
 * wizard speaks (`/api/companies` on mount, `/api/onboarding/import/analyze`
 * on Analyze, `/api/onboarding/import/staging/[id]/apply` on Apply).
 *
 * Why this file matters: ImportWizard.tsx is 800 LOC of stateful UI driving
 * the customer-facing onboarding flow (the ~60-company scale gate per
 * CLAUDE.md). Pre-this-test the component had ZERO test coverage; only
 * `proposal-overrides.test.ts` covered the `buildUserOverrides` /
 * `diffColumnOverrides` pure helpers. A regression in the wizard's state
 * machine (e.g. step transitions, error branches, terminal-staging gate)
 * would slip past CI silently.
 *
 * Test surface (10 cases):
 *   1. Mount fetches `/api/companies` + populates dropdown with operational
 *      companies only (level=2), sorted alphabetically by code.
 *   2. Mount + companies-fetch error renders inline error message.
 *   3. Mount + empty operational companies renders the empty-state message.
 *   4. Submit Analyze with no file disables the button (button gating).
 *   5. Successful analyze → POST FormData(file + companyId + sheetName +
 *      industryHint) → step transitions to "review", proposal renders.
 *   6. Analyze 4xx with availableSheets surfaces sheet-name buttons; clicking
 *      one populates the sheetName input.
 *   7. Review step → role override per column updates editedColumns state +
 *      changed-row gets the amber ring marker.
 *   8. Successful apply → POST FormData(file + userOverrides JSON) → step
 *      transitions to "applied"; AppliedStep renders inserted/deleted/
 *      warnings/rollups stats.
 *   9. Apply 410 (stagingTerminal path) — error message + "Restart from
 *      step 1" button rendered, regular Apply button hidden; clicking
 *      restart resets to step "select".
 *  10. Apply success with `indicatorsStale=true` renders ⚠ recompute
 *      warning banner.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import { ImportWizard } from "./ImportWizard";

// Companies endpoint payload — 3 entries, mix of level=1 (sub-group root,
// MUST be filtered out) + level=2 (operational, MUST appear). One root
// (PARENT-A) embeds two operational children to exercise the two-level
// walk in ImportWizard.tsx:139-145. Sort order in setup is purposely NOT
// alphabetical so the wizard's `localeCompare` sort on render is observed.
const COMPANIES_PAYLOAD = {
  companies: [
    {
      id: "co_root_parent_a",
      code: "ZZ-PARENT-A",
      name: "Parent A (sub-group root)",
      industry: null,
      level: 1,
      children: [
        {
          id: "co_op_b",
          code: "B-OP",
          name: "Operational B",
          industry: "industrial",
          level: 2,
        },
        {
          id: "co_op_a",
          code: "A-OP",
          name: "Operational A",
          industry: "agro_crops",
          level: 2,
        },
      ],
    },
    {
      id: "co_op_solo",
      code: "C-OP",
      name: "Operational C (no parent)",
      industry: "hospitality",
      level: 2,
    },
  ],
};

// Minimal MappingProposal payload — small enough to keep the test
// asserting on shape, not LLM realism. 2 columns: one keeps AI's role
// (sourceIndex=0 → 'code'), one will be edited in the override-flow test
// (sourceIndex=1 → 'skip' → user flips to 'amount:Total').
const PROPOSAL_PAYLOAD = {
  sourceFile: "test.xlsx",
  sourceSheet: "Sheet1",
  columns: [
    {
      sourceIndex: 0,
      role: "code" as const,
      confidence: 0.92,
      reasoning: "Cell values match account-code regex.",
    },
    {
      sourceIndex: 1,
      role: "skip" as const,
      confidence: 0.4,
      reasoning: "Header looked decorative.",
    },
  ],
  anomalies: [],
  overallConfidence: 0.85,
  summary: "Looks like a standard P&L sheet.",
};

const SOURCE_COLUMNS = [
  { sourceIndex: 0, headerText: "KOD" },
  { sourceIndex: 1, headerText: "Description (override candidate)" },
];

const ANALYZE_RESPONSE = {
  stagingId: "staging_test_123",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  proposal: PROPOSAL_PAYLOAD,
  sourceColumns: SOURCE_COLUMNS,
};

const APPLY_RESPONSE_OK = {
  stagingId: "staging_test_123",
  status: "applied" as const,
  year: 2026,
  inserted: 480,
  deleted: 0,
  warnings: 2,
  parentRollupsDropped: 7,
  parentRollupsUnallocated: 1,
  recompute: { ok: 53, unknown: 1, failed: 0, targets: 54 },
  indicatorsStale: false,
};

// --- fetch routing helper -------------------------------------------------
type RouteHandler = (
  init: RequestInit | undefined,
) => Promise<Response> | Response;

interface RouteOverrides {
  companies?: RouteHandler;
  analyze?: RouteHandler;
  apply?: RouteHandler;
}

function installFetchMock(overrides: RouteOverrides = {}): void {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/companies") {
      if (overrides.companies) return overrides.companies(init);
      return new Response(JSON.stringify(COMPANIES_PAYLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u === "/api/onboarding/import/analyze") {
      if (overrides.analyze) return overrides.analyze(init);
      return new Response(JSON.stringify(ANALYZE_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.startsWith("/api/onboarding/import/staging/")) {
      // .../[id]/apply
      if (overrides.apply) return overrides.apply(init);
      return new Response(JSON.stringify(APPLY_RESPONSE_OK), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as never;
}

function makeXlsxFile(name = "test.xlsx"): File {
  return new File(["dummy-bytes"], name, {
    type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ImportWizard — Phase 7.B regression suite", () => {
  it("Mount: fetches /api/companies, filters to level=2, sorts by code", async () => {
    render(<ImportWizard />);

    // Wait for the fetch to resolve + dropdown to populate.
    await waitFor(() => {
      const select = screen.getByLabelText(/Target company/i) as HTMLSelectElement;
      // 1 placeholder option + 3 operational entries (A-OP, B-OP, C-OP).
      // Critically: ZZ-PARENT-A (level=1) MUST be absent.
      expect(select.options.length).toBe(4);
    });

    const select = screen.getByLabelText(/Target company/i) as HTMLSelectElement;
    const optionCodes = Array.from(select.options)
      .slice(1) // drop the placeholder "— pick a company —"
      .map((o) => (o.textContent ?? "").trim());
    // Sort lock: A-OP < B-OP < C-OP via localeCompare; if alphabetical
    // sort regresses or filtering accidentally lets level=1 through, this
    // assertion fails loud.
    expect(optionCodes[0]).toMatch(/^A-OP/);
    expect(optionCodes[1]).toMatch(/^B-OP/);
    expect(optionCodes[2]).toMatch(/^C-OP/);
    expect(
      optionCodes.some((s) => s.includes("ZZ-PARENT-A")),
      "level=1 sub-group must be filtered from operational dropdown",
    ).toBe(false);
  });

  it("Mount: companies-fetch error → inline error message", async () => {
    installFetchMock({
      companies: async () =>
        new Response("Internal Server Error", { status: 500 }),
    });
    render(<ImportWizard />);
    await waitFor(() => {
      // Component surfaces "Failed to load companies: HTTP 500: …"
      expect(
        screen.getByText(/Failed to load companies/i),
      ).toBeTruthy();
    });
  });

  it("Mount: empty operational companies → 'No operational companies' message", async () => {
    installFetchMock({
      companies: async () =>
        new Response(JSON.stringify({ companies: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    render(<ImportWizard />);
    await waitFor(() => {
      expect(
        screen.getByText(/No operational companies in your organization/i),
      ).toBeTruthy();
    });
  });

  it("Step 1: Analyze button DISABLED until companyId + file both set (button-gating contract)", async () => {
    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });

    const submit = screen.getByRole("button", { name: /Analyze with AI/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    // Pick a company — still disabled (no file).
    const select = screen.getByLabelText(/Target company/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "co_op_a" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    // Add a file — now enabled.
    const fileInput = screen.getByLabelText(/xlsx file/i) as HTMLInputElement;
    const file = makeXlsxFile();
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("Step 1 → 2: Analyze success POSTs FormData + transitions to review with proposal rendered", async () => {
    let capturedInit: RequestInit | undefined;
    installFetchMock({
      analyze: async (init) => {
        capturedInit = init;
        return new Response(JSON.stringify(ANALYZE_RESPONSE), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/Sheet name/i), {
      target: { value: "P&L 2026" },
    });
    fireEvent.change(screen.getByLabelText(/Industry hint/i), {
      target: { value: "industrial" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile("real-budget.xlsx")] },
    });

    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));

    // Wait for transition to step 2 — anchor on the unique "AI proposal"
    // header in ReviewStep.
    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });

    // FormData payload contract — load-bearing for the route handler.
    expect(capturedInit?.method).toBe("POST");
    const sentForm = capturedInit?.body;
    expect(sentForm).toBeInstanceOf(FormData);
    const fd = sentForm as FormData;
    expect(fd.get("companyId")).toBe("co_op_a");
    expect(fd.get("sheetName")).toBe("P&L 2026");
    expect(fd.get("industryHint")).toBe("industrial");
    expect(fd.get("file")).toBeInstanceOf(File);
    expect((fd.get("file") as File).name).toBe("real-budget.xlsx");

    // Review step shows the proposal summary + column count.
    expect(screen.getByText(/Looks like a standard P&L sheet/)).toBeTruthy();
    expect(screen.getByText(/Columns \(2\)/)).toBeTruthy();
  });

  it("Step 1 error: 4xx with availableSheets renders sheet buttons; clicking one populates sheetName", async () => {
    installFetchMock({
      analyze: async () =>
        new Response(
          JSON.stringify({
            error: "Multiple sheets — pick one.",
            availableSheets: ["BS 2026", "P&L 2026", "CF 2026"],
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    });

    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));

    await waitFor(() => {
      expect(screen.getByText(/Multiple sheets/)).toBeTruthy();
    });

    // 3 sheet buttons surface — anchored by their text.
    const pnlBtn = screen.getByRole("button", { name: "P&L 2026" });
    expect(pnlBtn).toBeTruthy();

    // Click the P&L 2026 button — sheetName input should populate.
    fireEvent.click(pnlBtn);
    const sheetInput = screen.getByLabelText(/Sheet name/i) as HTMLInputElement;
    expect(sheetInput.value).toBe("P&L 2026");
  });

  it("Step 2 review: role override per column updates select + flags changed row", async () => {
    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));

    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });

    // The wizard renders a <select> per row. Find them via the column
    // headers (KOD + Description). The "Description" column carries the
    // editable role-select with initial value 'skip'.
    const allSelects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Filter to the role selects (each has 'skip' as one of the options
    // and starts in the table — exclude any picker outside the role table).
    const roleSelects = allSelects.filter((s) =>
      Array.from(s.options).some((o) => o.value === "skip"),
    );
    expect(roleSelects.length).toBe(2); // one per column row

    // Row 1 (sourceIndex=1 in PROPOSAL_PAYLOAD) starts as 'skip'. Flip
    // to amount:Total.
    const editableSelect = roleSelects.find((s) => s.value === "skip");
    expect(editableSelect, "expected the skip-row select to exist").toBeTruthy();
    fireEvent.change(editableSelect!, { target: { value: "amount:Total" } });
    expect(editableSelect!.value).toBe("amount:Total");

    // The component visually flags changed selects with an amber ring
    // class — assert the class landed (proves the diff propagated to JSX).
    expect(editableSelect!.className).toMatch(/amber/);
  });

  it("Step 2 → 3: Apply success POSTs to /staging/[id]/apply, transitions to applied with stats", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    installFetchMock({
      apply: async (init) => {
        capturedInit = init;
        return new Response(JSON.stringify(APPLY_RESPONSE_OK), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    // Patch fetch to also record the apply URL (the routing helper
    // doesn't expose the URL by default).
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/staging/")) capturedUrl = u;
      return realFetch(url, init);
    }) as never;

    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));
    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Apply to BudgetLine/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Applied to BudgetLine/i)).toBeTruthy();
    });

    // Apply contract — URL contains the stagingId from the analyze
    // response, body is FormData with the file.
    expect(capturedUrl).toContain("/api/onboarding/import/staging/");
    expect(capturedUrl).toContain("staging_test_123");
    expect(capturedUrl).toContain("/apply");
    expect(capturedInit?.method).toBe("POST");
    const fd = capturedInit?.body as FormData;
    expect(fd.get("file")).toBeInstanceOf(File);

    // Stats render — anchor on the inserted-count value (480 from
    // APPLY_RESPONSE_OK; deliberately distinct from other counts).
    expect(screen.getByText("480")).toBeTruthy();
    // Stat label "Inserted" present.
    expect(screen.getAllByText(/Inserted/i).length).toBeGreaterThan(0);
  });

  it("Step 2 error: Apply 410 → stagingTerminal path renders 'Restart from step 1'; clicking restart returns to step 1", async () => {
    installFetchMock({
      apply: async () =>
        new Response(
          JSON.stringify({
            error: "Staging row no longer valid (expired or applied).",
          }),
          { status: 410, headers: { "content-type": "application/json" } },
        ),
    });

    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));
    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Apply to BudgetLine/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Staging row no longer valid/i)).toBeTruthy();
    });

    // Restart button rendered, regular Apply button HIDDEN.
    expect(
      screen.getByRole("button", { name: /Restart from step 1/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Apply to BudgetLine$/i }),
    ).toBeNull();

    // Click Restart — returns to step 1 (the company picker re-renders).
    fireEvent.click(
      screen.getByRole("button", { name: /Restart from step 1/i }),
    );
    await waitFor(() => {
      // Step 1 surfaces "Analyze with AI" button again.
      expect(
        screen.getByRole("button", { name: /Analyze with AI/i }),
      ).toBeTruthy();
    });
    // Step 2 markers gone.
    expect(screen.queryByText(/AI proposal/i)).toBeNull();
  });

  it("Step 3: indicatorsStale=true renders ⚠ recompute warning banner", async () => {
    installFetchMock({
      apply: async () =>
        new Response(
          JSON.stringify({
            ...APPLY_RESPONSE_OK,
            recompute: { ok: 50, unknown: 0, failed: 4, targets: 54 },
            indicatorsStale: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));
    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Apply to BudgetLine/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Applied to BudgetLine/i)).toBeTruthy();
    });

    // Stale warning visible — anchored on its unique copy.
    expect(
      screen.getByText(/Some indicators failed to recompute/i),
    ).toBeTruthy();
    expect(screen.getByText(/matrix may be stale/i)).toBeTruthy();
  });

  // --- Architect ⚠️ closure (sub-44 cont'd) — 3 missing branches ----------
  // Architect re-review surfaced 3 dev-flagged-then-skipped branches:
  //   - AppliedStep `recompute.failed > 0` rendering at ImportWizard.tsx:767
  //   - "Import another" reset at ImportWizard.tsx:746-752
  //   - Anomalies block at ImportWizard.tsx:655-661 (PROPOSAL_PAYLOAD has
  //     anomalies=[] → branch was dead in cases 1-10)

  it("Step 3: AppliedStep renders recompute breakdown with failed > 0 (locks the X ok · Y unknown · Z failed pattern)", async () => {
    installFetchMock({
      apply: async () =>
        new Response(
          JSON.stringify({
            ...APPLY_RESPONSE_OK,
            // Distinct counts for each slot so we can prove each value
            // lands in its own position. Dev-flagged branch from architect
            // re-review of sub-44 main commit.
            recompute: { ok: 41, unknown: 7, failed: 6, targets: 54 },
            indicatorsStale: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));
    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Apply to BudgetLine/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Applied to BudgetLine/i)).toBeTruthy();
    });

    // Locks the breakdown copy at ImportWizard.tsx:766-770. Anchor on
    // the assembled string so a reorder of slots (e.g. "failed first")
    // would fail loud.
    const breakdown = screen.getByText(
      /41 ok · 7 unknown · 6 failed \(over 54 targets\)/,
    );
    expect(breakdown).toBeTruthy();
    // indicatorsStale=false ensures the warning banner DOES NOT render
    // (separate concern from the breakdown copy itself).
    expect(
      screen.queryByText(/Some indicators failed to recompute/i),
    ).toBeNull();
  });

  it("Step 3 → 1: 'Import another' resets wizard to step select with empty state (locks resetWizard from applied path)", async () => {
    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    // Drive to applied state.
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile("first.xlsx")] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));
    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Apply to BudgetLine/i }),
    );
    await waitFor(() => {
      expect(screen.getByText(/Applied to BudgetLine/i)).toBeTruthy();
    });

    // "Import another" button (ImportWizard.tsx:746-752) returns to
    // step "select" via the same resetWizard helper used by Restart-
    // from-step-1 (case 9). Locks the second of the two reset entry
    // points.
    fireEvent.click(screen.getByRole("button", { name: /Import another/i }));

    // Step 1 surfaces — anchor on the Analyze button + the label
    // "Target company" (only present in SelectStep).
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Analyze with AI/i }),
      ).toBeTruthy();
    });
    expect(screen.getByLabelText(/Target company/i)).toBeTruthy();

    // Applied-step markers gone.
    expect(screen.queryByText(/Applied to BudgetLine/i)).toBeNull();

    // The file picker MUST be empty (resetWizard sets file=null at
    // ImportWizard.tsx:252). Without this lock, a future regression that
    // forgets to clear the file would silently let the user re-Apply
    // against a stale staging proposal.
    const fileInput = screen.getByLabelText(/xlsx file/i) as HTMLInputElement;
    expect(fileInput.files?.length ?? 0).toBe(0);
  });

  it("Step 2: Anomalies block renders when proposal.anomalies.length > 0 (locks the dev-reviewer warning surface)", async () => {
    // PROPOSAL_PAYLOAD's empty anomalies leaves the block dead in cases
    // 1-10. Override the analyze response with a 2-anomaly payload so
    // the conditional render branch fires; this is the only place
    // critical/warning data-quality issues surface to the human reviewer
    // before /apply commits to BudgetLine.
    const proposalWithAnomalies = {
      ...PROPOSAL_PAYLOAD,
      anomalies: [
        {
          row: 47,
          severity: "critical" as const,
          category: "sign_inversion" as const,
          description:
            "Revenue cell 47 is negative (-12,500); expected positive.",
        },
        {
          row: null,
          severity: "warning" as const,
          category: "missing_breakdown" as const,
          description:
            "Parent code 600 has no children but carries a value.",
        },
      ],
    };

    installFetchMock({
      analyze: async () =>
        new Response(
          JSON.stringify({
            ...ANALYZE_RESPONSE,
            proposal: proposalWithAnomalies,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    render(<ImportWizard />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target company/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/Target company/i), {
      target: { value: "co_op_a" },
    });
    fireEvent.change(screen.getByLabelText(/xlsx file/i), {
      target: { files: [makeXlsxFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze with AI/i }));

    await waitFor(() => {
      expect(screen.getByText(/AI proposal/i)).toBeTruthy();
    });

    // Anomalies header with explicit count (locks the proposal.anomalies.length
    // interpolation at ImportWizard.tsx:658).
    expect(screen.getByText(/Anomalies \(2\)/)).toBeTruthy();

    // Severity labels (uppercase per ImportWizard.tsx:670).
    expect(screen.getByText("critical")).toBeTruthy();
    expect(screen.getByText("warning")).toBeTruthy();

    // Per-anomaly description text + category mnemonic (sign_inversion).
    expect(
      screen.getByText(/Revenue cell 47 is negative/i),
    ).toBeTruthy();
    expect(screen.getByText("sign_inversion")).toBeTruthy();

    // The first anomaly has row=47 (rendered as "row 47"); the second
    // has row=null and MUST NOT render the row span (ImportWizard.tsx:673).
    expect(screen.getByText(/row 47/)).toBeTruthy();
    // No "row null" or empty row marker for the null-row anomaly.
    expect(screen.queryByText(/row null/i)).toBeNull();
  });
});
