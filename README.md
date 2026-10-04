# LEXRENT

Public repository: [newpoluton-alt/LEXRENT](https://github.com/newpoluton-alt/LEXRENT).

Live app: [LEXRENT](https://lexrent-zeta.vercel.app). Production is public; Vercel preview deployments remain protected. LEXRENT sign-in is still required for saved work and paid AI, and publication tools require a verified administrator.

A rental housing law research workspace for the Rental Housing Law Navigator challenge. It connects a property to source evidence, separates pending laws from enacted requirements, and explains missing facts rather than guessing coverage.

One Next.js deployment contains the React frontend, Hono API, deterministic rule engine, source ingestion, Neon Auth, Neon Postgres persistence with pgvector, and Claude extraction and grounded answers. The frontend follows the [original LEXRENT Lovable project](https://lovable.dev/projects/c3e1fb53-d8d2-42f7-a0ef-1775909ab00a): cream, royal blue, yellow, Lexend, rectangular controls and the illustrated city motif.

## Lovable frontend port

The original `lexrent/` TanStack Start export is kept as a reference. Its design is ported to the active Next.js app: the original Lexend palette, header and skyline, address/date hero, Overview/List/Summary tabs, map-and-law panel, evidence dialog, guided fact quiz, bilingual About/Rights pages, and a matching account screen. The active components live in `src/components/lovable/`; the route remains `app/page.tsx`.

The imported prototype's static `laws.ts` verdicts, confidence arithmetic and nationwide claims are not used. Search selects an actual supported property; every evaluation uses the existing Hono rule engine and captured source evidence. Public maps use Leaflet with OpenStreetMap tiles and Photon address search for visual orientation only and never establish legal jurisdiction. No additional map API key is required. The map opens immediately at a local postal-area center, even when Photon has no match or is unavailable. A matching street gets a street map without a property pin; an address pin requires the matching house number, street, postal place, state and country. View labels distinguish these cases. Searches are cached briefly in the browser session, and only the selected sample address is sent to Photon. Tile attribution remains visible, including in print. Street-level imagery is offered through an external Google Maps link; the export's embedded Google connector credentials are not copied into this deployment.

`/workspace` retains real Claude/vector research, the source library, law-change cases, private saved properties and verified-admin publication tools. The home exposes Census boundary resolution to verified admins. Authentication returns users to the property or assistant context from which they signed in. The List tab browses the supported 500-property sample rather than inventing client-side verdicts for browsing history. Summary printing and JSON downloads preserve the exact evaluation snapshot and incomplete-coverage status.

To check the map, search `1619 COMMONWEALTH AV` in Brighton, MA (`A0048`) and open Overview: a matching address shows a location pin. `6238 DE LONGPRE AVE` in Los Angeles (`A0001`) and `1031-1035 CLINTON ST` in Hoboken (`A0002`) can show their matching street without inventing an exact building location. Zoom buttons, dragging and Reset view are available without signing in.

The reference folder is excluded from the active TypeScript compilation and Vercel deployment. All `.env` files, including the reference export's browser connector credentials, remain ignored.

## Run locally

Use Node.js 24 or newer. The supplied development/build scripts use Next.js’s supported Webpack compiler; this avoids the Tailwind/PostCSS worker port restriction in the local sandbox.

```sh
npm ci
cp .env.example .env
# Configure the server variables below.
npm run db:migrate
# Optional: populate the current source vectors before the first chat request.
npm run rag:index
npm run dev
```

Open http://localhost:3000. Public source and property exploration works without credentials. Accounts, saved work and rule imports require the configured services. Database failures never silently substitute an empty verified rule set.

## Server environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string, including its database role credentials. This is the runtime database credential. |
| `NEON_AUTH_BASE_URL` | The Neon branch Auth endpoint for Better Auth. |
| `NEON_AUTH_COOKIE_SECRET` | A cryptographically random secret of at least 32 characters for signed session cookies. |
| `LEXRENT_ADMIN_EMAILS` | Comma-separated administrator emails. Admin access also requires an upstream-verified email and a live server session. |
| `ANTHROPIC_API_KEY` | Claude API key, used only on the server for real extraction and answers. |
| `CLAUDE_MODEL` | Defaults to `claude-sonnet-5-5`. Override with a model enabled for your API account. |
| `APP_URL` | App origin for project configuration. Request-origin checks use the actual request URL; Neon callback origins are whitelisted in Neon Auth. |
| `NEON_API_KEY` | Optional Neon management credential; not required by the application. A management key does not replace `DATABASE_URL`. |

Do not use `NEXT_PUBLIC_` for credentials. `.env` and `.vercel` are ignored by Git. `.env.example` contains only placeholders. Set production variables in Vercel’s project environment settings, then redeploy after a change.

Enable the Google provider in Neon Auth and whitelist the app’s actual production origin; localhost must be enabled for local development. Email/password users must verify their email before an allowlisted email can obtain administrator access. Google sign-in supports verified admin emails.

Google sign-in and new accounts return through `/auth/callback`. The Next.js proxy completes Neon's one-time challenge/verifier exchange and preserves the SDK's HTTP-only app cookies; the callback checks the live session before returning to the original property or workspace. Embedded OAuth uses a same-origin popup bridge before the exchange. Ordinary public pages remain public. Email sign-in/sign-up also checks `/api/me` before claiming a successful login. The header shows the verified user's name (or email when no name is supplied), and the header, saved work and AI controls share one account state that refreshes on navigation, focus and sign-in/sign-out in another tab. Authentication failures are shown with a retry action rather than a silent redirect.

## What works

- Search and paginate the supplied 500 properties across California, New Jersey and Massachusetts; show incomplete assessor facts and suspect ZIPs.
- Inspect all 87 manifest sources, including 54 captured documents and uncaptured links. Read source text, retrieval dates and evidence quotes.
- Query a property on a particular date. A law may create several independently evaluated requirements. Typed predicates support combined conditions and exemptions.
- Evaluate rolling certificate-age conditions using `certificate_age_years`, derived from the certificate-of-occupancy date and query date. Missing, invalid or future certificate dates remain unknown; year built never substitutes for the certificate.
- Resolve legal city boundaries through the official Census geocoder. Postal aliases, ambiguous matches and address ranges cannot silently establish a legal municipality.
- Add temporary scenario facts to a lookup; these are labelled as supplied inputs, not verified assessor data.
- Sign in, save properties privately, and persist immutable evaluation snapshots with a rule-version reference.
- Run the five supplied change cases and export `rules.json`, `lookups.json`, `changes.json`, and a separate submission readiness report.
- Import reviewed, source-backed rule bundles. Validation rejects fabricated quotations, unknown source references, invalid dates and executable-code conditions.
- Ask Claude grounded questions with citations and optional address/date context. The supplied Python bot’s grounding instructions and JSONL knowledge base are incorporated into the monolith; it needs no separate Python service or unrestricted cloud-agent environment.
- Retrieve evidence with weighted lexical/vector search using the supplied 128-dimensional LSA model and Neon pgvector. Updated captures produce a new versioned corpus; old source vectors cannot support current answers.
- Extract atomic, structured requirement drafts from captured sources using Claude. Long documents are processed in overlapping chunks, with resumable progress and explicit review before publication.

## Corpus and legal coverage

The build reads `participant-final-no-hour16 3/` and the supplied `AI RAG/` knowledge base. It validates the 568 supplied law chunks against authoritative captured documents, restores exact original whitespace for quotations, and compiles the chunks into `src/data/challenge.json`. The supplied 500 address records and 33 uncaptured-source links remain traceable to the manifest. Link-only records cannot support citations.

No legal rules are seeded or fabricated. The initial corpus is searchable, but a complete challenge submission requires reviewed rule imports, relevant verified municipal boundaries, missing fact review and all five evaluated change cases. The readiness flag checks that rules exist and all five cases are marked evaluated; it reports unresolved addresses separately and does not certify source, fact or legal completeness. Property results always retain `coverage_complete: false`. AI answers are research summaries; they do not replace the deterministic applicability engine or certify a complete legal analysis.

The original `AI capabilities/build_agent_v1.py` is preserved as a separate reference/optional experiment. Its credential now comes from `ANTHROPIC_API_KEY`, and its file paths are relative to the script. Its beta managed-agent environment is not created by LEXRENT. The deployed app uses the supported Claude Messages SDK with bounded retrieval and source validation.

## Vector retrieval

`AI RAG/kb_index.npz` supplies a fitted TF-IDF vocabulary, IDF weights and truncated-SVD projection. `scripts/build-vector-model.ts` exports that fixed model into the checked-in, server-only `src/data/vector-model.json`; TypeScript computes normalized 128-dimensional vectors for questions and validated source chunks. These are local LSA vectors, not neural embeddings. No Python service or additional embedding API key is required; Claude answers still require `ANTHROPIC_API_KEY`.

Run `npm run vector:model` to regenerate the export after changing the supplied NPZ. Normal builds use the checked-in model JSON and do not fit a model at runtime. GitHub retains the original `AI RAG/` files. Vercel receives the knowledge JSONL for build validation and deploys the compiled model and source chunks; the Python experiments, NPZ and duplicate vector dataset are excluded from deployment.

Neon stores versioned corpora and chunks in `lexrent_vector_corpora` and `lexrent_vector_chunks`. A corpus fingerprint includes the model identity and current validated chunk content and metadata. Indexing is idempotent and atomic, runs lazily when needed, and can be triggered with `npm run rag:index`. A signed-in, verified administrator can also request `POST /api/admin/vector-index`; the server checks the administrator allowlist and records the index operation. Previous corpora remain preserved. New source text is projected with the same fitted model; retrieval requires current source hashes and URLs, so a changed capture cannot reuse stale evidence.

Search combines lexical and cosine-distance rankings using weighted reciprocal rank fusion, with lexical weight 2 and vector weight 1. The 568 captured chunks use exact pgvector cosine search; an approximate HNSW index is unnecessary at this size. Lexical retrieval remains available when vector storage is unavailable or a question has no usable model vocabulary. Existing multilingual topic aliases help retrieval, but the supplied ASCII tokenizer is not a general multilingual embedding model. Evidence quotes are validated independently of their retrieval rank.

## Review workflow

1. Sign in with a verified, allowlisted administrator account.
2. In Rule workspace, select captured sources. For an uncaptured manifest document, upload its permitted exact text, matching source URL and retrieval time first.
3. Extract drafts. Review all chunks, resolve contradictory dates and interactions, deduplicate obligations and check exemption coverage.
4. Review the JSON, then validate and import it. Imports merge by rule ID unless the API explicitly receives `mode: "replace"`.
5. Resolve city boundaries for the relevant sample properties and add necessary scenario facts.
6. Run the change cases, inspect the readiness report, then export the three submission artifacts.

Source text alone does not prove that a proposed bill became law. A matching quote validates provenance, not the accuracy of a model’s interpretation. Review legislative status, conditions and preemption before import. A source revision that removes the active evidence quote blocks legal evaluation while leaving source inspection and administrator repair available. Rule versions retain source snapshots for audit.

AI retrieval shows selected passages rather than the complete document. A missing passage cannot establish that the full document lacks a rule or exception. Quote validation checks the stored capture, not the live official page; administrators must review source completeness and authority before publication.

`certificate_age_years` counts completed calendar anniversaries and is recomputed for every query after scenario inputs are applied. For a certificate dated `2011-10-04`, the age is 14 on `2026-10-03` and 15 on `2026-10-04`; a February 29 certificate reaches its anniversary on March 1 in a non-leap year. The API accepts the certificate date, never a caller-supplied derived age. This enables rolling age predicates without freezing a cutoff date into a rule; it does not establish the exemption's legal interpretation.

## Access and AI usage

Public reads do not require sign-in. Paid chat requires a live authenticated account; extraction, source captures, boundary resolution and rule publication require a verified administrator. Private collections and evaluations are filtered by the server’s session owner. State and legal city cannot be overwritten by scenario inputs.

AI attempts have durable Postgres limits, shared across deployment instances: 20 chat attempts per account per hour, 60 extraction attempts per administrator per hour, and 200 total AI attempts per hour. Provider failures also consume an attempt. Extraction drafts are cached by document content hash, source identity, model, prompt version and chunk. No draft is automatically published as law.

## Verify and deploy

```sh
npm run typecheck
npm test
npm run build
vercel --prod
```

The opt-in Neon integration test writes temporary records for random test owners and removes only those records:

```sh
RUN_NEON_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/auth/neon-live.test.ts
```

Production runs on Node.js in Vercel’s `iad1` region. The API shares the same origin and deployment as the frontend. SQL migrations are additive and repeatable. Do not publish `.env`, auth cookies, API tokens, private account data or project magic links.

See [architecture and team ownership](docs/architecture.md) and the code-rendered [architecture diagrams](architecture/architecture-notes.md).
