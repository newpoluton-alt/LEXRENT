# New Jersey and Massachusetts rule audit

Audited against the participant corpus snapshot retrieved on 2026-10-01, supplemented by captured primary sources retrieved on 2026-10-04. This file describes evidence-backed research records; it does not certify a property's compliance or determine that a particular landlord violated a duty.

## Evidence and scope

The project uses a hybrid workflow: Claude produces extraction drafts from captured source chunks, agents analyze the operative source text and correct dates, scope and exemptions, and deterministic validation checks schema, typed predicates and exact quotations. The final NJ/MA bundle reflects agent-assisted source analysis. Raw extraction cache files retain the draft output and its validation outcome as separate pipeline artifacts; their presence alone does not add an obligation to the application's curated rule bundle.

Every `quoted_span` is a continuous verbatim substring of the source identified by `source_doc_id` and `source_url`. Quotes preserve the captured source's whitespace/OCR errors rather than silently correcting them. The bundle does not import the Lovable prototype's legal constants, confidence percentages or geographical assumptions. Predicates model property-level coverage; occurrence-specific duties (a deposit collected, a fee demanded, a termination notice served) are stated conditionally in the requirement and are not findings about actual conduct.

Current source status is assessed at the challenge date 2026-10-01. Existing General Laws/Truth in Renting provisions without an independently documented operative start date use a null effective date, rather than an invented historical date. The evaluator therefore treats older queries conservatively. Boston and Cambridge city rules require a verified `legal_city`; postal locality alone cannot affirm them. A missing exemption or tenure fact remains unknown.

## Dates and temporal distinctions

- NJ application fee: P.L.2025 c.405 is *approved January 20, 2026* despite its 2025 session-law number. Its first-day-of-fourth-following-month clause gives **2026-05-01**. The initial cap is **$50 for 2026**. The positive-CPI adjustment mechanism starts in the calendar year after enactment; the bundle deliberately does not promise $50 as the published cap in 2027 or later. An official [NJ Attorney General notice](https://www.njoag.gov/attorney-general-davenport-leads-bipartisan-multistate-call-for-federal-action-on-rental-housing-fee-abuses-puts-new-jersey-landlords-on-notice-of-states-application-fee-cap/) independently confirms May 1, 2026.
- NJ Fair Chance in Housing: P.L.2021 c.110 approved 2021-06-18, first day of the seventh following month gives **2022-01-01**. It applies to covered providers; owner-occupied premises of at most four dwelling units are excepted. This is unrelated to the FAIR algorithmic-pricing Act.
- NJ FAIR algorithmic-pricing Act: primary captured **D069**, approved **2026-07-20**, effective on the first day of the twelfth following month, **2027-07-01**. Thus its operative prohibitions are `not_yet_effective` on 2026-10-01. Existing antitrust law is preserved; the future effective date does not declare earlier collusion lawful. Section 6(b) prohibits municipalities from *enacting* conflicting ordinances and preserves otherwise authorized/required enactments. It does not itself repeal or invalidate existing local ordinances. Explicit `conflicts_with` edges to Hoboken/Jersey City serve as future interaction review flags, not a finding of an actual conflict or current preemption; no supersession/repeal edge is set. Newark has no such edge.
- MA broker fees and the landlord-agent amendment: the official General Laws pages **D057/D052** expressly mark the amended text effective **2025-08-01**. The contracting/hiring party pays its broker. A tenant may separately engage a broker; this does not permit an additional landlord application fee.
- MA algorithmic bills **S.2983 / H.5222**: captured legislative status/history **D046/D045** establishes committee referral, not enactment. Both are `pending`, and do not create binding prohibitions. Full official proposed bill text is now captured in **S020/S019**, with exact proposed-duty quotes and supporting status references. S.2983 concerns the use of defined devices/coordinators, nonpublic competitor data and specified exclusions; H.5222 concerns purchasing defined coordinating services, with its own public-data and residential-use definitions. Their wording is not interchangeable. The current official [H.5222 status page](https://malegislature.gov/Bills/194/H5222) independently agrees with the source snapshot. No hypothetical enactment/effective date is manufactured.
- MA c.40P §4 is an existing state restriction on compulsory municipal rent control, with a narrow voluntary/compensated exception. It creates **no rent cap**. It is separate from the failed IP25-21 ballot-question record. Supplemental S008 is the actual June 23, 2026 SJC opinion, not an inference from a news headline: Cella v. Attorney General, SJC-13893, orders Initiative Petition 25-21 kept off the 2026 ballot. `MA-RENT-P1` is failed from 2026-06-23 and excluded from current binding protections.

## Facts deliberately not inferred

- NJ owner-occupied exceptions use dwelling-unit count and `owner_occupied`; a building age or an address does not identify owner occupancy.
- NJ security-deposit coverage can also be established with `security_deposit_law_invoked_30_days` for a qualifying tenant's written activation. Deposit banking/interest rules separately check `seasonal_or_transient_tenancy`. No tenant is assumed to have sent an invocation.
- NJ Anti-Eviction/unconscionability coverage checks `seasonal_or_transient_tenancy` and the narrow `family_trust_disability_unit` exclusion; absence of these facts does not mean false.
- MA deposit/landlord application-fee rules check `vacation_or_recreational_lease_100_days_or_less`. This precisely names §15B(9)'s conjunctive exception; generic residential use is insufficient to rule it out.
- MA at-will notice/cure rules require `tenancy_at_will`. Monthly payments are not silently converted into an at-will tenure finding.
- Boston DND/BPDA fair-chance policy checks `boston_fair_chance_program`; `is_subsidized` alone cannot prove the specific funding/land/inclusionary-program affiliation. This is a program policy, not a universal Boston ban on all criminal or credit checks.
- Cambridge guide duties check `cambridge_notification_exempt`, covering the listed institutional, short-term-treatment and zoning-defined short-term-rental exceptions. An owner living in a one-unit building does not by itself create this exception.

## Supplemental municipal evidence and remaining gaps

The original manifest's link-only items are not silently upgraded. Separate captured documents preserve their retrieval dates and hashes:

- **S009**, Hoboken Chapter 155 Article II: ordinary annual increases use the lesser of 5% or the specified CPI differential; no more than one cost-of-living increase in 12 months; 30-day written increase notice; prior Board approval for capital surcharges. Every such rule requires `city_rent_controlled: true` and a verified Hoboken municipality. Neither construction year nor unit count certifies municipal eligibility.
- **S010**, Newark Chapter 19:2: ordinary annual increases use the specified CPI differential, capped at 4%, across any consecutive 12 months despite tenant/owner changes; advance notice goes to the tenant and Rent Regulation Officer; housing-code and registration compliance precede increases/surcharges. Eligibility remains a separate `city_rent_controlled` fact. The code's owner-occupied definition is not treated as an exemption; exceptions actually include new construction, vacant rehabilitation and specific public/government rent regulation.
- **S006/S011**, Jersey City ordinances 25-057 and 25-076: original definitions are retained; the later adopted July 16, 2025 amendment prohibits “otherwise utilize” as well as subscribing/contracting/exchanging value. The amended duties cite S011 and explicitly refer users to the original definitions and exclusions. Adoption dates are recorded, but an exact operative-effective day is not fabricated from adoption or mayoral approval. A historical query immediately after adoption requires effective-date review; the captured current text supports the 2026-10-01 status.
- **S008**, a copy of the primary SJC opinion hosted by the US Chamber, supports the failed IP25-21 record. Its text and hash are captured independently of the Chamber's advocacy summary. The jurisdictional ruling is the relevant evidence.

**S012**, Hoboken Chapter 158, is now captured: §158-2 defines and prohibits algorithmic price fixing based on recent nonpublic competitor information; it does not ban every AI tool. §158-1 separately requires specified disclosures for current-tenant renewal increases above 10%, including whether a rent algorithm was used. This threshold authorizes no otherwise unlawful increase. **S015**, the current city-issued CPI bulletin through October 2026, directly states §260-3's lower-of-applicable-CPI-or-4% limit for rent-controlled property and supports `JC-RENT-01`. A monthly CPI observation above 4% is not an authorization to exceed the ceiling. The rule requires a separate verified `city_rent_controlled` determination. D036's office-page discussion and S015's cap notice do not replace Chapter 260's full exemption, notice and special-adjustment text; the municipal-code JS shell in S014 remains uncaptured. These remaining gaps are explicit.

A supplemental source search identified a proposed common-ownership expansion in Ord.25-125. [The official ordinance file](https://cityofjerseycity.civicweb.net/document/440329/Ord%20-%20Chapter%20260%20-%20LLC%20Ownership%20of%20Multiple%20P.pdf) is marked **Defeated**, despite an inconsistent boilerplate adoption footer; no proposed aggregation obligation was imported. A [September 28, 2026 district-court opinion in Portside Towers](https://law.justia.com/cases/federal/district-courts/new-jersey/njdce/2%3A2023cv22291/536329/187/) also distinguishes a mandatory municipal new-construction notice from a substantive exemption prerequisite. The bundle therefore keeps municipal eligibility as a reviewed fact instead of automatically deciding it from a construction year or a filing boolean.

Boston H3744 D011 is a home-rule petition, not evidence of an enacted Boston rent cap. The state §4 prohibition is not overwritten by that proposal. No mandatory Boston/Cambridge rent cap is asserted from prototype values or draft proposals. No unsupported statewide NJ percentage rent cap or statewide MA just-cause protection is invented.

## Rule inventory

| Rule | Jurisdiction | Category | Source | Status / supplied effective date |
| --- | --- | --- | --- | --- |
| NJ-RENT-01 | NJ | rent_increase_limits | D067 | in_force / day-level start not supplied |
| NJ-RENT-02 | NJ | rent_increase_limits | D067 | in_force / day-level start not supplied |
| NJ-EVICT-01 | NJ | just_cause_eviction | D067 | in_force / day-level start not supplied |
| NJ-EVICT-02 | NJ | just_cause_eviction | D067 | in_force / day-level start not supplied |
| NJ-DEP-01 | NJ | security_deposits | D067 | in_force / day-level start not supplied |
| NJ-DEP-02 | NJ | security_deposits | D067 | in_force / day-level start not supplied |
| NJ-DEP-03 | NJ | security_deposits | D067 | in_force / day-level start not supplied |
| NJ-DEP-04 | NJ | security_deposits | D067 | in_force / day-level start not supplied |
| NJ-DEP-05 | NJ | security_deposits | D067 | in_force / day-level start not supplied |
| NJ-FEE-01 | NJ | application_screening_fees | D066 | in_force / 2026-05-01 |
| NJ-SCREEN-01 | NJ | screening_restrictions | D065 | in_force / 2022-01-01 |
| NJ-SCREEN-02 | NJ | screening_restrictions | D065 | in_force / 2022-01-01 |
| NJ-SCREEN-03 | NJ | screening_restrictions | D065 | in_force / 2022-01-01 |
| NJ-SCREEN-04 | NJ | screening_restrictions | D065 | in_force / 2022-01-01 |
| NJ-SCREEN-05 | NJ | screening_restrictions | D068 | in_force / day-level start not supplied |
| NJ-ALG-01 | NJ | algorithmic_rent_setting | D069 | not_yet_effective / 2027-07-01 |
| NJ-ALG-02 | NJ | algorithmic_rent_setting | D069 | not_yet_effective / 2027-07-01 |
| MA-RENT-01 | MA | rent_increase_limits | D048 | in_force / day-level start not supplied |
| MA-DEP-01 | MA | security_deposits | D052 | in_force / day-level start not supplied |
| MA-DEP-02 | MA | security_deposits | D052 | in_force / day-level start not supplied |
| MA-DEP-03 | MA | security_deposits | D052 | in_force / day-level start not supplied |
| MA-DEP-04 | MA | security_deposits | D052 | in_force / day-level start not supplied |
| MA-DEP-05 | MA | security_deposits | D052 | in_force / day-level start not supplied |
| MA-DEP-06 | MA | security_deposits | D052 | in_force / day-level start not supplied |
| MA-FEE-01 | MA | application_screening_fees | D052 | in_force / 2025-08-01 |
| MA-FEE-02 | MA | application_screening_fees | D057 | in_force / 2025-08-01 |
| MA-SCREEN-01 | MA | screening_restrictions | D049 | in_force / day-level start not supplied |
| MA-SCREEN-02 | MA | screening_restrictions | D049 | in_force / day-level start not supplied |
| MA-EVICT-01 | MA | just_cause_eviction | D058 | in_force / day-level start not supplied |
| MA-EVICT-02 | MA | just_cause_eviction | D058 | in_force / day-level start not supplied |
| MA-EVICT-03 | MA | just_cause_eviction | D053 | in_force / day-level start not supplied |
| MA-ALG-P1 | MA | algorithmic_rent_setting | S020; status D046 | pending / day-level start not supplied |
| MA-ALG-P2 | MA | algorithmic_rent_setting | S019; status D045 | pending / day-level start not supplied |
| BOS-EVICT-01 | Boston, MA | just_cause_eviction | D013 | in_force / day-level start not supplied |
| BOS-EVICT-02 | Boston, MA | just_cause_eviction | D013 | in_force / day-level start not supplied |
| CAM-EVICT-01 | Cambridge, MA | just_cause_eviction | D031 | in_force / day-level start not supplied |
| CAM-SCREEN-01 | Cambridge, MA | screening_restrictions | D029 | in_force / day-level start not supplied |
| BOS-SCREEN-01 | Boston, MA | screening_restrictions | D010 | in_force / day-level start not supplied |
| BOS-SCREEN-02 | Boston, MA | screening_restrictions | D010 | in_force / day-level start not supplied |
| MA-EVICT-04 | MA | just_cause_eviction | D051 | in_force / day-level start not supplied |
| MA-EVICT-05 | MA | just_cause_eviction | D051 | in_force / day-level start not supplied |
| HOB-RENT-01 | Hoboken, NJ | rent_increase_limits | S009 | in_force / day-level start not supplied |
| HOB-RENT-02 | Hoboken, NJ | rent_increase_limits | S009 | in_force / day-level start not supplied |
| HOB-RENT-03 | Hoboken, NJ | rent_increase_limits | S009 | in_force / day-level start not supplied |
| HOB-RENT-04 | Hoboken, NJ | rent_increase_limits | S009 | in_force / day-level start not supplied |
| NEW-RENT-01 | Newark, NJ | rent_increase_limits | S010 | in_force / day-level start not supplied |
| NEW-RENT-02 | Newark, NJ | rent_increase_limits | S010 | in_force / day-level start not supplied |
| NEW-RENT-03 | Newark, NJ | rent_increase_limits | S010 | in_force / day-level start not supplied |
| NEW-RENT-04 | Newark, NJ | rent_increase_limits | S010 | in_force / day-level start not supplied |
| JC-ALG-01 | Jersey City, NJ | algorithmic_rent_setting | S011 | in_force / day-level start not supplied |
| JC-ALG-02 | Jersey City, NJ | algorithmic_rent_setting | S011 | in_force / day-level start not supplied |
| MA-RENT-P1 | MA | rent_increase_limits | S008 | failed / failed 2026-06-23 |
| HOB-ALG-01 | Hoboken, NJ | algorithmic_rent_setting | S012 | in_force / day-level start not supplied |
| HOB-RENT-05 | Hoboken, NJ | rent_increase_limits | S012 | in_force / day-level start not supplied |
| JC-RENT-01 | Jersey City, NJ | rent_increase_limits | S015 | in_force / day-level start not supplied |

## Validation contract

Run the project's `validateRuleBundle` against the merged captured-source list, not against URL-only metadata. All rule IDs are unique, each rule has typed coverage logic, and no numerical confidence is fabricated. Each NJ and MA property receives relevant statewide records even where a narrower duty remains unknown or future/pending. Test municipality mismatch, exemption true/false/unknown, owner-occupied small premises, the 2026-05-01 fee boundary, the 2027-07-01 FAIR boundary, and the 2025-08-01 MA broker-fee boundary. The five change fixtures' expected address counts are test hypotheses; disagreements require audit, not a forced override of source evidence.

Validation run for the 55-record bundle: `validateRuleBundle` with all original and captured supplemental texts returned valid with zero errors and warnings. All 140 NJ and 110 MA address inputs received relevant state records and validated evidence; the minimum visible statewide record counts were 16 for NJ and 18 for MA (an exemption can exclude a narrower record). Fee, FAIR and MA broker-fee boundary checks passed, as did pending-bill and June 23 failed-ballot status checks. Fourteen additional coverage cases checked owner-occupied true/false/unknown, written deposit activation, MA vacation exclusion, program-specific Boston participation, verified city mismatch and unknown municipal rent-control eligibility. Municipality isolation also passed for separately supplied Hoboken, Jersey City and Newark fixture boundaries: local algorithmic rules appear only for their city, and Newark receives no municipal-conflict edge. No tenant/private ownership facts were fabricated to improve these counts.
