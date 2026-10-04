# Challenge data and coverage audit

Initial inventory baseline: 2026-10-04, repository `b/lexrent` at `d54ab0d`. The starter counts below retain that original snapshot. The reviewed local baseline section records subsequent evidence and compiled-data updates. This audit does not certify publication to the live database/deployment, the present legal status of every source, or complete legal coverage. No rule or municipality was inferred from a fixture target count.

## Reviewed local baseline

The populated local bundle contains **95 source-audited atomic records: 40 CA, 30 NJ and 25 MA**. All **500 addresses** receive relevant state records and at least one current applicable record. Current compiled source totals are **100 documents, 67 captured**. Municipality evidence supports **447 addresses: 400 official Census matches plus 47 manually reviewed official NJ tax-parcel matches**; **53 remain unresolved**. These counts describe the reviewed local build and are not a claim that the same snapshot is already deployed.

The [NJ evidence snapshot](../corpus/nj-parcel-evidence.json), retrieved `2026-10-04T10:22:30.576175Z`, covers **34 Newark, 6 Hoboken and 7 Jersey City** addresses. Independent review verified all 47 complete original CSV street strings equal official `PROP_LOC` byte-for-byte, including compound and range addresses. Every selected attributes object is unchanged from the [raw provider response](../corpus/nj-parcel-provider-response.json). The response's SHA-256 is `80b7193b59099c02d2fa32f68cedb2e453388a0f343bc41669243efba4f7c757`, matching `provider_response_sha256`. Address IDs and parcel OBJECTIDs are unique within this reviewed set. `PCL_MUN`, `CD_CODE`, municipal name, county and `PAMS_PIN` prefix agree: Newark `0714`/Essex, Hoboken `0905`/Hudson, Jersey City `0906`/Hudson. Individual URLs reference those exact objects on the official service; selected fields do not use owner mailing-city or ZIP labels.

The government [Housing Council directory](https://www.nj.gov/housingcouncil/resources/data-dictionaries.shtml) identifies the MOD-IV composite's owner as the New Jersey Office of Information Technology and links this exact service. [NJGIN's parcel directory](https://nj.gov/njgin/edata/parcels/) describes county/municipal tax data and warns that polygons are not legal boundaries or land-ownership surveys. These `manual_review` resolutions establish **current municipal tax assignment of the complete property address**, not a surveyed legal boundary, title, statewide uniqueness proof or historical jurisdiction determination. No range endpoint was substituted. Selected fields do not establish tax year; 13 `PCLLASTUPD` values are null. Service freshness/retrieval dates do not establish each parcel's tax year or its assignment on an earlier query date.

All **five local change cases are evaluated**. T2 supports **90 affected addresses and 0 unresolved municipality cases**, with the fixture expectation of 90 retained separately; Newark is excluded by the evaluated municipal scope. Missing owner, occupancy, tenancy, certificate and exemption facts still produce unknowns for relevant requirements. The **53 unresolved municipalities** are distinct from readiness's broader **500 unresolved-result addresses**: every address has at least one unknown requirement even though each also has an applicable record. `coverage_complete` remains false: neither five evaluated cases nor readiness establishes 100% legal coverage, property compliance or professional legal review. Final records retain `human_legal_review: false`; cached draft overlaps are review cross-references rather than lineage or semantic-equivalence proof.

## The three brochure use cases

The six-page [challenge brochure](../mit-rental-housing-law-navigator-challenge-v5-participant-no-scoring-no-hour16.pdf), page 1, names three beneficiary groups. They share one source-backed rule and property pipeline:

| Use case | Required useful output | Acceptance boundary |
| --- | --- | --- |
| Renters | Select a sample address and date; see protections, individual requirements, exact evidence and unanswered coverage questions. | Never turn an absent rule, missing fact or unresolved boundary into an assurance that no law applies. |
| Advocates and agencies | Explore the sample and the address sets affected by each supplied change; inspect dates, jurisdiction evidence and conflicts. | Separate hypothetical pending-bill exposure and fixture expectations from evaluated current-law outcomes. |
| Housing providers | Inspect obligations, exemptions, notice/fee/deposit rules and rule interactions before acting. | Explain conditional obligations; do not infer a violation from address data or present a compliance certification. |

The brochure also requires **three modules**, not three independent sets of seeded laws: automated extraction (A), address lookup (B), and change tracking (C), page 2. The [participant guide](../participant-final-no-hour16%203/README.md), sections 1-3, prioritizes A and B for the minimum viable submission; the brochure's full build expectation includes A, B and C. English/Spanish presentation, confidence indicators and a new jurisdiction are stretch work. Responsible provenance, query dates, explicit unknowns and conflict review remain required design expectations.

## Scope and schedule

- Default query date: `2026-10-01`; historical and future queries are part of the task.
- Three states: California, New Jersey, Massachusetts.
- Ten law cities: Los Angeles, San Francisco, San Diego, Berkeley, Santa Ana, Jersey City, Hoboken, Newark, Boston, Cambridge.
- Nine sample-address city groups: Santa Ana has no sample addresses and remains an extraction-only jurisdiction.
- Six categories, using the exact schema keys: `rent_increase_limits`, `just_cause_eviction`, `security_deposits`, `application_screening_fees`, `screening_restrictions`, `algorithmic_rent_setting`.
- The brochure is an October 2026 discussion draft for a 24-hour event. Its page 5 schedule is hours 0-1 kickoff, 1-6 extraction, 6-11 geocoding/coverage, 11-18 lookups/explanations/change cases, 18-23 validation/demo preparation, 23-24 demos. It does **not** establish an actual calendar deadline, venue, credit allowance or submission mechanism. The guide says organizers will confirm logistics.

The brochure mentions a state/county/city jurisdiction stack. The provided rule schema supports state and city rules only. County geography may support boundary audit without inventing county rules outside the corpus. The brochure also asks extraction to retain penalties; the schema has no dedicated penalty property. Preserve an evidenced penalty as a distinct atomic requirement or explicitly documented supplemental field rather than dropping it or inventing a value.

## Verified starter input inventory

Inputs read: the complete six-page brochure; [participant guide](../participant-final-no-hour16%203/README.md); [500-row sample CSV](../participant-final-no-hour16%203/data/sample_addresses.csv); [87-row source manifest](../participant-final-no-hour16%203/corpus/corpus_manifest.csv); [uncaptured-source list](../participant-final-no-hour16%203/corpus/links_only.csv); all source availability and headers; [rule schema](../participant-final-no-hour16%203/schema/rule_record.schema.json); sample rule and all submission templates; [five change fixtures](../participant-final-no-hour16%203/dev/change_tests.json); and relevant full captured change/status documents. The two supplied brochure PDFs are byte-identical.

| Inventory item | Verified baseline count |
| --- | ---: |
| Properties | 500 |
| California / New Jersey / Massachusetts properties | 250 / 140 / 110 |
| Manifest documents | 87 |
| Actual available text files | 54 |
| Uncaptured manifest sources | 33 |
| Manifest `capture=yes` rows | 55 |
| Supplied validated law chunks in generated data | 568 |
| Published rules in checked-in `src/data/challenge.json` | 0 |
| Properties initially marked municipality unresolved in generated data | 500 |
| Deterministic change fixtures | 5 |
| Missing construction years / unit counts / ZIPs | 212 / 242 / 130 |
| Generated street-number-range / NJ ZIP-state-mismatch flags | 59 / 27 |

All property rows record retrieval at `2026-10-01T22:50Z`. Supplied text capture timestamps range from `2026-10-01T22:35Z` to `2026-10-01T22:56Z`. Retrieval time is evidence metadata; it is not enactment or effective time.

`D056` is marked `capture=yes` but has no text file, retrieval time or hash; its recorded status reports a 403 failure. It is one of the 33 uncaptured sources. Count actual text availability, not the label alone.

All 54 captured files include the manifest source URL in their header. **None of the 54 supplied manifest SHA-256 values equals the corresponding stored text bytes**, including tested header-stripped and trailing-newline variants. The pack does not identify what representation was hashed. Preserve the supplied value as original metadata; compute a separate actual capture-content hash for file-integrity, cache and version assertions. This mismatch does not by itself establish fabricated content or explain the original hash algorithm.

### Property facts by candidate city

These groups are sample/fixture labels and postal aliases, **not verified legal municipalities**.

| Candidate city | Addresses | Missing year | Missing units | Missing ZIP |
| --- | ---: | ---: | ---: | ---: |
| Los Angeles, CA | 80 | 6 | 3 | 0 |
| San Francisco, CA | 80 | 2 | 0 | 80 |
| San Diego, CA | 50 | 50 | 0 | 0 |
| Berkeley, CA | 40 | 40 | 40 | 0 |
| Jersey City, NJ | 50 | 22 | 50 | 0 |
| Hoboken, NJ | 40 | 36 | 39 | 0 |
| Newark, NJ | 50 | 48 | 50 | 0 |
| Boston, MA | 60 | 8 | 60 | 0 |
| Cambridge, MA | 50 | 0 | 0 | 50 |

Boston aliases include Allston, Brighton, Dorchester, East Boston, Hyde Park, Jamaica Plain, Mattapan, Roxbury and South Boston. San Ysidro is a San Diego candidate alias. The guide's Van Nuys example is instructive; no current Los Angeles sample row uses that postal label.

Preserve the original CSV values. For example, `A0003` Newark has ZIP `11219`, and `A0008` Jersey City has `78746`. A valid-looking postal field cannot establish the city boundary. Range addresses and ambiguous matches need parcel/boundary evidence or remain unresolved; choosing a range endpoint without review does not verify every unit in a property.

Owner identity/type, certificate-of-occupancy date, portfolio size, tenancy facts, subsidy status and exemption filing are not supplied as structured sample columns. Construction year does not substitute for a certificate date. An enrichment must retain its public source, retrieval time, exact property match and provenance; unresolved facts must stay unknown. Derived `certificate_age_years` can be computed from a verified/supplied certificate date and query date but cannot be independently entered or inferred from year built.

### Source availability by jurisdiction

Availability is not a claim that each source contains every category or legally operative text.

| Jurisdiction | Manifest | Available captures | Uncaptured document IDs |
| --- | ---: | ---: | --- |
| CA | 14 | 7 | D015, D017-D021, D028 |
| Berkeley, CA | 9 | 8 | D002 |
| Los Angeles, CA | 7 | 5 | D038, D044 |
| San Diego, CA | 5 | 2 | D074, D075, D077 |
| San Francisco, CA | 6 | 6 | None |
| Santa Ana, CA | 4 | 2 | D086, D087 |
| NJ | 10 | 5 | D060-D064 |
| Hoboken, NJ | 3 | 0 | D032-D034 |
| Jersey City, NJ | 3 | 1 | D035, D037 |
| Newark, NJ | 3 | 0 | D070-D072 |
| MA | 15 | 11 | D054-D056, D059 |
| Boston, MA | 5 | 5 | None |
| Cambridge, MA | 3 | 2 | D030 |

Manifest authority labels: 54 `official`, one `official city-linked policy`, nine `code publisher`, 23 secondary. Nine publisher sources explicitly say `check-terms`. BrightData access or credits do not establish permission to scrape a publisher. Prefer permitted official sources, retain refusals and source limitations, and avoid unsupported bulk collection.

## Five change cases: expected versus evidenced

The expected counts below are **fixture expectations derived from sample state/candidate-city labels**, not evidence. The reviewed local build now evaluates all five cases from imported rules and documented municipality evidence, while retaining these expectations separately.

| Case | Required fixture behavior and reference IDs | Expected sample set | Reviewed evidence and remaining limits |
| --- | --- | --- | --- |
| T1 | `CA-ALG-01`: `not_yet_effective` on 2025-12-31, then `applies` on 2026-01-02 for AB 325 / SB 763. | 250 CA addresses | D022 supplies chaptered AB 325 prohibition text. S017 supplies the Senate's ordinary-law activation calendar; the January 1, 2026 date is a documented inference for nonurgency chapter 338, not fixture evidence. SB 763 is absent from the manifest and no separate SB 763 record is manufactured. |
| T2 | `HOB-ALG-01` only in Hoboken; `JC-ALG-01` only in Jersey City; neither in Newark, as of 2026-10-01. | 40 + 50 = 90 candidate addresses | S012 supplies Hoboken operative text and S011 supplies Jersey City text. Census evidence plus reviewed whole-address NJ municipal tax assignments support 90 affected addresses and 0 unresolved municipality cases. Tax assignments do not certify surveyed or historical boundaries or supply other exemption facts. |
| T3 | `NJ-ALG-01`: not yet effective 2026-10-01; applies 2027-07-02. Possible conflict with `JC-ALG-01` / `HOB-ALG-01` needs review. | 140 NJ affected; 90 candidate local-conflict addresses | D069 states approval 2026-07-20 and activation on the first day of the twelfth month after enactment; retain the wording and reviewed 2027-07-01 derivation. S011/S012 supply local operative text. The municipal-conflict provision supports a review flag, not an automatic definitive preemption verdict. |
| T4 | `MA-ALG-P1` / `MA-ALG-P2`: S.2983 and H.5222 stay pending at 2026-10-01; hypothetical affected set if enacted. | 110 MA addresses, hypothetical | D045/D046/D047 establish pending status; supplemental S019/S020 now capture the complete official proposed texts. Proposed duties and definitions are distinguished from current obligations. |
| T5 | `MA-RENT-P1`: IP 25-21 failed/struck 2026-06-23; affected set empty and no ballot-derived Boston/Cambridge rent cap. | 0 affected | S008 supplies official judicial disposition; the failed proposal is retained as a failed record and excluded from current protections. D048 supplies the separate current restriction on local rent control. |

Stable team rule IDs may differ from fixture IDs. The existing engine supports reviewed `ruleLogic[id].fixture_rule_ids` mappings. Separate atomic requirements from one statute may map to the same fixture reference. Do not treat such mappings as source evidence.

Other known review points from guide section 9: conflicting published Berkeley algorithmic effective dates; conflicting Los Angeles RSO formula dates; possible NJ/local preemption; no single official 2026 California screening-fee figure. Also, D039 is a Los Angeles council **motion seeking a report/feasibility analysis**, not proof of an enacted local algorithmic ban. An official URL alone does not establish an operative obligation.

## Implementation and acceptance contract

1. **Acquire evidence before publishing.** Use supplied captures first. Store permitted missing/supplemental text with actual source URL, public retrieval timestamp, actual content hash, original metadata and authority/status notes. Distinct linked bill or ordinance text has its own URL; do not attach it to a different manifest URL merely to pass quote validation. The present source-capture endpoint accepts known manifest IDs/URLs, so supplemental-source registration must be explicit.
2. **Run automated extraction.** Produce raw model drafts for selected document chunks, retain request/model/prompt/source identity and usage metadata, and mark them as requiring review. Review and deduplicate atomic obligations; a hand-written synthetic bundle does not satisfy Module A merely because it contains valid quotes. Preserve actual draft provenance separately from agent-assisted final-source audits; evidence overlap alone does not prove that a final record originated from or is semantically equivalent to a cached model draft.
3. **Review executable coverage and lifecycle.** Import `{rules, ruleLogic}` only after exact quote/source validation. `ruleLogic[id].coverage` uses fixed typed `all`/`any`/`not` and allowlisted fact comparisons. Exemptions, operative dates, proposal status and supersession/conflict direction must follow captured evidence. Missing owner/certificate/filing facts remain unknown. Avoid treating a general pricing prohibition as proof that a property actually uses prohibited software.
4. **Resolve all sample addresses without forced matches.** Persist source-backed municipality resolutions; retry corrupted or absent ZIP hints using street/city/state where appropriate. Ambiguous/range/unmatched cases retain explicit unresolved status and a repair queue. A postal alias, OSM marker or expected city count cannot become boundary proof. Historical queries must label the limits of current-boundary evidence.
5. **Evaluate and export every address.** `lookups.json` contains exactly all 500 address IDs at the requested date, even where the returned rule array is empty. Retain all returned atomic requirements, five allowed lookup statuses, explanations and conflict flags; omit non-applicable rules. Empty results must still carry the coverage-gap explanation in the app/audit report.
6. **Evaluate all five cases using real rules.** Compare before/after states for the same rule ID; use verified city coverage for T2; keep T4 exposure hypothetical; record T5's failed proposal in rules while excluding it from applicable lookup results. Export all five case keys and source-backed notes. Count mismatches/unresolved facts require review, not automatic fixture-count repair.
7. **Demonstrate the three beneficiaries.** Renters receive address/date explanations; advocates receive filterable address sets and change evidence; providers receive conditional atomic obligations, exemptions and interactions. All interfaces retain the not-legal-advice statement, date and source access. Confidence, if present, reflects recorded reviewed-rule confidence and is not a property-coverage probability.
8. **Reproduce the deliverables.** Submit schema-valid `rules.json`, all-500 `lookups.json`, all-five `changes.json`, a live automated-extraction/lookup/change demo, and a one-page method note (brochure page 6). Record source gaps, geocoding failures, unknown facts and reviewed rule version alongside the run. The existing readiness flag only checks nonempty rules and five evaluated cases; `coverage_complete` remains false and must not be advertised as 100% verified legal coverage.

The independent inventory and parcel review did not call a paid model, publish a rule, modify original property records or write to the database. Supplemental acquisition, automated extraction and local resolution integration are separately recorded pipeline operations; deployment publication must be verified separately.
