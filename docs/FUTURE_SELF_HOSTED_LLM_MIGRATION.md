# Prompt: Migrate BudgetPro AI Analytics to Self-Hosted LLM

> **How to use this file:** paste the entire contents of this file into a new Claude Code session and say "Execute this plan". The prompt is self-contained — it assumes no memory of the original conversation. At the time this plan runs, the existing Anthropic-cloud implementation from the current session is already deployed and working.

---

## 1. Context and motivation

BudgetPro stores detailed financial data (P&L, Balance Sheet, COGS, Cash Flow, Assumptions) for each client organization. The v1 AI analytics feature sends this data to Anthropic's cloud API (US servers) for analysis. Anthropic's ToS states that API data is not used for training and is retained only for 30 days of abuse monitoring, but several prospective clients (manufacturing, banking, compliance-heavy industries) require that **financial data never leaves their infrastructure.**

This plan migrates the AI layer to a fully self-hosted stack:

- **LLM**: open-weights model (Llama 3.3 70B or Qwen 2.5 72B) served via **vLLM** on a dedicated GPU server
- **Web search**: **SearXNG** (self-hosted meta-search), so benchmark queries don't go through a third party either
- **Benchmarks knowledge base**: pre-loaded industry benchmarks stored in **pgvector** inside the existing PostgreSQL, queried by the LLM via retrieval (RAG)
- **Embeddings**: local model (`nomic-embed-text` served through vLLM or Ollama)
- **Protocol compatibility**: vLLM exposes an OpenAI-compatible API, so the application layer changes from Anthropic SDK calls to OpenAI SDK calls against the self-hosted endpoint

When this migration is done, BudgetPro is sellable to clients with GDPR / banking-grade data-residency requirements and no data leaves the client's VPC.

## 2. Current state (read this before planning)

Before you start, read these files to understand the v1 implementation:

```
src/lib/ai/client.ts                      # Anthropic SDK wrapper
src/lib/ai/section-context.ts             # Per-section data collectors
src/lib/ai/tools.ts                       # Tool definitions (web_search + custom)
src/lib/ai/prompts.ts                     # System prompts
src/app/api/budgeting/ai-analytics/route.ts   # SSE-streamed endpoint
src/components/ai-analytics-button.tsx
src/components/ai-analytics-panel.tsx
src/components/ai-chat-message.tsx
```

Also read `docs/ROADMAP.md` and `.env.example` to see what environment the app runs in.

## 3. Target architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Client Infrastructure (VPC / on-prem)                            │
│                                                                  │
│  ┌─────────────────┐   private HTTP   ┌─────────────────┐        │
│  │ BudgetPro       │ ───────────────► │ vLLM inference  │        │
│  │ Next.js app     │                   │ server (GPU)   │        │
│  │ (existing)      │                   │ - 70B chat LLM │        │
│  └────────┬────────┘                   │ - nomic embed  │        │
│           │                             └─────────────────┘      │
│           │                                                       │
│           ├──► SearXNG (self-hosted meta search, port 8080)     │
│           │                                                       │
│           └──► PostgreSQL (existing)                             │
│                 + pgvector extension                             │
│                 + `industry_benchmarks` table                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Nothing reaches the public internet **except** SearXNG hits the client's approved search backends (Brave/Bing/Google) — and those requests carry search keywords only, not the financial data itself.

## 4. Server specs — RECOMMENDED (not minimum)

These specs are sized for comfortable production with 10-20 concurrent users and Llama 3.3 70B or Qwen 2.5 72B at ~16 tokens/sec per user. They are NOT the absolute minimum — they are the configuration the team should actually provision.

### 4.1 Single-server deployment (up to ~5 concurrent users)

| Component | Recommendation |
|-----------|----------------|
| GPU | 2× NVIDIA RTX 6000 Ada Generation (48GB VRAM each) NVLinked, or 1× NVIDIA H100 NVL (94GB) |
| CPU | AMD EPYC 9354 (32C/64T) or Intel Xeon Platinum 8462Y+ |
| RAM | 256 GB DDR5 ECC |
| Storage | 2× 2TB NVMe Gen4 (one for OS, one for model weights and pgvector) |
| Network | 10 GbE internal |
| OS | Ubuntu 24.04 LTS Server |
| Power | 1600W redundant PSU |
| Budget (purchase) | ~$22,000 - $35,000 one-time |
| Budget (cloud rent) | RunPod / Lambda: ~$2.50 - $4/hour (A100/H100 on-demand) |

### 4.2 Production-grade deployment (20-50 concurrent users)

| Component | Recommendation |
|-----------|----------------|
| GPU | 2× NVIDIA H100 NVL 94GB NVLinked, OR 4× H100 80GB SXM |
| CPU | Dual AMD EPYC 9554 (64C/128T each) |
| RAM | 512 GB DDR5 ECC |
| Storage | 4× 3.84TB NVMe Gen4 RAID10 |
| Network | 2× 25 GbE bonded |
| OS | Ubuntu 24.04 LTS |
| Power | dual 2000W redundant PSU |
| Budget (purchase) | ~$80,000 - $120,000 one-time |
| Budget (cloud rent) | AWS p5.48xlarge, Lambda 8×H100: ~$12 - $30/hour |

### 4.3 Cloud deployments (rental) worth knowing

- **AWS Bedrock** for Llama — managed, BAA available, ~$2-3/M input tokens
- **RunPod Serverless** — pay per inference second, cheapest for spiky load
- **Lambda Labs Cloud** — dedicated A100/H100 hourly, good for steady load
- **Azure AI Foundry** hosting — for clients already on Azure

### 4.4 What NOT to recommend

- Consumer RTX 4090 (24 GB only) — you'd need heavy 4-bit quant which hurts quality; avoid for production
- Single A100 40 GB — not enough headroom for 70B + KV cache at production batch sizes
- Apple Silicon — inference is possible via llama.cpp but too slow for multi-user SaaS

## 5. Sub-tasks — execute in this exact order

### Phase M.1 — Abstract the LLM client behind an interface (~4 hours)

**Goal:** make swapping providers a single-file change.

1. Create `src/lib/ai/providers/types.ts` with a `LLMProvider` interface:
   ```ts
   interface LLMProvider {
     stream(request: ChatRequest): AsyncIterable<StreamEvent>
     embed(text: string): Promise<number[]>
   }
   ```
2. Move the existing Anthropic code into `src/lib/ai/providers/anthropic.ts` — it implements `LLMProvider`.
3. Update `src/lib/ai/client.ts` to return the configured provider based on env var `LLM_PROVIDER` (`anthropic` | `openai-compatible`).
4. Keep Anthropic as default so nothing changes for existing deployments.
5. Run existing verification — UI still works end to end.

### Phase M.2 — Add the OpenAI-compatible adapter (~4 hours)

**Goal:** support talking to vLLM using OpenAI's protocol.

1. Install `openai` npm package.
2. Create `src/lib/ai/providers/openai-compatible.ts` implementing `LLMProvider`:
   - `baseURL` from env `LLM_BASE_URL` (e.g. `http://gpu-1.internal:8000/v1`)
   - `apiKey` from env `LLM_API_KEY` (can be a dummy value, vLLM doesn't validate)
   - Uses `openai.chat.completions.create({ stream: true })`
   - Converts OpenAI delta events into the common `StreamEvent` shape
3. Translate Claude's tool-use format (`<tool_use>`) into OpenAI's `tool_calls` JSON structure in the adapter so prompts.ts remains unchanged.
4. Test the adapter against a public Llama endpoint (Together AI or Fireworks) first to validate contract, then point at self-hosted.

### Phase M.3 — Provision the GPU server + install vLLM (~1 day)

**Goal:** have a reliable LLM endpoint on the client's infrastructure.

1. Provision the box per Section 4 of this document.
2. Install NVIDIA driver ≥ 560, CUDA 12.4, cuDNN 9.
3. Install Docker + NVIDIA Container Toolkit.
4. Launch vLLM via Docker:
   ```bash
   docker run --gpus all --ipc=host \
     -p 8000:8000 \
     -v /mnt/models:/models \
     vllm/vllm-openai:latest \
     --model meta-llama/Llama-3.3-70B-Instruct \
     --tensor-parallel-size 2 \
     --max-model-len 32768 \
     --download-dir /models
   ```
5. Hit `POST /v1/chat/completions` from the BudgetPro box to confirm.
6. Set up `systemd` unit for auto-start on reboot.
7. Configure `nginx` in front of vLLM with TLS cert (self-signed OK for private network) and a bearer-token check so the BudgetPro app is the only client.

### Phase M.4 — Self-hosted web search (~half day)

**Goal:** let the LLM browse benchmarks without routing queries through a third-party API.

1. Deploy SearXNG via Docker:
   ```bash
   docker run -d -p 8080:8080 -v /etc/searxng:/etc/searxng \
     searxng/searxng:latest
   ```
2. Configure engines: enable Brave, Bing, Wikipedia, DuckDuckGo; disable logging.
3. Expose `/search?q=...&format=json` on an internal hostname.
4. Rewrite the `web_search` tool in `src/lib/ai/tools.ts` to call SearXNG JSON API instead of Anthropic's native tool. Return top 5 results with title + url + snippet.
5. Claude's native `web_search` tool is only available when using the Anthropic provider. The OpenAI-compatible path always uses this custom tool.

### Phase M.5 — Embedding model + benchmarks RAG (~1 day)

**Goal:** let the LLM pull industry benchmarks by embedding similarity without internet access at all.

1. Serve `nomic-embed-text` via the same vLLM server (add `--served-model-name` flags) or a sidecar Ollama container.
2. Add `pgvector` extension to PostgreSQL:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Create `industry_benchmarks` table:
   ```sql
   CREATE TABLE industry_benchmarks (
     id TEXT PRIMARY KEY,
     industry TEXT,
     region TEXT,
     metric TEXT,
     value FLOAT,
     year INT,
     source TEXT,
     embedding vector(768)
   );
   CREATE INDEX ON industry_benchmarks USING ivfflat (embedding vector_cosine_ops);
   ```
4. Seed with curated benchmarks (cement, construction, retail, SaaS, manufacturing) scraped from IMF, CBR, PwC, KPMG annual reports. Start with ~500 rows.
5. Add a tool `search_benchmarks({ industry?: string, metric?: string, query: string })` that embeds `query`, runs cosine similarity, returns top 5 rows.
6. Prefer this tool in the system prompt for factual comparisons, falling back to SearXNG when the benchmark isn't in the KB.

### Phase M.6 — Admin toggle + privacy UX (~half day)

**Goal:** explicit opt-in, auditable.

1. Add `Organization.features.aiEnabled: boolean` (default `false`).
2. Admin UI: toggle in Organization Settings → AI → "Enable AI Analyst" with fine-grained radio:
   - **Off** (default)
   - **Self-hosted only** (uses the client's LLM — recommended)
   - **Cloud provider** (uses Anthropic — faster first-time setup, shows warning)
3. Store `User.aiConsentAt` — first click on the AI button triggers a modal that shows which provider is configured, where data goes, and requires explicit "I understand" click.
4. Log every AI request in a dedicated `ai_audit_log` table: orgId, userId, section, requestAt, tokensIn, tokensOut, toolsUsed.

### Phase M.7 — Verification and rollout (~half day)

1. Point one non-production environment at the self-hosted stack (`LLM_PROVIDER=openai-compatible`).
2. Run the existing verification scripts from the v1 build (`scripts/verify-ai-analytics.ts`) — they should pass unchanged because the interface is the same.
3. Measure latency: first token under 2 seconds, full response under 20 seconds for a P&L analysis.
4. Security review: confirm GPU server has no public IP, firewall allows only BudgetPro app server on port 443, nginx access logs show only expected clients.
5. Sign the client's DPA; document the stack in their security questionnaire (SOC 2, ISO 27001).
6. Flip the toggle on for the client; keep Anthropic path available for internal demo orgs.

## 6. Files that will change

- **Modified**:
  - `src/lib/ai/client.ts` — provider factory
  - `src/lib/ai/tools.ts` — swap Anthropic web_search for SearXNG + benchmarks RAG
  - `src/app/api/budgeting/ai-analytics/route.ts` — unchanged externally; provider chosen via env
  - `src/components/ai-analytics-panel.tsx` — privacy banner showing active provider
  - `.env.example` — add `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `SEARXNG_URL`
  - `prisma/schema.prisma` — `features Json?` on Organization, `ai_audit_log` model
- **New**:
  - `src/lib/ai/providers/types.ts`
  - `src/lib/ai/providers/anthropic.ts`
  - `src/lib/ai/providers/openai-compatible.ts`
  - `src/lib/ai/benchmarks-rag.ts`
  - `scripts/seed-industry-benchmarks.ts`
  - `docs/OPS_SELF_HOSTED_LLM.md` — runbook for the ops team
- **Deleted**: nothing (Anthropic path kept for non-privacy-critical orgs)

## 7. Budget summary

| Option | CapEx | OpEx / month | Latency | Privacy |
|--------|-------|--------------|---------|---------|
| Keep Anthropic cloud (status quo) | $0 | ~$50-200 per client | ~1s first token | ⚠️  US servers |
| RunPod / Lambda rented GPU | $0 | ~$1500-3000 | ~2s first token | ✅ client VPC |
| On-prem single server (4.1) | $30k | $200 power + ops | ~2s first token | ✅ fully local |
| On-prem production (4.2) | $100k | $500 power + ops | ~1.5s first token | ✅ fully local |

## 8. Success criteria

- [ ] All v1 AI features work with `LLM_PROVIDER=openai-compatible` pointed at self-hosted vLLM
- [ ] Zero external HTTP calls from the app server during an AI analysis (verified via tcpdump)
- [ ] DPA with the pilot client signed
- [ ] Latency within 2× of Anthropic cloud baseline
- [ ] Benchmarks RAG returns sensible top-5 for at least 10 sample queries
- [ ] Admin can flip between providers per-org without code deploy
- [ ] Ops runbook documents start/stop/restart/model swap

## 9. Open decisions for the future session to resolve

1. **Model choice**: Llama 3.3 70B (Meta community license, widely tested) vs Qwen 2.5 72B (Apache 2.0, slightly better at financial reasoning per own benchmarks). Recommend starting with Llama 3.3 because community tooling is more mature.
2. **Hosting**: on-prem server at client DC vs dedicated cloud (RunPod/Lambda) vs AWS Bedrock managed. Recommendation depends on client's existing infrastructure; start with RunPod for the first paying client, migrate to on-prem when scale demands it.
3. **Benchmarks source**: scrape public reports vs buy from data provider (Statista, IBISWorld). Start with curated public data (~500 rows), add commercial source if a client needs it.

## 10. Important constraints to remember during execution

- English-only product — no multilingual embeddings or prompts needed
- Enterprise B2B — no self-serve sign-up, no billing integration
- The v1 cloud implementation remains supported for free-tier / non-privacy-critical deployments; this migration is additive, not a replacement
- All tenancy rules still apply — every AI call reads `session.organizationId` and the context collectors scope queries accordingly
- Keep prompt caching equivalent on the self-hosted side (vLLM supports it via `--enable-prefix-caching`)
