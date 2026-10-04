import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvaluatedRule, PropertyEvaluation } from "../src/domain/types";
import { CategoryPanel, EvidenceDialog, LawTable, PropertySummary } from "../src/components/lovable/results";

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
  it("keeps all atomic requirements from the same category visible in every result view", () => {
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
});
