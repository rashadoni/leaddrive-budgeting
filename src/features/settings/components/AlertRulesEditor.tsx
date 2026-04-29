"use client";

/**
 * Phase 7.E C6 v2 — Alert-rule threshold editor.
 *
 * Settings UI for `Organization.settings.alertThresholds`. Reads + writes
 * the same config the alert engine consumes (`alert-thresholds-config.ts`).
 * One card per default rule; numeric inputs for thresholds, picklist for
 * the org-wide critical-indicator code (sourced from active
 * `IndicatorDefinition` rows). Save submits the full config blob (no
 * partial updates) so the API row always carries the complete picture
 * after a write.
 *
 * Auth-aware: GET works for any authenticated org member; PATCH is
 * admin-only server-side. Non-admins who reach this editor will see
 * inputs render fine but the Save call will return 403; we surface that
 * inline. (Page-level auth is the page's responsibility, not ours.)
 */

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  DEFAULT_ALERT_THRESHOLDS,
  type AlertThresholdsConfig,
  type ResolvedAlertThresholds,
} from '@/lib/risk/alert-thresholds-config';

type IndicatorOption = { id: string; code: string; nameEn: string };

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

function getStatusMessage(status: SaveStatus): string | null {
  if (status.kind === 'saved') return 'Saved.';
  if (status.kind === 'error') return status.message;
  if (status.kind === 'saving') return 'Saving…';
  return null;
}

export function AlertRulesEditor() {
  const [config, setConfig] = React.useState<ResolvedAlertThresholds>(
    DEFAULT_ALERT_THRESHOLDS,
  );
  const [indicators, setIndicators] = React.useState<IndicatorOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>({ kind: 'idle' });

  React.useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      setLoadError(null);
      try {
        const [settingsRes, indicatorsRes] = await Promise.all([
          fetch('/api/organizations/settings'),
          fetch('/api/indicators'),
        ]);
        if (!settingsRes.ok) {
          throw new Error(`Settings ${settingsRes.status}`);
        }
        if (!indicatorsRes.ok) {
          throw new Error(`Indicators ${indicatorsRes.status}`);
        }
        const settingsBody = await settingsRes.json();
        const indicatorsBody = await indicatorsRes.json();
        if (cancelled) return;
        const persisted: AlertThresholdsConfig | undefined =
          settingsBody?.settings?.alertThresholds;
        // Fill any unset keys from defaults so the form always shows the
        // currently-effective value (matches what the engine will actually
        // use post-save).
        setConfig({
          mostlyRed: persisted?.mostlyRed ?? DEFAULT_ALERT_THRESHOLDS.mostlyRed,
          criticalComposite:
            persisted?.criticalComposite ??
            DEFAULT_ALERT_THRESHOLDS.criticalComposite,
          sectorAmber:
            persisted?.sectorAmber ?? DEFAULT_ALERT_THRESHOLDS.sectorAmber,
          sectorRedSpread:
            persisted?.sectorRedSpread ??
            DEFAULT_ALERT_THRESHOLDS.sectorRedSpread,
          criticalIndicator:
            persisted?.criticalIndicator ??
            DEFAULT_ALERT_THRESHOLDS.criticalIndicator,
        });
        setIndicators(
          Array.isArray(indicatorsBody)
            ? (indicatorsBody as IndicatorOption[]).map((i) => ({
                id: i.id,
                code: i.code,
                nameEn: i.nameEn,
              }))
            : [],
        );
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaveStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/organizations/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertThresholds: config }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message =
          typeof body?.error === 'string'
            ? body.error
            : `HTTP ${res.status}`;
        setSaveStatus({ kind: 'error', message });
        return;
      }
      setSaveStatus({ kind: 'saved' });
    } catch (err) {
      setSaveStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleReset() {
    setConfig(DEFAULT_ALERT_THRESHOLDS);
    setSaveStatus({ kind: 'idle' });
  }

  function setNumeric<K extends keyof ResolvedAlertThresholds>(
    bucket: K,
    field: keyof ResolvedAlertThresholds[K],
    value: number,
  ) {
    setConfig((prev) => ({
      ...prev,
      [bucket]: {
        ...prev[bucket],
        [field]: value,
      },
    }));
    setSaveStatus({ kind: 'idle' });
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert rules</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert rules</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Could not load alert rule settings: {loadError}
          </p>
        </CardContent>
      </Card>
    );
  }

  const statusMessage = getStatusMessage(saveStatus);

  return (
    <Card data-testid="alert-rules-editor">
      <CardHeader>
        <CardTitle className="text-base">Alert rules</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Tune the thresholds that drive the terminal&apos;s alert engine. Defaults
          ship with sensible Bloomberg-style values; raise or lower per your
          holding&apos;s tolerance.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <RuleBlock
          title="Company has many red indicators"
          description="Flags any company with N or more red indicators."
        >
          <NumericField
            id="mostlyRed-redCountMin"
            label="Red indicators required"
            min={1}
            max={80}
            value={config.mostlyRed.redCountMin}
            onChange={(v) => setNumeric('mostlyRed', 'redCountMin', v)}
          />
        </RuleBlock>

        <RuleBlock
          title="Composite score below threshold"
          description="Flags companies whose composite risk score falls under the configured floor."
        >
          <NumericField
            id="criticalComposite-scoreMax"
            label="Score floor (composite < value)"
            min={1}
            max={100}
            value={config.criticalComposite.scoreMax}
            onChange={(v) => setNumeric('criticalComposite', 'scoreMax', v)}
          />
        </RuleBlock>

        <RuleBlock
          title="Sector amber cluster"
          description="Flags an industry where amber cells aggregate across multiple companies."
        >
          <NumericField
            id="sectorAmber-amberCountMin"
            label="Amber cells required (per sector)"
            min={1}
            max={200}
            value={config.sectorAmber.amberCountMin}
            onChange={(v) => setNumeric('sectorAmber', 'amberCountMin', v)}
          />
        </RuleBlock>

        <RuleBlock
          title="Sector red contagion"
          description="Flags an industry where red cells appear across multiple companies — possible sector contagion."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericField
              id="sectorRedSpread-redCountMin"
              label="Red cells required (per sector)"
              min={1}
              max={200}
              value={config.sectorRedSpread.redCountMin}
              onChange={(v) =>
                setNumeric('sectorRedSpread', 'redCountMin', v)
              }
            />
            <NumericField
              id="sectorRedSpread-companyCountMin"
              label="Companies affected (≥ 2)"
              min={2}
              max={60}
              value={config.sectorRedSpread.companyCountMin}
              onChange={(v) =>
                setNumeric('sectorRedSpread', 'companyCountMin', v)
              }
            />
          </div>
        </RuleBlock>

        <RuleBlock
          title="Critical indicator org-wide"
          description="Pick one indicator that triggers an org-wide alert when it goes red across N+ companies."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="criticalIndicator-indicatorCode">Indicator</Label>
              <Select
                id="criticalIndicator-indicatorCode"
                value={config.criticalIndicator.indicatorCode}
                onChange={(e) => {
                  const code = e.target.value;
                  setConfig((prev) => ({
                    ...prev,
                    criticalIndicator: {
                      ...prev.criticalIndicator,
                      indicatorCode: code,
                    },
                  }));
                  setSaveStatus({ kind: 'idle' });
                }}
              >
                {/* Always include the currently-configured code even if it's
                   no longer in the active indicator list (legacy /
                   org-specific). Keeps the form honest about what's
                   actually configured. */}
                {!indicators.some(
                  (i) => i.code === config.criticalIndicator.indicatorCode,
                ) && (
                  <option value={config.criticalIndicator.indicatorCode}>
                    {config.criticalIndicator.indicatorCode} (legacy)
                  </option>
                )}
                {indicators.map((i) => (
                  <option key={i.id} value={i.code}>
                    {i.code} — {i.nameEn}
                  </option>
                ))}
              </Select>
            </div>
            <NumericField
              id="criticalIndicator-redCountMin"
              label="Companies-red required"
              min={1}
              max={60}
              value={config.criticalIndicator.redCountMin}
              onChange={(v) =>
                setNumeric('criticalIndicator', 'redCountMin', v)
              }
            />
          </div>
        </RuleBlock>

        <div className="flex items-center justify-between border-t border-border/40 pt-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveStatus.kind === 'saving'}
            >
              {saveStatus.kind === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" onClick={handleReset}>
              Reset to defaults
            </Button>
          </div>
          {statusMessage && (
            <p
              className={
                saveStatus.kind === 'error'
                  ? 'text-sm text-destructive'
                  : 'text-sm text-muted-foreground'
              }
              data-testid="alert-rules-editor-status"
              role="status"
            >
              {statusMessage}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RuleBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border/40 p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="pt-1">{children}</div>
    </section>
  );
}

function NumericField({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.round(n));
        }}
      />
    </div>
  );
}
