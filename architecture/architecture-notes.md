# Rental Housing Law Navigator — architecture review

These concept diagrams refine the supplied handwritten sketch against the participant guide, rule schema and submission templates. LEXRENT now implements these responsibilities in a single Next.js and Hono deployment. See [the implemented architecture](../docs/architecture.md) for the current Neon tables, authentication and request flows; the JPG database diagram shows the logical legal-data model rather than the exact SQL migration.

## Diagrams

- `01-system-architecture.jpg`: AI, backend and frontend team lanes, with document inputs, an AI processor, an evidence decision, a versioned-data cylinder, API handoff and browser interface.
- `02-lookup-and-change-flow.jpg`: backend property lookup and the five change cases using the same evaluator.
- `03-database-relationships.jpg`: eight logical entities, primary/foreign keys and one-to-many relationships, including one law with multiple distinct requirements.
- `04-request-and-evidence-sequence.jpg`: AI ingestion followed by frontend/backend/storage lifelines, requests, responses and processing intervals.
- Matching SVGs retain editable vector shapes and text. All JPGs are 4800 pixels wide; heights range from 3560 to 4400 pixels.
- `render_diagrams.py` regenerates the files using Pillow and local Avenir Next / Menlo fonts.

## Corrections to the handwritten sketch

| Sketch element | Correction | Why it matters |
| --- | --- | --- |
| Addresses feed legal extraction | Keep a separate property-data stream: normalization → legal jurisdiction → applicability engine. | Property facts should not be inferred by Claude from legal text. |
| Manifest and links behave like laws | Use the manifest for source identity and capture status. A URL without captured text is a source-acquisition task. | A link is not sufficient evidence for an extracted legal requirement. |
| “Merging” associates addresses with laws | Replace merging with jurisdiction resolution, date evaluation, coverage predicates, precedence and conflict handling. | Joining records on city names cannot establish legal applicability. |
| Mailing city identifies the legal city | Resolve the actual municipality and preserve uncertain matches. | Postal neighborhoods, aliases and bad ZIPs can select the wrong rules. |
| “Laws + description per address” is the final record | Return rule ID, explicit result, explanation, conflict flag, query date and evidence references. | The answer needs to show why a rule applies or why coverage remains unknown. |
| Rules are effectively timeless | Store lifecycle events and effective dates; select rule versions and derive status for the query date. | Pending, failed and future-effective laws must not become current protections. Retrieval date is not effective date. |
| No missing-fact branch | Represent missing unit counts, occupancy dates, ownership facts and unresolved locations explicitly. | The challenge accepts `unknown`; guessing can turn an otherwise correct extraction into a wrong answer. |
| Source links added after matching | Keep document ID, URL, retrieval date, document hash, exact quotation and location with the rule from extraction onward. | Evidence must survive every stage and be reproducible. |
| No change-test workflow | Run T1–T5 through the same applicability engine, using each case's dates, scenario and affected-set definition. | Change impact is a separate required output; hypothetical impact is separate from current law. |
| App consumes an unspecified merged folder | Define a stable API response contract and export submission JSON upstream. | Frontend display logic should not decide legal applicability or generate the submission results. |

## Team ownership and handoffs

**Claude teammate — legal extraction.** Inventory and acquire permitted sources, chunk source sections, extract structured candidates, validate schema and supporting quotations, deduplicate, flag uncertainties and export verified rules. Preserve the original source and extraction versions. Use bounded retries and cached source hashes so the live demo is reproducible.

**Codex teammate — matching, changes and API.** Normalize the 500 properties, resolve legal state/city, preserve missing facts, evaluate typed coverage conditions, compute date-dependent status and supported state/local precedence, flag conflicts, run T1–T5 and expose the results through an API. Use explicit predicates rather than executing model-generated code.

**Lovable teammate — frontend.** Build address search/selection, the query-date control, protection cards, missing-fact prompts, a source-evidence drawer and the change explorer. Display the backend's statuses and explanations. Include a persistent “Not legal advice” notice as required by the participant guide.

The first handoff is a **verified rule bundle** from the AI team to the backend team. The second is a **stable result/evidence API contract** from the backend team to the frontend team. Agree on IDs and representative responses early. The API and shared storage are owned by the backend team; the AI team produces verified legal records, and the frontend reads evaluated results through the API.

## One law can create multiple requirements

Model a law as a parent container, with a separate stable `team_rule_id` for each distinct obligation or protection. Each requirement can have different coverage conditions, exemptions, triggers and operative dates. Keep successive versions under the same stable rule ID. Evaluate each rule version for the particular property, query date and scenario.

NYC Good Cause is an illustrative example: it includes eviction/nonrenewal protections, a standard for challenging unreasonable rent increases, and notice duties. The main protections and the notice duties also have different start dates. [NYC HPD guidance](https://www.nyc.gov/site/hpd/services-and-information/good-cause-eviction.page). The notice provision addresses applicability and inapplicability, so notice logic must not simply inherit the substantive protections' coverage flag. [New York Real Property Law § 231-c](https://www.nysenate.gov/legislation/laws/RPP/231-C).

This example explains the architecture. The challenge's actual build remains scoped to the supplied CA/NJ/MA corpus and its required categories.

Distinguish **multiple requirements under one law** from **multiple conditions within one requirement**. A coverage predicate can combine jurisdiction, dates, unit counts and exemptions using `all` / `any` / `not`, while still describing one requirement. Missing facts preserve uncertainty; they do not automatically make every rule under the parent law unknown.

## Logical database model

| Record | Producer / owner | Purpose |
| --- | --- | --- |
| `LAW` | AI produces; backend stores | Parent law, issuing jurisdiction and official instrument identity. |
| `RULE_VERSION` | AI produces; backend validates/evaluates | A distinct requirement and its version, title, section-level citation, key value, category, coverage, exceptions, lifecycle facts and interactions. |
| `SOURCE_DOCUMENT` | AI produces; backend stores | Immutable captured source with URL, retrieval timestamp, hash and original text. |
| `RULE_EVIDENCE` | AI produces; backend stores | Junction linking many rule versions to many source captures, preserving exact quotations and locations. |
| `PROPERTY` | Backend | Original and normalized property facts, resolved municipality, resolution status and dataset provenance. |
| `CHANGE_CASE` | Backend imports supplied fixtures | T1–T5 dates, jurisdictions, rule references, hypothetical scenarios and affected-set criteria. |
| `EVALUATION_RUN` | Backend | Query/scenario inputs, bundle hashes, saved input snapshot, fact overrides and change summary. A normal lookup has no change-case ID. |
| `EVALUATION_RESULT` | Backend | Result for one run, property, rule version, date and scenario, with explanation and conflict information. |

The diagram is a logical record model, suitable for SQL tables or equivalent versioned JSON. A separate jurisdiction table is optional; this model embeds legal state/city fields in laws and properties. `RULE_EVIDENCE` is the many-to-many junction between source captures and rule versions. Change summaries retain affected IDs, conflict IDs and notes using each test's definition.

Store the input snapshot referenced by a run, rather than retaining only a hash. Preserve the rule bundle, source captures and property facts needed to replay that run. The request sequence explicitly saves the run, results and input snapshot before responding. If users supply missing facts, record those as request-specific overrides with their origin; preserve the original sample records.

## Storage and required outputs

| Artifact | Role |
| --- | --- |
| `rules.json` | Required submission: extracted records matching the supplied rule schema. |
| `lookups.json` | Required submission: results for all 500 addresses, with the query date and required result/explanation/conflict fields. |
| `changes.json` | Required submission: all five cases, with affected IDs, conflict IDs where appropriate, and notes. |
| Internal rule logic and source records | Proposed implementation artifacts: typed coverage predicates, lifecycle events, source retrieval timestamps, hashes, quotation locations and decision traces. These are not additional required submission files. |

Keep the required submission format stable. Put richer provenance and evaluation metadata in internal records keyed by `team_rule_id`, `source_doc_id` and `address_id`, then join it into the API's evidence view.

The guide's lookup values are `applies`, `unknown`, `superseded`, `not_yet_effective` and `pending`. Omit non-matching rules from the required lookup export. For T5, record IP 25-21 as `failed` in the rule records, omit it from current-law lookups and return an empty affected-address set, as specified by `dev/change_tests.json`. Failed proposals do not produce current-law applicability.

## Scope and design assumptions

- Use the supplied public corpus and sample properties first. Additional source acquisition is limited to permitted public material.
- A database is optional for the challenge. Versioned JSON plus indexes can support the sample; the diagrams specify logical components, not an unnecessarily large infrastructure stack.
- Evaluation must use the query date independently of source retrieval dates.
- Supported precedence is encoded explicitly; ambiguous interactions remain flagged for review.
- The change runner follows each supplied case, rather than assuming every case is a simple before/after result difference.
- The diagrams show architecture decisions, not new legal conclusions. The starter pack's scenarios remain the evaluation fixtures.

## Regenerate

Run `render_diagrams.py` with a Python interpreter that has Pillow installed. Font paths are defined near the top of the file and can be changed for another operating system. The script also creates `architecture-diagrams.zip` containing all four full-resolution JPGs, editable SVGs, these notes and the renderer.
