--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path = public;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: ApprovalRequestStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApprovalRequestStatus" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);


--
-- Name: ApprovalRequestType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApprovalRequestType" AS ENUM (
    'budget_line_create',
    'budget_line_update',
    'budget_line_delete',
    'budget_actual_create',
    'budget_actual_update',
    'budget_actual_delete',
    'period_unlock'
);


--
-- Name: AuditAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuditAction" AS ENUM (
    'company_role_change',
    'budget_plan_create',
    'budget_plan_approve',
    'import_budget_create',
    'import_staging_apply',
    'import_staging_expired',
    'indicator_override_create',
    'indicator_override_update',
    'indicator_override_delete',
    'ai_variance_explainer_run',
    'ai_forecast_explainer_run',
    'alert_thresholds_update',
    'intel_crawl_run',
    'ai_board_deck_narration_run',
    'period_lock_add',
    'period_lock_remove',
    'period_lock_blocked_mutation',
    'user_access_change',
    'user_role_change',
    'user_create',
    'user_password_reset',
    'user_active_toggle',
    'ai_news_summary_run',
    'operational_fact_create',
    'operational_fact_update',
    'operational_fact_delete',
    'indicator_disclosure_create',
    'indicator_disclosure_update',
    'indicator_disclosure_delete',
    'ai_morning_brief_run',
    'coa_role_change',
    'ai_mapper_proposal_cache_run',
    'ai_mapper_template_promote',
    'ai_mapper_template_apply',
    'ai_token_budget_exceeded',
    'intel_data_source_run',
    'predictive_breach_compute',
    'ai_breach_digest',
    'client_reconciliation_submit',
    'client_reconciliation_delete',
    'company_settings_update',
    'reconciliation_drift_detected',
    'period_snapshot_drift',
    'api_key_update',
    'data_archive',
    'data_restore',
    'soft_delete_purge',
    'company_industry_change',
    'company_status_change'
);


--
-- Name: CoARole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CoARole" AS ENUM (
    'revenue',
    'cogs',
    'opex',
    'finance',
    'tax_costs',
    'non_operating',
    'tax',
    'unknown'
);


--
-- Name: CompanyRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CompanyRole" AS ENUM (
    'operational',
    'admin',
    'holding'
);


--
-- Name: ImportStagingStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ImportStagingStatus" AS ENUM (
    'pending',
    'applied',
    'discarded',
    'expired'
);


--
-- Name: indicator_value_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.indicator_value_source AS ENUM (
    'disclosed',
    'modeled_industry',
    'modeled_generic',
    'macro',
    'computed'
);


--
-- Name: notify_audit_events_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_audit_events_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify(
    'audit_events_changed',
    json_build_object(
      'id', NEW.id,
      'action', NEW.action,
      'organizationId', NEW."organizationId",
      'actorUserId', NEW."actorUserId",
      'createdAt', NEW."createdAt"
    )::text
  );
  RETURN NEW;
END;
$$;


--
-- Name: notify_indicator_values_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_indicator_values_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify(
    'indicator_values_changed',
    json_build_object(
      'id', NEW.id,
      'indicatorId', NEW."indicatorId",
      'companyId', NEW."companyId",
      'organizationId', NEW."organizationId",
      'status', NEW.status,
      'period', NEW.period
    )::text
  );
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Organization" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "lockedPeriods" jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: accounting_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_imports (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "integrationId" text,
    "planId" text NOT NULL,
    "fileName" text,
    "importType" text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "totalRows" integer DEFAULT 0 NOT NULL,
    "matchedRows" integer DEFAULT 0 NOT NULL,
    "unmatchedRows" integer DEFAULT 0 NOT NULL,
    errors jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: accounting_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_integrations (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    provider text NOT NULL,
    name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    "categoryMapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "lastSyncAt" timestamp(3) without time zone,
    "lastSyncStatus" text,
    "lastSyncError" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id text NOT NULL,
    "userId" text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    "providerAccountId" text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text
);


--
-- Name: ai_mapper_proposal_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_mapper_proposal_cache (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "structureHash" text NOT NULL,
    "promptVersion" text NOT NULL,
    "modelName" text NOT NULL,
    proposal jsonb NOT NULL,
    "llmAnomalies" jsonb NOT NULL,
    "tokensIn" integer NOT NULL,
    "tokensOut" integer NOT NULL,
    "isTemplate" boolean DEFAULT false NOT NULL,
    "templateName" text,
    "applyCount" integer DEFAULT 0 NOT NULL,
    "lastUsedAt" timestamp(3) without time zone,
    "cachedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_token_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_token_usage (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    date text NOT NULL,
    "tokensIn" integer DEFAULT 0 NOT NULL,
    "tokensOut" integer DEFAULT 0 NOT NULL,
    calls integer DEFAULT 0 NOT NULL
);


--
-- Name: alert_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_events (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    period text NOT NULL,
    "ruleId" text NOT NULL,
    "ruleName" text NOT NULL,
    severity text NOT NULL,
    message text NOT NULL,
    "messageKey" text NOT NULL,
    "messageParams" jsonb NOT NULL,
    "affectedCompanyIds" text[] NOT NULL,
    "affectedIndicatorCodes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "emittedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_rules (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    description text,
    condition jsonb NOT NULL,
    severity text DEFAULT 'warn'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    type text NOT NULL,
    "sourceRef" jsonb NOT NULL,
    severity text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    "triggeredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "acknowledgedAt" timestamp(3) without time zone,
    "acknowledgedBy" text
);


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text,
    "requestType" public."ApprovalRequestType" NOT NULL,
    "targetType" text,
    "targetId" text,
    "proposedChange" jsonb NOT NULL,
    reason text,
    status public."ApprovalRequestStatus" DEFAULT 'pending'::public."ApprovalRequestStatus" NOT NULL,
    "requestedBy" text NOT NULL,
    "requestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "reviewedBy" text,
    "reviewedAt" timestamp(3) without time zone,
    "reviewComment" text,
    "appliedAt" timestamp(3) without time zone
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "actorUserId" text,
    action public."AuditAction" NOT NULL,
    "entityType" text NOT NULL,
    "entityId" text,
    metadata jsonb NOT NULL,
    context jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: balance_sheet_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_sheet_lines (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    "lineType" text NOT NULL,
    "subType" text,
    year integer NOT NULL,
    month integer NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "accountId" text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "deletedBy" text,
    "companyId" text
);


--
-- Name: board_deck_narrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_deck_narrations (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    period text NOT NULL,
    "snapshotHash" text NOT NULL,
    language text NOT NULL,
    headline text NOT NULL,
    paragraphs text[],
    "modelName" text NOT NULL,
    "promptVersion" text NOT NULL,
    "tokensIn" integer DEFAULT 0 NOT NULL,
    "tokensOut" integer DEFAULT 0 NOT NULL,
    "generatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    "arrivalDate" timestamp(3) without time zone NOT NULL,
    "departureDate" timestamp(3) without time zone NOT NULL,
    nights integer NOT NULL,
    revenue double precision NOT NULL,
    "currencyCode" text,
    "exchangeRate" double precision,
    "sourceCountry" text NOT NULL,
    "roomsBooked" integer,
    channel text,
    "isCancelled" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: budget_actuals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_actuals (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    category text NOT NULL,
    department text,
    "lineType" text DEFAULT 'expense'::text NOT NULL,
    "actualAmount" double precision DEFAULT 0 NOT NULL,
    "expenseDate" text,
    description text,
    "currencyCode" text,
    "exchangeRate" double precision,
    "originalAmount" double precision,
    "costTypeId" text,
    "departmentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "companyId" text,
    "monthIndex" integer
);


--
-- Name: budget_approval_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_approval_comments (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    "userId" text NOT NULL,
    "userName" text NOT NULL,
    status text NOT NULL,
    comment text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: budget_assumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_assumptions (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    category text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    value double precision DEFAULT 0 NOT NULL,
    unit text,
    period text,
    notes text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: budget_change_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_change_logs (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    "entityType" text NOT NULL,
    "entityId" text NOT NULL,
    action text NOT NULL,
    field text,
    "oldValue" jsonb,
    "newValue" jsonb,
    snapshot jsonb,
    "userId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: budget_cost_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_cost_types (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    "costModelPattern" text,
    "isShared" boolean DEFAULT false NOT NULL,
    "allocationMethod" text,
    color text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: budget_department_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_department_owners (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "departmentId" text NOT NULL,
    "userId" text NOT NULL,
    "canEdit" boolean DEFAULT true NOT NULL,
    "canApprove" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: budget_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_departments (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    "serviceKey" text,
    "hasRevenue" boolean DEFAULT true NOT NULL,
    color text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: budget_direction_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_direction_templates (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    description text,
    "lineType" text DEFAULT 'revenue'::text NOT NULL,
    "lineSubtype" text,
    "defaultAmount" double precision DEFAULT 0 NOT NULL,
    "unitPrice" double precision,
    "unitCost" double precision,
    quantity integer,
    "costModelKey" text,
    department text,
    "costTypeId" text,
    "departmentId" text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: budget_forecast_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_forecast_entries (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    category text NOT NULL,
    "lineType" text DEFAULT 'expense'::text NOT NULL,
    "forecastAmount" double precision DEFAULT 0 NOT NULL,
    "costTypeId" text,
    "departmentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_lines (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    department text,
    "lineType" text DEFAULT 'expense'::text NOT NULL,
    "lineSubtype" text,
    "plannedAmount" double precision DEFAULT 0 NOT NULL,
    "forecastAmount" double precision,
    "unitPrice" double precision,
    "unitCost" double precision,
    quantity integer,
    "costModelKey" text,
    "isAutoPlanned" boolean DEFAULT false NOT NULL,
    "isAutoActual" boolean DEFAULT false NOT NULL,
    "costTypeId" text,
    "departmentId" text,
    "vatIncluded" boolean DEFAULT false NOT NULL,
    "vatRate" double precision,
    "amountExVat" double precision,
    "currencyCode" text,
    "exchangeRate" double precision,
    "originalAmount" double precision,
    notes text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "parentId" text,
    "accountId" text NOT NULL,
    "companyId" text,
    "monthIndex" integer,
    "sourceDocument" text,
    "deletedAt" timestamp(3) without time zone,
    "deletedBy" text
);


--
-- Name: budget_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_plans (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    "periodType" text DEFAULT 'monthly'::text NOT NULL,
    year integer NOT NULL,
    month integer,
    quarter integer,
    status text DEFAULT 'draft'::text NOT NULL,
    notes text,
    "submittedBy" text,
    "submittedAt" timestamp(3) without time zone,
    "approvedBy" text,
    "approvedAt" timestamp(3) without time zone,
    "rejectedReason" text,
    "amendmentOf" text,
    version integer DEFAULT 1 NOT NULL,
    "versionLabel" text,
    "snapshotData" jsonb,
    "isRolling" boolean DEFAULT false NOT NULL,
    "rollingMonths" integer DEFAULT 12 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "deletedBy" text
);


--
-- Name: budget_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_sections (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    name text NOT NULL,
    "sectionType" text DEFAULT 'expense'::text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cash_flow_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_flow_alerts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    "alertType" text NOT NULL,
    message text NOT NULL,
    threshold double precision,
    "projectedBalance" double precision NOT NULL,
    "isResolved" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: cash_flow_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_flow_entries (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    "entryType" text NOT NULL,
    source text NOT NULL,
    "sourceId" text,
    amount double precision NOT NULL,
    "currencyCode" text DEFAULT 'AZN'::text NOT NULL,
    description text,
    "paymentDate" timestamp(3) without time zone,
    "isProjected" boolean DEFAULT true NOT NULL,
    "activityType" text DEFAULT 'operating'::text NOT NULL,
    "counterpartyId" text,
    "plannedAmount" double precision,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "accountId" text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "deletedBy" text
);


--
-- Name: chart_of_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_of_accounts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    "nameAz" text,
    "nameRu" text,
    "nameEn" text,
    "parentCode" text,
    "accountType" text NOT NULL,
    category text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    role public."CoARole"
);


--
-- Name: client_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_reconciliations (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    period text NOT NULL,
    "indicatorKey" text NOT NULL,
    value double precision NOT NULL,
    currency text DEFAULT 'AZN'::text NOT NULL,
    note text,
    "submittedById" text,
    "submittedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: cogs_budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cogs_budget_lines (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    "productLineId" text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    "productionQty" double precision DEFAULT 0 NOT NULL,
    "totalCost" double precision DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "accountId" text NOT NULL
);


--
-- Name: cogs_cost_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cogs_cost_details (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    "productLineId" text NOT NULL,
    "costType" text NOT NULL,
    label text NOT NULL,
    "accountCode" text,
    stage text,
    year integer NOT NULL,
    month integer NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    quantity double precision,
    "unitPrice" double precision,
    unit text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "parentCompanyId" text,
    code text NOT NULL,
    name text NOT NULL,
    "nameAz" text,
    "nameRu" text,
    "nameEn" text,
    industry text,
    level integer DEFAULT 2 NOT NULL,
    country text,
    "baseCurrencyCode" text,
    settings jsonb,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    role public."CompanyRole" DEFAULT 'operational'::public."CompanyRole" NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL
);


--
-- Name: company_indicators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_indicators (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "indicatorId" text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "customThreshold" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: cost_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_components (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "productLineId" text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    "consumptionRate" double precision DEFAULT 0 NOT NULL,
    "unitCost" double precision DEFAULT 0 NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: counterparties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counterparties (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    role text NOT NULL,
    name text NOT NULL,
    "sharePct" double precision DEFAULT 0 NOT NULL,
    "annualAmount" double precision,
    "contractExpiry" timestamp(3) without time zone,
    "paymentTermsDays" integer,
    "singleSource" boolean DEFAULT false NOT NULL,
    notes text,
    period text DEFAULT '2026'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "deletedBy" text
);


--
-- Name: currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currencies (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    symbol text NOT NULL,
    "exchangeRate" double precision DEFAULT 1.0 NOT NULL,
    "isBase" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: currency_rate_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_rate_history (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "currencyCode" text NOT NULL,
    rate double precision NOT NULL,
    "rateDate" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: expense_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_forecasts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "costTypeId" text NOT NULL,
    "departmentId" text,
    year integer NOT NULL,
    month integer NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: feed_impact_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_impact_forecasts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "triggerSourceCode" text NOT NULL,
    "triggerMetric" text NOT NULL,
    "triggerValueRounded" double precision NOT NULL,
    "triggerObservedAt" timestamp(3) without time zone NOT NULL,
    "ruleId" text NOT NULL,
    "affectedCompanyId" text NOT NULL,
    "affectedCompanyCode" text NOT NULL,
    scenarios jsonb NOT NULL,
    recommendations jsonb NOT NULL,
    confidence text NOT NULL,
    language text NOT NULL,
    "promptVersion" text NOT NULL,
    "snapshotHash" text NOT NULL,
    "tokensIn" integer NOT NULL,
    "tokensOut" integer NOT NULL,
    "generatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: guide_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guide_views (
    id text NOT NULL,
    "organizationId" text,
    "actorUserId" text,
    lang text NOT NULL,
    anchor text,
    "userAgent" text,
    "viewedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: import_staging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_staging (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    "sourceFile" text NOT NULL,
    "sourceSheet" text NOT NULL,
    proposal jsonb NOT NULL,
    "userOverrides" jsonb,
    "xlsxTempPath" text,
    "createdBy" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "appliedAt" timestamp(3) without time zone,
    "errorMessage" text,
    status public."ImportStagingStatus" DEFAULT 'pending'::public."ImportStagingStatus" NOT NULL
);


--
-- Name: indicator_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indicator_definitions (
    id text NOT NULL,
    "organizationId" text,
    code text NOT NULL,
    "nameEn" text NOT NULL,
    "nameAz" text,
    "nameRu" text,
    category text NOT NULL,
    industries text[],
    unit text NOT NULL,
    direction text NOT NULL,
    formula text NOT NULL,
    "sparklineFormula" text,
    thresholds jsonb NOT NULL,
    "hintTemplateEn" text,
    "hintTemplateAz" text,
    "hintTemplateRu" text,
    "requiredInputs" text[],
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "defaultValueSource" public.indicator_value_source DEFAULT 'computed'::public.indicator_value_source NOT NULL,
    weight double precision DEFAULT 1.0 NOT NULL
);


--
-- Name: indicator_disclosures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indicator_disclosures (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    "indicatorCode" text NOT NULL,
    period text NOT NULL,
    value double precision NOT NULL,
    unit text NOT NULL,
    "sourceNote" text,
    "enteredBy" text NOT NULL,
    "enteredAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: indicator_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.indicator_values (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    "indicatorId" text NOT NULL,
    period text NOT NULL,
    value double precision NOT NULL,
    status text NOT NULL,
    sparkline jsonb NOT NULL,
    inputs jsonb NOT NULL,
    "computedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "valueSource" public.indicator_value_source DEFAULT 'computed'::public.indicator_value_source NOT NULL,
    confidence text,
    "lastReconciledAt" timestamp(3) without time zone,
    "reconciledBy" text,
    "sanityBand" text,
    "sourceDocument" text
);


--
-- Name: industries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.industries (
    code text NOT NULL,
    "nameEn" text NOT NULL,
    "nameAz" text,
    "nameRu" text,
    category text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: intel_data_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_data_points (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "sourceCode" text NOT NULL,
    metric text NOT NULL,
    datetime timestamp(3) without time zone NOT NULL,
    value double precision NOT NULL,
    unit text,
    raw jsonb,
    "fetchedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: intel_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intel_items (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    url text NOT NULL,
    "urlHash" text NOT NULL,
    "sourceLabel" text NOT NULL,
    "relevanceScore" double precision NOT NULL,
    "industryTags" text[] DEFAULT ARRAY[]::text[],
    "companyTags" text[] DEFAULT ARRAY[]::text[],
    "publishedAt" timestamp(3) without time zone,
    "fetchedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "isPinned" boolean DEFAULT false NOT NULL,
    "dismissedBy" text[] DEFAULT ARRAY[]::text[],
    "sentimentScore" double precision
);


--
-- Name: operational_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_facts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    metric text NOT NULL,
    date timestamp(3) without time zone NOT NULL,
    value double precision NOT NULL,
    unit text,
    source text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: period_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.period_snapshots (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    period text NOT NULL,
    "signedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "signedBy" text NOT NULL,
    "ivHash" text NOT NULL,
    "budgetHash" text NOT NULL,
    aggregates jsonb NOT NULL,
    "signoffNote" text
);


--
-- Name: predictive_breaches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.predictive_breaches (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "companyId" text NOT NULL,
    "indicatorCode" text NOT NULL,
    period text NOT NULL,
    "horizonStep" integer NOT NULL,
    "currentStatus" text NOT NULL,
    "predictedStatus" text NOT NULL,
    "forecastConfidence" double precision NOT NULL,
    "confidenceBand" text NOT NULL,
    "predictedValue" double precision NOT NULL,
    "predictedLower" double precision,
    "predictedUpper" double precision,
    drivers jsonb,
    "computedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: product_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_lines (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    "revenueAccountCode" text,
    "cogsAccountCode" text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: rolling_forecast_months; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rolling_forecast_months (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    status text DEFAULT 'forecast'::text NOT NULL,
    "lockedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sales_budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_budget_lines (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "planId" text NOT NULL,
    "productLineId" text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    quantity double precision DEFAULT 0 NOT NULL,
    "unitPrice" double precision DEFAULT 0 NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: sales_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_forecasts (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "departmentId" text NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    amount double precision DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: saved_budget_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_budget_reports (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "createdBy" text,
    name text NOT NULL,
    description text,
    "entityType" text NOT NULL,
    "planId" text,
    columns jsonb NOT NULL,
    filters jsonb DEFAULT '[]'::jsonb NOT NULL,
    "groupBy" text,
    "periodGroupBy" text,
    "sortBy" text,
    "sortOrder" text DEFAULT 'desc'::text NOT NULL,
    "chartType" text DEFAULT 'table'::text NOT NULL,
    "chartConfig" jsonb,
    "computedFields" jsonb,
    "isShared" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenarios (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    code text NOT NULL,
    "nameEn" text NOT NULL,
    "nameAz" text,
    "nameRu" text,
    description text,
    overrides jsonb NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: user_layout_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_layout_preferences (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    sizes jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    "passwordHash" text NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    avatar text,
    phone text,
    department text,
    "lastLogin" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "allowedSubGroupIds" text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: variance_explanations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variance_explanations (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "indicatorValueId" text NOT NULL,
    language text NOT NULL,
    "promptVersion" text NOT NULL,
    "snapshotHash" text NOT NULL,
    output jsonb NOT NULL,
    "tokensIn" integer NOT NULL,
    "tokensOut" integer NOT NULL,
    "cachedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Organization Organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);


--
-- Name: accounting_imports accounting_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_imports
    ADD CONSTRAINT accounting_imports_pkey PRIMARY KEY (id);


--
-- Name: accounting_integrations accounting_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_integrations
    ADD CONSTRAINT accounting_integrations_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: ai_mapper_proposal_cache ai_mapper_proposal_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_mapper_proposal_cache
    ADD CONSTRAINT ai_mapper_proposal_cache_pkey PRIMARY KEY (id);


--
-- Name: ai_token_usage ai_token_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_token_usage
    ADD CONSTRAINT ai_token_usage_pkey PRIMARY KEY (id);


--
-- Name: alert_events alert_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_events
    ADD CONSTRAINT alert_events_pkey PRIMARY KEY (id);


--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: balance_sheet_lines balance_sheet_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_sheet_lines
    ADD CONSTRAINT balance_sheet_lines_pkey PRIMARY KEY (id);


--
-- Name: board_deck_narrations board_deck_narrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_deck_narrations
    ADD CONSTRAINT board_deck_narrations_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: budget_actuals budget_actuals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_actuals
    ADD CONSTRAINT budget_actuals_pkey PRIMARY KEY (id);


--
-- Name: budget_approval_comments budget_approval_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_approval_comments
    ADD CONSTRAINT budget_approval_comments_pkey PRIMARY KEY (id);


--
-- Name: budget_assumptions budget_assumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_assumptions
    ADD CONSTRAINT budget_assumptions_pkey PRIMARY KEY (id);


--
-- Name: budget_change_logs budget_change_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_change_logs
    ADD CONSTRAINT budget_change_logs_pkey PRIMARY KEY (id);


--
-- Name: budget_cost_types budget_cost_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_cost_types
    ADD CONSTRAINT budget_cost_types_pkey PRIMARY KEY (id);


--
-- Name: budget_department_owners budget_department_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_department_owners
    ADD CONSTRAINT budget_department_owners_pkey PRIMARY KEY (id);


--
-- Name: budget_departments budget_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_departments
    ADD CONSTRAINT budget_departments_pkey PRIMARY KEY (id);


--
-- Name: budget_direction_templates budget_direction_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_direction_templates
    ADD CONSTRAINT budget_direction_templates_pkey PRIMARY KEY (id);


--
-- Name: budget_forecast_entries budget_forecast_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_forecast_entries
    ADD CONSTRAINT budget_forecast_entries_pkey PRIMARY KEY (id);


--
-- Name: budget_lines budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_pkey PRIMARY KEY (id);


--
-- Name: budget_plans budget_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_plans
    ADD CONSTRAINT budget_plans_pkey PRIMARY KEY (id);


--
-- Name: budget_sections budget_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_sections
    ADD CONSTRAINT budget_sections_pkey PRIMARY KEY (id);


--
-- Name: cash_flow_alerts cash_flow_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_flow_alerts
    ADD CONSTRAINT cash_flow_alerts_pkey PRIMARY KEY (id);


--
-- Name: cash_flow_entries cash_flow_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_flow_entries
    ADD CONSTRAINT cash_flow_entries_pkey PRIMARY KEY (id);


--
-- Name: chart_of_accounts chart_of_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_of_accounts
    ADD CONSTRAINT chart_of_accounts_pkey PRIMARY KEY (id);


--
-- Name: client_reconciliations client_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_reconciliations
    ADD CONSTRAINT client_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: cogs_budget_lines cogs_budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_budget_lines
    ADD CONSTRAINT cogs_budget_lines_pkey PRIMARY KEY (id);


--
-- Name: cogs_cost_details cogs_cost_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_cost_details
    ADD CONSTRAINT cogs_cost_details_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_indicators company_indicators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_indicators
    ADD CONSTRAINT company_indicators_pkey PRIMARY KEY (id);


--
-- Name: cost_components cost_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_components
    ADD CONSTRAINT cost_components_pkey PRIMARY KEY (id);


--
-- Name: counterparties counterparties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT counterparties_pkey PRIMARY KEY (id);


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (id);


--
-- Name: currency_rate_history currency_rate_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_rate_history
    ADD CONSTRAINT currency_rate_history_pkey PRIMARY KEY (id);


--
-- Name: expense_forecasts expense_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_forecasts
    ADD CONSTRAINT expense_forecasts_pkey PRIMARY KEY (id);


--
-- Name: feed_impact_forecasts feed_impact_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_impact_forecasts
    ADD CONSTRAINT feed_impact_forecasts_pkey PRIMARY KEY (id);


--
-- Name: guide_views guide_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guide_views
    ADD CONSTRAINT guide_views_pkey PRIMARY KEY (id);


--
-- Name: import_staging import_staging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT import_staging_pkey PRIMARY KEY (id);


--
-- Name: indicator_definitions indicator_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_definitions
    ADD CONSTRAINT indicator_definitions_pkey PRIMARY KEY (id);


--
-- Name: indicator_disclosures indicator_disclosures_companyId_indicatorCode_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_disclosures
    ADD CONSTRAINT "indicator_disclosures_companyId_indicatorCode_period_key" UNIQUE ("companyId", "indicatorCode", period);


--
-- Name: indicator_disclosures indicator_disclosures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_disclosures
    ADD CONSTRAINT indicator_disclosures_pkey PRIMARY KEY (id);


--
-- Name: indicator_values indicator_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_values
    ADD CONSTRAINT indicator_values_pkey PRIMARY KEY (id);


--
-- Name: industries industries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.industries
    ADD CONSTRAINT industries_pkey PRIMARY KEY (code);


--
-- Name: intel_data_points intel_data_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_data_points
    ADD CONSTRAINT intel_data_points_pkey PRIMARY KEY (id);


--
-- Name: intel_items intel_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_items
    ADD CONSTRAINT intel_items_pkey PRIMARY KEY (id);


--
-- Name: operational_facts operational_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_facts
    ADD CONSTRAINT operational_facts_pkey PRIMARY KEY (id);


--
-- Name: period_snapshots period_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_snapshots
    ADD CONSTRAINT period_snapshots_pkey PRIMARY KEY (id);


--
-- Name: predictive_breaches predictive_breaches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictive_breaches
    ADD CONSTRAINT predictive_breaches_pkey PRIMARY KEY (id);


--
-- Name: product_lines product_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_lines
    ADD CONSTRAINT product_lines_pkey PRIMARY KEY (id);


--
-- Name: rolling_forecast_months rolling_forecast_months_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rolling_forecast_months
    ADD CONSTRAINT rolling_forecast_months_pkey PRIMARY KEY (id);


--
-- Name: sales_budget_lines sales_budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_budget_lines
    ADD CONSTRAINT sales_budget_lines_pkey PRIMARY KEY (id);


--
-- Name: sales_forecasts sales_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecasts
    ADD CONSTRAINT sales_forecasts_pkey PRIMARY KEY (id);


--
-- Name: saved_budget_reports saved_budget_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_budget_reports
    ADD CONSTRAINT saved_budget_reports_pkey PRIMARY KEY (id);


--
-- Name: scenarios scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_pkey PRIMARY KEY (id);


--
-- Name: user_layout_preferences user_layout_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_layout_preferences
    ADD CONSTRAINT user_layout_preferences_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: variance_explanations variance_explanations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variance_explanations
    ADD CONSTRAINT variance_explanations_pkey PRIMARY KEY (id);


--
-- Name: Organization_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Organization_slug_key" ON public."Organization" USING btree (slug);


--
-- Name: accounting_imports_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "accounting_imports_organizationId_idx" ON public.accounting_imports USING btree ("organizationId");


--
-- Name: accounting_imports_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "accounting_imports_planId_idx" ON public.accounting_imports USING btree ("planId");


--
-- Name: accounting_integrations_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "accounting_integrations_organizationId_idx" ON public.accounting_integrations USING btree ("organizationId");


--
-- Name: accounts_provider_providerAccountId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON public.accounts USING btree (provider, "providerAccountId");


--
-- Name: accounts_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "accounts_userId_idx" ON public.accounts USING btree ("userId");


--
-- Name: ai_mapper_proposal_cache_organizationId_isTemplate_lastUsed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_mapper_proposal_cache_organizationId_isTemplate_lastUsed_idx" ON public.ai_mapper_proposal_cache USING btree ("organizationId", "isTemplate", "lastUsedAt" DESC);


--
-- Name: ai_mapper_proposal_cache_organizationId_structureHash_promp_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_mapper_proposal_cache_organizationId_structureHash_promp_key" ON public.ai_mapper_proposal_cache USING btree ("organizationId", "structureHash", "promptVersion", "modelName");


--
-- Name: ai_token_usage_organizationId_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_token_usage_organizationId_date_idx" ON public.ai_token_usage USING btree ("organizationId", date DESC);


--
-- Name: ai_token_usage_organizationId_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ai_token_usage_organizationId_date_key" ON public.ai_token_usage USING btree ("organizationId", date);


--
-- Name: alert_events_organizationId_period_emittedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "alert_events_organizationId_period_emittedAt_idx" ON public.alert_events USING btree ("organizationId", period, "emittedAt");


--
-- Name: alert_events_organizationId_ruleId_emittedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "alert_events_organizationId_ruleId_emittedAt_idx" ON public.alert_events USING btree ("organizationId", "ruleId", "emittedAt");


--
-- Name: alert_rules_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "alert_rules_organizationId_idx" ON public.alert_rules USING btree ("organizationId");


--
-- Name: alerts_organizationId_acknowledgedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "alerts_organizationId_acknowledgedAt_idx" ON public.alerts USING btree ("organizationId", "acknowledgedAt");


--
-- Name: alerts_organizationId_triggeredAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "alerts_organizationId_triggeredAt_idx" ON public.alerts USING btree ("organizationId", "triggeredAt");


--
-- Name: approval_requests_organizationId_status_requestedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "approval_requests_organizationId_status_requestedAt_idx" ON public.approval_requests USING btree ("organizationId", status, "requestedAt");


--
-- Name: approval_requests_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "approval_requests_planId_idx" ON public.approval_requests USING btree ("planId");


--
-- Name: approval_requests_requestedBy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "approval_requests_requestedBy_idx" ON public.approval_requests USING btree ("requestedBy");


--
-- Name: audit_events_organizationId_action_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_events_organizationId_action_createdAt_idx" ON public.audit_events USING btree ("organizationId", action, "createdAt");


--
-- Name: audit_events_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_events_organizationId_createdAt_idx" ON public.audit_events USING btree ("organizationId", "createdAt");


--
-- Name: audit_events_organizationId_entityType_entityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_events_organizationId_entityType_entityId_idx" ON public.audit_events USING btree ("organizationId", "entityType", "entityId");


--
-- Name: balance_sheet_lines_accountId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "balance_sheet_lines_accountId_idx" ON public.balance_sheet_lines USING btree ("accountId");


--
-- Name: balance_sheet_lines_companyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "balance_sheet_lines_companyId_idx" ON public.balance_sheet_lines USING btree ("companyId");


--
-- Name: balance_sheet_lines_companyId_year_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "balance_sheet_lines_companyId_year_month_idx" ON public.balance_sheet_lines USING btree ("companyId", year, month);


--
-- Name: balance_sheet_lines_organizationId_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "balance_sheet_lines_organizationId_deletedAt_idx" ON public.balance_sheet_lines USING btree ("organizationId", "deletedAt");


--
-- Name: balance_sheet_lines_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "balance_sheet_lines_organizationId_idx" ON public.balance_sheet_lines USING btree ("organizationId");


--
-- Name: balance_sheet_lines_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "balance_sheet_lines_planId_idx" ON public.balance_sheet_lines USING btree ("planId");


--
-- Name: balance_sheet_lines_planId_year_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "balance_sheet_lines_planId_year_month_idx" ON public.balance_sheet_lines USING btree ("planId", year, month);


--
-- Name: board_deck_narrations_organizationId_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "board_deck_narrations_organizationId_period_idx" ON public.board_deck_narrations USING btree ("organizationId", period);


--
-- Name: board_deck_narrations_organizationId_period_snapshotHash_la_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "board_deck_narrations_organizationId_period_snapshotHash_la_key" ON public.board_deck_narrations USING btree ("organizationId", period, "snapshotHash", language);


--
-- Name: bookings_companyId_arrivalDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bookings_companyId_arrivalDate_idx" ON public.bookings USING btree ("companyId", "arrivalDate");


--
-- Name: bookings_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bookings_organizationId_idx" ON public.bookings USING btree ("organizationId");


--
-- Name: budget_actuals_companyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_actuals_companyId_idx" ON public.budget_actuals USING btree ("companyId");


--
-- Name: budget_actuals_costTypeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_actuals_costTypeId_idx" ON public.budget_actuals USING btree ("costTypeId");


--
-- Name: budget_actuals_departmentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_actuals_departmentId_idx" ON public.budget_actuals USING btree ("departmentId");


--
-- Name: budget_actuals_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_actuals_organizationId_idx" ON public.budget_actuals USING btree ("organizationId");


--
-- Name: budget_actuals_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_actuals_planId_idx" ON public.budget_actuals USING btree ("planId");


--
-- Name: budget_approval_comments_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_approval_comments_organizationId_idx" ON public.budget_approval_comments USING btree ("organizationId");


--
-- Name: budget_approval_comments_planId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_approval_comments_planId_createdAt_idx" ON public.budget_approval_comments USING btree ("planId", "createdAt");


--
-- Name: budget_assumptions_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_assumptions_organizationId_idx" ON public.budget_assumptions USING btree ("organizationId");


--
-- Name: budget_assumptions_planId_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_assumptions_planId_category_idx" ON public.budget_assumptions USING btree ("planId", category);


--
-- Name: budget_assumptions_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_assumptions_planId_idx" ON public.budget_assumptions USING btree ("planId");


--
-- Name: budget_change_logs_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_change_logs_organizationId_idx" ON public.budget_change_logs USING btree ("organizationId");


--
-- Name: budget_change_logs_planId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_change_logs_planId_createdAt_idx" ON public.budget_change_logs USING btree ("planId", "createdAt");


--
-- Name: budget_cost_types_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_cost_types_organizationId_idx" ON public.budget_cost_types USING btree ("organizationId");


--
-- Name: budget_cost_types_organizationId_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "budget_cost_types_organizationId_key_key" ON public.budget_cost_types USING btree ("organizationId", key);


--
-- Name: budget_department_owners_organizationId_departmentId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "budget_department_owners_organizationId_departmentId_userId_key" ON public.budget_department_owners USING btree ("organizationId", "departmentId", "userId");


--
-- Name: budget_department_owners_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_department_owners_organizationId_idx" ON public.budget_department_owners USING btree ("organizationId");


--
-- Name: budget_department_owners_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_department_owners_userId_idx" ON public.budget_department_owners USING btree ("userId");


--
-- Name: budget_departments_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_departments_organizationId_idx" ON public.budget_departments USING btree ("organizationId");


--
-- Name: budget_departments_organizationId_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "budget_departments_organizationId_key_key" ON public.budget_departments USING btree ("organizationId", key);


--
-- Name: budget_direction_templates_costTypeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_direction_templates_costTypeId_idx" ON public.budget_direction_templates USING btree ("costTypeId");


--
-- Name: budget_direction_templates_departmentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_direction_templates_departmentId_idx" ON public.budget_direction_templates USING btree ("departmentId");


--
-- Name: budget_direction_templates_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_direction_templates_organizationId_idx" ON public.budget_direction_templates USING btree ("organizationId");


--
-- Name: budget_forecast_entries_costTypeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_forecast_entries_costTypeId_idx" ON public.budget_forecast_entries USING btree ("costTypeId");


--
-- Name: budget_forecast_entries_departmentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_forecast_entries_departmentId_idx" ON public.budget_forecast_entries USING btree ("departmentId");


--
-- Name: budget_forecast_entries_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_forecast_entries_organizationId_idx" ON public.budget_forecast_entries USING btree ("organizationId");


--
-- Name: budget_forecast_entries_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_forecast_entries_planId_idx" ON public.budget_forecast_entries USING btree ("planId");


--
-- Name: budget_forecast_entries_planId_year_month_category_lineType_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "budget_forecast_entries_planId_year_month_category_lineType_key" ON public.budget_forecast_entries USING btree ("planId", year, month, category, "lineType");


--
-- Name: budget_lines_accountId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_accountId_idx" ON public.budget_lines USING btree ("accountId");


--
-- Name: budget_lines_companyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_companyId_idx" ON public.budget_lines USING btree ("companyId");


--
-- Name: budget_lines_costTypeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_costTypeId_idx" ON public.budget_lines USING btree ("costTypeId");


--
-- Name: budget_lines_departmentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_departmentId_idx" ON public.budget_lines USING btree ("departmentId");


--
-- Name: budget_lines_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_organizationId_idx" ON public.budget_lines USING btree ("organizationId");


--
-- Name: budget_lines_parentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_parentId_idx" ON public.budget_lines USING btree ("parentId");


--
-- Name: budget_lines_planId_companyId_monthIndex_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_planId_companyId_monthIndex_idx" ON public.budget_lines USING btree ("planId", "companyId", "monthIndex");


--
-- Name: budget_lines_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_lines_planId_idx" ON public.budget_lines USING btree ("planId");


--
-- Name: budget_plans_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_plans_organizationId_idx" ON public.budget_plans USING btree ("organizationId");


--
-- Name: budget_sections_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_sections_organizationId_idx" ON public.budget_sections USING btree ("organizationId");


--
-- Name: budget_sections_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "budget_sections_planId_idx" ON public.budget_sections USING btree ("planId");


--
-- Name: cash_flow_alerts_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cash_flow_alerts_organizationId_idx" ON public.cash_flow_alerts USING btree ("organizationId");


--
-- Name: cash_flow_entries_accountId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cash_flow_entries_accountId_idx" ON public.cash_flow_entries USING btree ("accountId");


--
-- Name: cash_flow_entries_organizationId_activityType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cash_flow_entries_organizationId_activityType_idx" ON public.cash_flow_entries USING btree ("organizationId", "activityType");


--
-- Name: cash_flow_entries_organizationId_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cash_flow_entries_organizationId_deletedAt_idx" ON public.cash_flow_entries USING btree ("organizationId", "deletedAt");


--
-- Name: cash_flow_entries_organizationId_year_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cash_flow_entries_organizationId_year_month_idx" ON public.cash_flow_entries USING btree ("organizationId", year, month);


--
-- Name: chart_of_accounts_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chart_of_accounts_organizationId_code_key" ON public.chart_of_accounts USING btree ("organizationId", code);


--
-- Name: chart_of_accounts_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chart_of_accounts_organizationId_idx" ON public.chart_of_accounts USING btree ("organizationId");


--
-- Name: client_reconciliations_companyId_period_indicatorKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "client_reconciliations_companyId_period_indicatorKey_key" ON public.client_reconciliations USING btree ("companyId", period, "indicatorKey");


--
-- Name: client_reconciliations_organizationId_companyId_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "client_reconciliations_organizationId_companyId_period_idx" ON public.client_reconciliations USING btree ("organizationId", "companyId", period);


--
-- Name: cogs_budget_lines_accountId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cogs_budget_lines_accountId_idx" ON public.cogs_budget_lines USING btree ("accountId");


--
-- Name: cogs_budget_lines_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cogs_budget_lines_organizationId_idx" ON public.cogs_budget_lines USING btree ("organizationId");


--
-- Name: cogs_budget_lines_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cogs_budget_lines_planId_idx" ON public.cogs_budget_lines USING btree ("planId");


--
-- Name: cogs_budget_lines_planId_productLineId_year_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "cogs_budget_lines_planId_productLineId_year_month_key" ON public.cogs_budget_lines USING btree ("planId", "productLineId", year, month);


--
-- Name: cogs_cost_details_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cogs_cost_details_organizationId_idx" ON public.cogs_cost_details USING btree ("organizationId");


--
-- Name: cogs_cost_details_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cogs_cost_details_planId_idx" ON public.cogs_cost_details USING btree ("planId");


--
-- Name: cogs_cost_details_productLineId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cogs_cost_details_productLineId_idx" ON public.cogs_cost_details USING btree ("productLineId");


--
-- Name: companies_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "companies_organizationId_code_key" ON public.companies USING btree ("organizationId", code);


--
-- Name: companies_organizationId_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "companies_organizationId_level_idx" ON public.companies USING btree ("organizationId", level);


--
-- Name: companies_organizationId_parentCompanyId_industry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "companies_organizationId_parentCompanyId_industry_idx" ON public.companies USING btree ("organizationId", "parentCompanyId", industry);


--
-- Name: company_indicators_companyId_indicatorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "company_indicators_companyId_indicatorId_key" ON public.company_indicators USING btree ("companyId", "indicatorId");


--
-- Name: company_indicators_indicatorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "company_indicators_indicatorId_idx" ON public.company_indicators USING btree ("indicatorId");


--
-- Name: cost_components_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cost_components_organizationId_idx" ON public.cost_components USING btree ("organizationId");


--
-- Name: cost_components_productLineId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cost_components_productLineId_idx" ON public.cost_components USING btree ("productLineId");


--
-- Name: counterparties_companyId_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "counterparties_companyId_role_idx" ON public.counterparties USING btree ("companyId", role);


--
-- Name: counterparties_companyId_role_name_period_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "counterparties_companyId_role_name_period_key" ON public.counterparties USING btree ("companyId", role, name, period);


--
-- Name: counterparties_organizationId_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "counterparties_organizationId_deletedAt_idx" ON public.counterparties USING btree ("organizationId", "deletedAt");


--
-- Name: counterparties_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "counterparties_organizationId_idx" ON public.counterparties USING btree ("organizationId");


--
-- Name: counterparties_role_sharePct_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "counterparties_role_sharePct_idx" ON public.counterparties USING btree (role, "sharePct");


--
-- Name: currencies_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "currencies_organizationId_code_key" ON public.currencies USING btree ("organizationId", code);


--
-- Name: currency_rate_history_organizationId_currencyCode_rateDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "currency_rate_history_organizationId_currencyCode_rateDate_idx" ON public.currency_rate_history USING btree ("organizationId", "currencyCode", "rateDate");


--
-- Name: expense_forecasts_organizationId_costTypeId_departmentId_ye_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "expense_forecasts_organizationId_costTypeId_departmentId_ye_idx" ON public.expense_forecasts USING btree ("organizationId", "costTypeId", "departmentId", year, month);


--
-- Name: expense_forecasts_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "expense_forecasts_organizationId_idx" ON public.expense_forecasts USING btree ("organizationId");


--
-- Name: expense_forecasts_organizationId_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "expense_forecasts_organizationId_year_idx" ON public.expense_forecasts USING btree ("organizationId", year);


--
-- Name: feed_impact_forecasts_organizationId_affectedCompanyCode_ge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "feed_impact_forecasts_organizationId_affectedCompanyCode_ge_idx" ON public.feed_impact_forecasts USING btree ("organizationId", "affectedCompanyCode", "generatedAt" DESC);


--
-- Name: feed_impact_forecasts_organizationId_triggerMetric_triggerV_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "feed_impact_forecasts_organizationId_triggerMetric_triggerV_key" ON public.feed_impact_forecasts USING btree ("organizationId", "triggerMetric", "triggerValueRounded", "affectedCompanyId", language, "promptVersion", "snapshotHash");


--
-- Name: feed_impact_forecasts_organizationId_triggerSourceCode_gene_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "feed_impact_forecasts_organizationId_triggerSourceCode_gene_idx" ON public.feed_impact_forecasts USING btree ("organizationId", "triggerSourceCode", "generatedAt" DESC);


--
-- Name: guide_views_lang_viewedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guide_views_lang_viewedAt_idx" ON public.guide_views USING btree (lang, "viewedAt");


--
-- Name: guide_views_organizationId_viewedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "guide_views_organizationId_viewedAt_idx" ON public.guide_views USING btree ("organizationId", "viewedAt");


--
-- Name: import_staging_companyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "import_staging_companyId_idx" ON public.import_staging USING btree ("companyId");


--
-- Name: import_staging_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "import_staging_expiresAt_idx" ON public.import_staging USING btree ("expiresAt");


--
-- Name: import_staging_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "import_staging_organizationId_status_idx" ON public.import_staging USING btree ("organizationId", status);


--
-- Name: indicator_definitions_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "indicator_definitions_organizationId_code_key" ON public.indicator_definitions USING btree ("organizationId", code);


--
-- Name: indicator_definitions_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "indicator_definitions_organizationId_idx" ON public.indicator_definitions USING btree ("organizationId");


--
-- Name: indicator_disclosures_indicatorCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "indicator_disclosures_indicatorCode_idx" ON public.indicator_disclosures USING btree ("indicatorCode");


--
-- Name: indicator_disclosures_organizationId_companyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "indicator_disclosures_organizationId_companyId_idx" ON public.indicator_disclosures USING btree ("organizationId", "companyId");


--
-- Name: indicator_values_companyId_indicatorId_period_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "indicator_values_companyId_indicatorId_period_key" ON public.indicator_values USING btree ("companyId", "indicatorId", period);


--
-- Name: indicator_values_indicatorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "indicator_values_indicatorId_idx" ON public.indicator_values USING btree ("indicatorId");


--
-- Name: indicator_values_organizationId_companyId_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "indicator_values_organizationId_companyId_period_idx" ON public.indicator_values USING btree ("organizationId", "companyId", period);


--
-- Name: intel_data_points_organizationId_sourceCode_datetime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "intel_data_points_organizationId_sourceCode_datetime_idx" ON public.intel_data_points USING btree ("organizationId", "sourceCode", datetime DESC);


--
-- Name: intel_data_points_organizationId_sourceCode_metric_datetime_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "intel_data_points_organizationId_sourceCode_metric_datetime_key" ON public.intel_data_points USING btree ("organizationId", "sourceCode", metric, datetime);


--
-- Name: intel_items_organizationId_fetchedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "intel_items_organizationId_fetchedAt_idx" ON public.intel_items USING btree ("organizationId", "fetchedAt" DESC);


--
-- Name: intel_items_organizationId_relevanceScore_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "intel_items_organizationId_relevanceScore_idx" ON public.intel_items USING btree ("organizationId", "relevanceScore" DESC);


--
-- Name: intel_items_organizationId_urlHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "intel_items_organizationId_urlHash_key" ON public.intel_items USING btree ("organizationId", "urlHash");


--
-- Name: intel_items_sentiment_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intel_items_sentiment_lookup_idx ON public.intel_items USING btree ("organizationId", "fetchedAt" DESC) WHERE ("sentimentScore" IS NOT NULL);


--
-- Name: operational_facts_companyId_date_metric_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "operational_facts_companyId_date_metric_idx" ON public.operational_facts USING btree ("companyId", date, metric);


--
-- Name: operational_facts_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "operational_facts_organizationId_idx" ON public.operational_facts USING btree ("organizationId");


--
-- Name: period_snapshots_organizationId_period_signedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "period_snapshots_organizationId_period_signedAt_idx" ON public.period_snapshots USING btree ("organizationId", period, "signedAt");


--
-- Name: predictive_breaches_organizationId_period_companyId_indicat_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "predictive_breaches_organizationId_period_companyId_indicat_key" ON public.predictive_breaches USING btree ("organizationId", period, "companyId", "indicatorCode", "horizonStep");


--
-- Name: predictive_breaches_organizationId_period_horizonStep_confi_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "predictive_breaches_organizationId_period_horizonStep_confi_idx" ON public.predictive_breaches USING btree ("organizationId", period, "horizonStep", "confidenceBand");


--
-- Name: product_lines_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "product_lines_organizationId_code_key" ON public.product_lines USING btree ("organizationId", code);


--
-- Name: product_lines_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "product_lines_organizationId_idx" ON public.product_lines USING btree ("organizationId");


--
-- Name: rolling_forecast_months_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "rolling_forecast_months_organizationId_idx" ON public.rolling_forecast_months USING btree ("organizationId");


--
-- Name: rolling_forecast_months_planId_year_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "rolling_forecast_months_planId_year_month_key" ON public.rolling_forecast_months USING btree ("planId", year, month);


--
-- Name: sales_budget_lines_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sales_budget_lines_organizationId_idx" ON public.sales_budget_lines USING btree ("organizationId");


--
-- Name: sales_budget_lines_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sales_budget_lines_planId_idx" ON public.sales_budget_lines USING btree ("planId");


--
-- Name: sales_budget_lines_planId_productLineId_year_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sales_budget_lines_planId_productLineId_year_month_key" ON public.sales_budget_lines USING btree ("planId", "productLineId", year, month);


--
-- Name: sales_forecasts_organizationId_departmentId_year_month_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sales_forecasts_organizationId_departmentId_year_month_key" ON public.sales_forecasts USING btree ("organizationId", "departmentId", year, month);


--
-- Name: sales_forecasts_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sales_forecasts_organizationId_idx" ON public.sales_forecasts USING btree ("organizationId");


--
-- Name: sales_forecasts_organizationId_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sales_forecasts_organizationId_year_idx" ON public.sales_forecasts USING btree ("organizationId", year);


--
-- Name: saved_budget_reports_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "saved_budget_reports_organizationId_idx" ON public.saved_budget_reports USING btree ("organizationId");


--
-- Name: saved_budget_reports_organizationId_planId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "saved_budget_reports_organizationId_planId_idx" ON public.saved_budget_reports USING btree ("organizationId", "planId");


--
-- Name: scenarios_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "scenarios_organizationId_code_key" ON public.scenarios USING btree ("organizationId", code);


--
-- Name: scenarios_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scenarios_organizationId_idx" ON public.scenarios USING btree ("organizationId");


--
-- Name: user_layout_preferences_organizationId_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_layout_preferences_organizationId_userId_idx" ON public.user_layout_preferences USING btree ("organizationId", "userId");


--
-- Name: user_layout_preferences_userId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "user_layout_preferences_userId_name_key" ON public.user_layout_preferences USING btree ("userId", name);


--
-- Name: users_organizationId_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "users_organizationId_email_key" ON public.users USING btree ("organizationId", email);


--
-- Name: variance_explanations_organizationId_indicatorValueId_cache_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "variance_explanations_organizationId_indicatorValueId_cache_idx" ON public.variance_explanations USING btree ("organizationId", "indicatorValueId", "cachedAt" DESC);


--
-- Name: variance_explanations_organizationId_indicatorValueId_langu_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "variance_explanations_organizationId_indicatorValueId_langu_key" ON public.variance_explanations USING btree ("organizationId", "indicatorValueId", language, "promptVersion", "snapshotHash");


--
-- Name: audit_events audit_events_notify_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_notify_trg AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.notify_audit_events_changed();


--
-- Name: indicator_values indicator_values_notify_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER indicator_values_notify_trg AFTER INSERT OR UPDATE ON public.indicator_values FOR EACH ROW EXECUTE FUNCTION public.notify_indicator_values_changed();


--
-- Name: accounting_imports accounting_imports_integrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_imports
    ADD CONSTRAINT "accounting_imports_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES public.accounting_integrations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: accounting_imports accounting_imports_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_imports
    ADD CONSTRAINT "accounting_imports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: accounting_imports accounting_imports_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_imports
    ADD CONSTRAINT "accounting_imports_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: accounting_integrations accounting_integrations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_integrations
    ADD CONSTRAINT "accounting_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: accounts accounts_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_mapper_proposal_cache ai_mapper_proposal_cache_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_mapper_proposal_cache
    ADD CONSTRAINT "ai_mapper_proposal_cache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_token_usage ai_token_usage_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_token_usage
    ADD CONSTRAINT "ai_token_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: alert_events alert_events_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_events
    ADD CONSTRAINT "alert_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: alert_rules alert_rules_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT "alert_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: alerts alerts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT "alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_requests approval_requests_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT "approval_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_requests approval_requests_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT "approval_requests_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: audit_events audit_events_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: audit_events audit_events_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT "audit_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: balance_sheet_lines balance_sheet_lines_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_sheet_lines
    ADD CONSTRAINT "balance_sheet_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.chart_of_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: balance_sheet_lines balance_sheet_lines_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_sheet_lines
    ADD CONSTRAINT "balance_sheet_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: balance_sheet_lines balance_sheet_lines_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_sheet_lines
    ADD CONSTRAINT "balance_sheet_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: balance_sheet_lines balance_sheet_lines_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_sheet_lines
    ADD CONSTRAINT "balance_sheet_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: board_deck_narrations board_deck_narrations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_deck_narrations
    ADD CONSTRAINT "board_deck_narrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bookings bookings_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT "bookings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_actuals budget_actuals_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_actuals
    ADD CONSTRAINT "budget_actuals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_actuals budget_actuals_costTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_actuals
    ADD CONSTRAINT "budget_actuals_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES public.budget_cost_types(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_actuals budget_actuals_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_actuals
    ADD CONSTRAINT "budget_actuals_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public.budget_departments(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_actuals budget_actuals_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_actuals
    ADD CONSTRAINT "budget_actuals_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_approval_comments budget_approval_comments_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_approval_comments
    ADD CONSTRAINT "budget_approval_comments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_approval_comments budget_approval_comments_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_approval_comments
    ADD CONSTRAINT "budget_approval_comments_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_assumptions budget_assumptions_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_assumptions
    ADD CONSTRAINT "budget_assumptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_assumptions budget_assumptions_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_assumptions
    ADD CONSTRAINT "budget_assumptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_cost_types budget_cost_types_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_cost_types
    ADD CONSTRAINT "budget_cost_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_department_owners budget_department_owners_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_department_owners
    ADD CONSTRAINT "budget_department_owners_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public.budget_departments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_department_owners budget_department_owners_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_department_owners
    ADD CONSTRAINT "budget_department_owners_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_department_owners budget_department_owners_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_department_owners
    ADD CONSTRAINT "budget_department_owners_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_departments budget_departments_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_departments
    ADD CONSTRAINT "budget_departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_direction_templates budget_direction_templates_costTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_direction_templates
    ADD CONSTRAINT "budget_direction_templates_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES public.budget_cost_types(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_direction_templates budget_direction_templates_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_direction_templates
    ADD CONSTRAINT "budget_direction_templates_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public.budget_departments(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_forecast_entries budget_forecast_entries_costTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_forecast_entries
    ADD CONSTRAINT "budget_forecast_entries_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES public.budget_cost_types(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_forecast_entries budget_forecast_entries_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_forecast_entries
    ADD CONSTRAINT "budget_forecast_entries_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public.budget_departments(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_forecast_entries budget_forecast_entries_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_forecast_entries
    ADD CONSTRAINT "budget_forecast_entries_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_lines budget_lines_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT "budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.chart_of_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: budget_lines budget_lines_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT "budget_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_lines budget_lines_costTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT "budget_lines_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES public.budget_cost_types(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_lines budget_lines_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT "budget_lines_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public.budget_departments(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_lines budget_lines_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT "budget_lines_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public.budget_lines(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: budget_lines budget_lines_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT "budget_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_plans budget_plans_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_plans
    ADD CONSTRAINT "budget_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: budget_sections budget_sections_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_sections
    ADD CONSTRAINT "budget_sections_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cash_flow_alerts cash_flow_alerts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_flow_alerts
    ADD CONSTRAINT "cash_flow_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cash_flow_entries cash_flow_entries_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_flow_entries
    ADD CONSTRAINT "cash_flow_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.chart_of_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cash_flow_entries cash_flow_entries_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_flow_entries
    ADD CONSTRAINT "cash_flow_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chart_of_accounts chart_of_accounts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_of_accounts
    ADD CONSTRAINT "chart_of_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_reconciliations client_reconciliations_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_reconciliations
    ADD CONSTRAINT "client_reconciliations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cogs_budget_lines cogs_budget_lines_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_budget_lines
    ADD CONSTRAINT "cogs_budget_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public.chart_of_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cogs_budget_lines cogs_budget_lines_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_budget_lines
    ADD CONSTRAINT "cogs_budget_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cogs_budget_lines cogs_budget_lines_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_budget_lines
    ADD CONSTRAINT "cogs_budget_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cogs_budget_lines cogs_budget_lines_productLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_budget_lines
    ADD CONSTRAINT "cogs_budget_lines_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES public.product_lines(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cogs_cost_details cogs_cost_details_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_cost_details
    ADD CONSTRAINT "cogs_cost_details_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cogs_cost_details cogs_cost_details_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_cost_details
    ADD CONSTRAINT "cogs_cost_details_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cogs_cost_details cogs_cost_details_productLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cogs_cost_details
    ADD CONSTRAINT "cogs_cost_details_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES public.product_lines(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: companies companies_industry_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_industry_fkey FOREIGN KEY (industry) REFERENCES public.industries(code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: companies companies_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: companies companies_parentCompanyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT "companies_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: company_indicators company_indicators_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_indicators
    ADD CONSTRAINT "company_indicators_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: company_indicators company_indicators_indicatorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_indicators
    ADD CONSTRAINT "company_indicators_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES public.indicator_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cost_components cost_components_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_components
    ADD CONSTRAINT "cost_components_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cost_components cost_components_productLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_components
    ADD CONSTRAINT "cost_components_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES public.product_lines(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: counterparties counterparties_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT "counterparties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: counterparties counterparties_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counterparties
    ADD CONSTRAINT "counterparties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: currency_rate_history currency_rate_history_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_rate_history
    ADD CONSTRAINT "currency_rate_history_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: expense_forecasts expense_forecasts_costTypeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_forecasts
    ADD CONSTRAINT "expense_forecasts_costTypeId_fkey" FOREIGN KEY ("costTypeId") REFERENCES public.budget_cost_types(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: expense_forecasts expense_forecasts_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_forecasts
    ADD CONSTRAINT "expense_forecasts_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public.budget_departments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: expense_forecasts expense_forecasts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_forecasts
    ADD CONSTRAINT "expense_forecasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: feed_impact_forecasts feed_impact_forecasts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_impact_forecasts
    ADD CONSTRAINT "feed_impact_forecasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: guide_views guide_views_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guide_views
    ADD CONSTRAINT "guide_views_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: import_staging import_staging_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT "import_staging_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: import_staging import_staging_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT "import_staging_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: import_staging import_staging_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_staging
    ADD CONSTRAINT "import_staging_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: indicator_definitions indicator_definitions_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_definitions
    ADD CONSTRAINT "indicator_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: indicator_disclosures indicator_disclosures_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_disclosures
    ADD CONSTRAINT "indicator_disclosures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: indicator_values indicator_values_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_values
    ADD CONSTRAINT "indicator_values_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: indicator_values indicator_values_indicatorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.indicator_values
    ADD CONSTRAINT "indicator_values_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES public.indicator_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intel_data_points intel_data_points_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_data_points
    ADD CONSTRAINT "intel_data_points_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intel_items intel_items_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intel_items
    ADD CONSTRAINT "intel_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: operational_facts operational_facts_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_facts
    ADD CONSTRAINT "operational_facts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: period_snapshots period_snapshots_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.period_snapshots
    ADD CONSTRAINT "period_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: predictive_breaches predictive_breaches_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictive_breaches
    ADD CONSTRAINT "predictive_breaches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: product_lines product_lines_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_lines
    ADD CONSTRAINT "product_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rolling_forecast_months rolling_forecast_months_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rolling_forecast_months
    ADD CONSTRAINT "rolling_forecast_months_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rolling_forecast_months rolling_forecast_months_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rolling_forecast_months
    ADD CONSTRAINT "rolling_forecast_months_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_budget_lines sales_budget_lines_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_budget_lines
    ADD CONSTRAINT "sales_budget_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_budget_lines sales_budget_lines_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_budget_lines
    ADD CONSTRAINT "sales_budget_lines_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.budget_plans(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_budget_lines sales_budget_lines_productLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_budget_lines
    ADD CONSTRAINT "sales_budget_lines_productLineId_fkey" FOREIGN KEY ("productLineId") REFERENCES public.product_lines(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_forecasts sales_forecasts_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecasts
    ADD CONSTRAINT "sales_forecasts_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public.budget_departments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_forecasts sales_forecasts_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_forecasts
    ADD CONSTRAINT "sales_forecasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: scenarios scenarios_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT "scenarios_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_layout_preferences user_layout_preferences_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_layout_preferences
    ADD CONSTRAINT "user_layout_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_layout_preferences user_layout_preferences_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_layout_preferences
    ADD CONSTRAINT "user_layout_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: variance_explanations variance_explanations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variance_explanations
    ADD CONSTRAINT "variance_explanations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: accounting_imports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounting_imports ENABLE ROW LEVEL SECURITY;

--
-- Name: accounting_integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounting_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_mapper_proposal_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_mapper_proposal_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_token_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_token_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: alert_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;

--
-- Name: alert_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: balance_sheet_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.balance_sheet_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: board_deck_narrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_deck_narrations ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_actuals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_actuals ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_approval_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_approval_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_assumptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_assumptions ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_change_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_change_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_cost_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_cost_types ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_department_owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_department_owners ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_departments ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_direction_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_direction_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_forecast_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_forecast_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: budget_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budget_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_flow_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_flow_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_flow_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_flow_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: chart_of_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: client_reconciliations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_reconciliations ENABLE ROW LEVEL SECURITY;

--
-- Name: cogs_budget_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cogs_budget_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: cogs_cost_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cogs_cost_details ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: cost_components; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cost_components ENABLE ROW LEVEL SECURITY;

--
-- Name: counterparties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;

--
-- Name: currencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

--
-- Name: currency_rate_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.currency_rate_history ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_forecasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_forecasts ENABLE ROW LEVEL SECURITY;

--
-- Name: feed_impact_forecasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feed_impact_forecasts ENABLE ROW LEVEL SECURITY;

--
-- Name: import_staging; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_staging ENABLE ROW LEVEL SECURITY;

--
-- Name: indicator_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.indicator_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: indicator_disclosures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.indicator_disclosures ENABLE ROW LEVEL SECURITY;

--
-- Name: indicator_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.indicator_values ENABLE ROW LEVEL SECURITY;

--
-- Name: industries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;

--
-- Name: intel_data_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intel_data_points ENABLE ROW LEVEL SECURITY;

--
-- Name: intel_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intel_items ENABLE ROW LEVEL SECURITY;

--
-- Name: operational_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operational_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: period_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.period_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: predictive_breaches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.predictive_breaches ENABLE ROW LEVEL SECURITY;

--
-- Name: product_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: rolling_forecast_months; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rolling_forecast_months ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_budget_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_budget_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_forecasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_forecasts ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_budget_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_budget_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: scenarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: accounting_imports tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.accounting_imports USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: accounting_integrations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.accounting_integrations USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: ai_mapper_proposal_cache tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ai_mapper_proposal_cache USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: ai_token_usage tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ai_token_usage USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: alert_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.alert_events USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: alert_rules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.alert_rules USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: alerts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.alerts USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: approval_requests tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.approval_requests USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: audit_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.audit_events USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: balance_sheet_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.balance_sheet_lines USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: board_deck_narrations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.board_deck_narrations USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: bookings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.bookings USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_actuals tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_actuals USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_approval_comments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_approval_comments USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_assumptions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_assumptions USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_change_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_change_logs USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_cost_types tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_cost_types USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_department_owners tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_department_owners USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_departments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_departments USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_direction_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_direction_templates USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_forecast_entries tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_forecast_entries USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_lines USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_plans tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_plans USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: budget_sections tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.budget_sections USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: cash_flow_alerts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.cash_flow_alerts USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: cash_flow_entries tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.cash_flow_entries USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: chart_of_accounts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.chart_of_accounts USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: client_reconciliations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.client_reconciliations USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: cogs_budget_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.cogs_budget_lines USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: cogs_cost_details tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.cogs_cost_details USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: companies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.companies USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: cost_components tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.cost_components USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: counterparties tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.counterparties USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: currencies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.currencies USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: currency_rate_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.currency_rate_history USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: expense_forecasts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.expense_forecasts USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: feed_impact_forecasts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.feed_impact_forecasts USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: import_staging tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.import_staging USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: indicator_definitions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.indicator_definitions USING ((("organizationId" IS NULL) OR ("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: indicator_disclosures tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.indicator_disclosures USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: indicator_values tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.indicator_values USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: industries tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.industries USING (true);


--
-- Name: intel_data_points tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.intel_data_points USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: intel_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.intel_items USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: operational_facts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.operational_facts USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: period_snapshots tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.period_snapshots USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: predictive_breaches tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.predictive_breaches USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: product_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.product_lines USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: rolling_forecast_months tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.rolling_forecast_months USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: sales_budget_lines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.sales_budget_lines USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: sales_forecasts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.sales_forecasts USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: saved_budget_reports tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.saved_budget_reports USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: scenarios tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.scenarios USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: user_layout_preferences tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.user_layout_preferences USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: users tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.users USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: variance_explanations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.variance_explanations USING ((("organizationId" = current_setting('app.organization_id'::text, true)) OR (current_setting('app.bypass_rls'::text, true) = 'true'::text)));


--
-- Name: user_layout_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_layout_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: variance_explanations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.variance_explanations ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


