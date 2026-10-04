import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvaluatedRule, PropertyEvaluation } from "../src/domain/types";
import { CategoryPanel, EvidenceDialog, LawTable, LookupDataStatus, PropertySummary } from "../src/components/lovable/results";
import { FactQuiz } from "../src/components/lovable/fact-quiz";
import { PersonaDemos } from "../src/components/lovable/persona-demos";
import resolutions from "../corpus/jurisdiction-resolutions.json";

// Synthetic presentation fixtures do not supply production legal rules.
const quote = "A test-only quotation with <literal markup> & punctuation.\nSecond line stays intact.";
function entry(id: string, overrides: Partial<EvaluatedRule> = {}): EvaluatedRule {
  return {
    team_rule_id: id,
    rule: { team_rule_id: id, jurisdiction: "CA", level: "state", category: "security_deposits", status: "in_force", title: `Atomic requirement ${id}`, requirement: `Distinct obligation ${id}`, citation: `Test section ${id}`, source_url: "https://example.invalid/source", source_doc_id: "TEST-SOURCE", quoted_span: quote, effective_date: "2026-01-01" },
    result: "applies", explanation: `Evaluator explanation ${id}`, conflict_flag: false, missing_facts: [],
    evidence: { doc_id: "TEST-SOURCE", source_url: "https://example.invalid/source", citation: `Test section ${id}`, quoted_span: quote, retrieved_at: "2026-09-20T12:34:56Z", sha256: "capture-fingerprint", start_offset: 12, end_offset: 96 },
    ...overrides,
  };
}
function evaluation(rules: EvaluatedRule[] = []): PropertyEvaluation {
  return {
    property: { address_id: "TEST-ADDRESS", street_address: "1 Test Street", postal_city: "Test Postal City", state: "CA", zip: "90000", year_built: null, units: null, use_code: "", use_description: "", source_dataset: "Test dataset", retrieved_at: "2026-08-01T00:00:00Z", legal_city_candidate: "Test Candidate", jurisdiction_status: "unresolved", missing_facts: ["legal_municipality", "units"], quality_flags: [] },
    as_of: "2026-10-01", jurisdiction: { state: "CA", city: null, candidate_city: "Test Candidate", verified: false, method: "unresolved" },
    rules, missing_facts: ["legal_municipality", "units"], notices: ["Test inventory remains incomplete."], coverage_complete: false, rule_count: rules.length,
    input_snapshot: { facts: { state: "CA", units: null }, resolution: null },
  };
}
const onEvidence = () => {};

describe("reviewed result presentation", () => {
  it("keeps all atomic requirements from the same category available in every result view", () => {
    const data = evaluation([
      entry("one"),
      entry("two", { result: "unknown", missing_facts: ["units"], conflict_flag: true }),
      entry("three", { result: "superseded" }),
    ]);
    for (const component of [LawTable, CategoryPanel, PropertySummary]) {
      const html = renderToStaticMarkup(createElement(component, { evaluation: data, onEvidence }));
      for (const id of ["one", "two", "three"]) expect(html).toContain(`Atomic requirement ${id}`);
      expect(html).toContain("Unknown");
      expect(html).toContain("Superseded");
      expect(html).toContain("Needs human review");
      expect(html).not.toContain("Local rule governs");
    }
    const table = renderToStaticMarkup(createElement(LawTable, { evaluation: data, onEvidence }));
    expect(table).toContain("Still needed: Number of units");
    expect(table).toContain("2026-09-20T12:34:56Z");
  });

  it("shows the exact escaped source quotation with separate capture, effective and query dates", () => {
    const html = renderToStaticMarkup(createElement(EvidenceDialog, { entry: entry("evidence"), asOf: "2026-10-01", onClose: () => {} }));
    expect(html).toContain("A test-only quotation with &lt;literal markup&gt; &amp; punctuation.\nSecond line stays intact.");
    expect(html).toContain("2026-09-20T12:34:56Z");
    expect(html).toContain("2026-01-01");
    expect(html).toContain("2026-10-01");
    expect(html).toContain("capture-fingerprint");
    expect(html).toContain("12–96");
    expect(html).toContain("does not independently verify");
  });

  it("does not present an unvalidated record quote as captured evidence", () => {
    const missing = entry("missing", { evidence: null });
    const html = renderToStaticMarkup(createElement(EvidenceDialog, { entry: missing, asOf: "2026-10-01", onClose: () => {} }));
    expect(html).toContain("No validated source capture is attached");
    expect(html).not.toContain("A test-only quotation");
    expect(html).not.toContain("capture-fingerprint");
  });

  it("labels empty categories as incomplete reviewed coverage rather than absence of applicable law", () => {
    const data = evaluation();
    const table = renderToStaticMarkup(createElement(LawTable, { evaluation: data, onEvidence }));
    expect(table.match(/Reviewed coverage is unavailable for this category/g)).toHaveLength(6);
    expect(table).toContain("An empty result does not establish that no law applies.");
    for (const component of [CategoryPanel, PropertySummary]) {
      const html = renderToStaticMarkup(createElement(component, { evaluation: data, onEvidence }));
      expect(html).toContain("Complete legal coverage has not been established.");
      expect(html).not.toContain("No laws apply");
    }
  });

  it("never invents confidence and distinguishes supplied rule confidence from coverage probability", () => {
    const unavailable = renderToStaticMarkup(createElement(LawTable, { evaluation: evaluation([entry("missing-confidence")]), onEvidence }));
    expect(unavailable).toContain("Confidence not provided");
    expect(unavailable).not.toMatch(/\d+%/);
    const reviewed = entry("reviewed-confidence");
    reviewed.rule.confidence = 0.82;
    const supplied = renderToStaticMarkup(createElement(LawTable, { evaluation: evaluation([reviewed]), onEvidence }));
    expect(supplied).toContain("Reviewed rule confidence: 82%");
    expect(supplied).toContain("not a probability that it applies to this property");
  });

  it("keeps large categories expandable without dropping obligations or hiding the review count", () => {
    const data = evaluation(Array.from({ length: 8 }, (_, index) => entry(String(index), index === 7 ? { result: "unknown", conflict_flag: true, missing_facts: ["owner_llc_has_corporate_member"] } : {})));
    for (const component of [CategoryPanel, PropertySummary]) {
      const html = renderToStaticMarkup(createElement(component, { evaluation: data, onEvidence }));
      expect(html).toContain("<details");
      expect(html).toMatch(/Show [56] more requirements/);
      for (let index = 0; index < 8; index++) expect(html).toContain(`Atomic requirement ${index}`);
      expect(html).toContain("1 need human review");
      expect(html).toContain("Unknown");
    }
    const table = renderToStaticMarkup(createElement(LawTable, { evaluation: data, onEvidence }));
    expect(table).toContain("LLC has a corporate member");
    expect(table).toContain("Showing 8 of 8 returned requirements.");
    expect(table).toContain("Requirement details");
  });

  it("distinguishes returned law records from fact gaps and evidence gaps even when a record count is stale", () => {
    const data = evaluation([entry("applies"), entry("unknown", { result: "unknown" }), entry("pending", { result: "pending" })]);
    data.rule_count = 999;
    data.missing_facts = ["units", "owner_llc_has_corporate_member", "legal_municipality", "verified_source_evidence", "units"];
    const text = renderToStaticMarkup(createElement(LookupDataStatus, { evaluation: data })).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Recorded requirements returned 3");
    expect(text).toContain("Property or tenancy facts still needed 2");
    expect(text).toContain("Jurisdiction or evidence items still needed 2");
    expect(text).toContain("1 apply · 1 unknown");
    expect(text).toContain("does not establish complete legal coverage");
    expect(text).not.toContain("999");
    const empty = renderToStaticMarkup(createElement(LookupDataStatus, { evaluation: evaluation() }));
    expect(empty).toContain("No reviewed requirements were returned");
    expect(empty).toContain("This does not mean that no law applies.");
  });
});

describe("scenario facts and beneficiary demos", () => {
  it("asks targeted evidence questions for every newly supported boolean without inferring an exemption", () => {
    const cases = [
      ["all_tenants_12_months", "each tenant"],
      ["affordable_housing_restricted", "voucher alone"],
      ["special_housing_exempt", "supporting records"],
      ["separately_alienable", "title or parcel records"],
      ["exemption_notice_provided", "required delivery timing"],
      ["owner_llc_has_corporate_member", "membership records"],
      ["shares_kitchen_or_bath_with_owner", "actual living arrangement"],
      ["city_rent_controlled", "coverage determination"],
      ["city_eviction_covered", "separate determinations"],
      ["city_fair_chance_covered", "housing exemptions"],
      ["vacation_or_recreational_lease_100_days_or_less", "both the lease"],
      ["seasonal_or_transient_tenancy", "exact exception"],
      ["family_trust_disability_unit", "Do not enter medical details"],
      ["security_deposit_law_invoked_30_days", "receipt date"],
      ["boston_fair_chance_program", "participation"],
      ["cambridge_notification_exempt", "supporting tenancy or housing records"],
      ["tenancy_at_will", "legal classification"],
    ];
    for (const [field, evidence] of cases) {
      const html = renderToStaticMarkup(createElement(FactQuiz, { initial: {}, missing: [field], onApply: () => {}, onClose: () => {} }));
      expect(html).toContain(evidence);
      expect(html).toContain("Question 1 of 1");
      expect(html).toContain('role="group"');
      expect(html).toContain("aria-describedby=");
      expect(html).toContain("temporary, user-supplied scenario facts");
      expect(html).toContain("Skip");
      expect(html).not.toMatch(/\s(?:aria-)?checked=/);
    }
  });

  it("does not present unrelated fact questions as a way to resolve source or municipality gaps", () => {
    const html = renderToStaticMarkup(createElement(FactQuiz, { initial: { owner_type: "llc" }, missing: ["legal_municipality", "verified_source_evidence"], onApply: () => {}, onClose: () => {} }));
    expect(html).toContain("This quiz cannot verify a municipal boundary.");
    expect(html).toContain("There are no editable missing facts");
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain("Question 1 of");
  });

  it("uses three real verified sample cities for the brochure audiences, with distinct working research destinations", () => {
    const html = renderToStaticMarkup(createElement(PersonaDemos));
    for (const [id, city] of [["A0001", "Los Angeles"], ["A0008", "Jersey City"], ["A0010", "Cambridge"]] as const) {
      expect(resolutions[id].verified).toBe(true);
      expect(resolutions[id].legal_city).toBe(city);
      expect(html).toContain(`address_id=${id}`);
      expect(html).toContain(city);
    }
    expect(html).toContain("Renters");
    expect(html).toContain("Advocates &amp; agencies");
    expect(html).toContain("Housing providers");
    expect(html).toContain("/workspace?view=changes");
    expect(html).toContain("tab=summary");
    expect(html).toContain("aria-label=");
    expect(html).not.toContain("100%");
  });
});
