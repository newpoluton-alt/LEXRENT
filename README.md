# LEXRENT

Public repository: [newpoluton-alt/LEXRENT](https://github.com/newpoluton-alt/LEXRENT).

A rental housing law research workspace for the Rental Housing Law Navigator challenge. It connects a property to source evidence, separates pending laws from enacted requirements, and explains missing facts rather than guessing coverage.

One Next.js deployment contains the React frontend, Hono API, deterministic rule engine, source ingestion, Neon Auth, Neon Postgres persistence, and Claude extraction and retrieval. The frontend follows the [original LEXRENT Lovable project](https://lovable.dev/projects/c3e1fb53-d8d2-42f7-a0ef-1775909ab00a): cream, royal blue, yellow, Lexend, rectangular controls and the illustrated city motif.

## Run locally

Use Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
# Configure the server variables below.
npm run db:migrate
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
- Extract atomic, structured requirement drafts from captured sources using Claude. Long documents are processed in overlapping chunks, with resumable progress and explicit review before publication.

## Corpus and legal coverage

The build reads `participant-final-no-hour16 3/` and `AI capabilities/rag_knowledge_base.jsonl`. It validates the 568 supplied law chunks against authoritative captured documents, restores exact original whitespace for quotations, and compiles the index into `src/data/challenge.json`. The supplied 500 address records and 33 uncaptured-source links remain traceable to the manifest.

No legal rules are seeded or fabricated. The initial corpus is searchable, but a complete challenge submission requires reviewed rule imports, relevant verified municipal boundaries, missing fact review and all five evaluated change cases. The readiness flag checks that rules exist and all five cases are marked evaluated; it reports unresolved addresses separately and does not certify source, fact or legal completeness. Property results always retain `coverage_complete: false`. AI answers are research summaries; they do not replace the deterministic applicability engine or certify a complete legal analysis.

The original `AI capabilities/build_agent_v1.py` is preserved as a separate reference/optional experiment. Its credential now comes from `ANTHROPIC_API_KEY`, and its file paths are relative to the script. Its beta managed-agent environment is not created by LEXRENT. The deployed app uses the supported Claude Messages SDK with bounded retrieval and source validation.

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
