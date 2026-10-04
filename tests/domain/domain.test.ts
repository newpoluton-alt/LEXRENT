import { describe, expect, it } from "vitest";
import { challengeData, getDashboard, searchProperties, getSources, getSource, evaluateProperty, evaluateChanges, exportSubmissions, validateRuleBundle, evaluatePredicate, ruleStatusAt, certificateAgeYears, type DomainContext, type RuleRecord, type SourceDocument, type RuleLogic } from "../../src/domain";
import { evaluateChangeCases } from "../../src/domain/changes";

// Synthetic records exist only in tests. Production deliberately imports zero legal rules.
const quote = "A synthetic requirement used solely to test the deterministic evaluation contract.";
const source: SourceDocument = { doc_id: "TEST", jurisdictions: "NJ", url: "https://example.invalid/test", source_type: "test fixture", capture: "yes", retrieved_at: "2026-10-01T00:00Z", sha256: "test-hash", text_file: "test", status: "ok", captured: true, text: `Source header\n${quote}\n` };
function rule(id: string, overrides: Partial<RuleRecord> = {}): RuleRecord {
  return { team_rule_id: id, jurisdiction: "NJ", level: "state", category: "algorithmic_rent_setting", status: "in_force", title: `Test ${id}`, requirement: "Synthetic test obligation.", citation: `Test section ${id}`, source_doc_id: source.doc_id, source_url: source.url, quoted_span: quote, ...overrides };
}
const njProperty = challengeData.properties.find(property => property.state === "NJ")!;
function context(rules: RuleRecord[], ruleLogic: Record<string, RuleLogic> = {}): DomainContext { return { rules, ruleLogic, sources: [source] }; }
function verifiedJurisdictions() {
  return Object.fromEntries(challengeData.properties.map(property => [property.address_id, { verified: true, state: property.state, legal_city: property.legal_city_candidate, method: "manual_review" as const, resolved_at: "2026-10-01T00:00Z", source_url: "https://example.invalid/test-boundary" }]));
}

describe("challenge source inventory", () => {
  it("preserves all supplied inputs without preloading fabricated rules", () => {
    expect(getDashboard()).toMatchObject({ property_count: 500, source_count: 87, captured_source_count: 54, verified_rule_count: 0, change_case_count: 5, missing_year_count: 212, missing_units_count: 242, missing_zip_count: 130 });
    expect(challengeData.verifiedRules).toEqual([]);
    expect(getSources({ status: "captured" }).total).toBe(54);
    expect(getSources({ status: "link_only" }).total).toBe(33);
    expect(getSource("D069")?.text).toContain("approved July 20, 2026");
  });
  it("retains postal aliases as candidates rather than verified municipalities", () => {
    const candidate = searchProperties("San Ysidro").properties[0];
    expect(candidate.legal_city_candidate).toBe("San Diego");
    expect(evaluateProperty(candidate.address_id)?.jurisdiction).toMatchObject({ city: null, verified: false });
    expect(evaluateProperty(candidate.address_id)?.notices.join(" ")).toContain("empty result does not mean no laws apply");
  });
});

describe("typed coverage predicates", () => {
  it("uses three-valued logic without treating absent facts as false", () => {
    const predicate = { all: [{ field: "units", op: "gte", value: 3 }, { field: "owner_occupied", op: "eq", value: false }] };
    expect(evaluatePredicate(predicate, { units: 4 }).value).toBe("unknown");
    expect(evaluatePredicate(predicate, { units: 1 }).value).toBe(false);
    expect(evaluatePredicate({ any: [{ field: "units", op: "gte", value: 3 }, { field: "owner_occupied", op: "eq", value: false }] }, { units: 4 }).value).toBe(true);
    expect(evaluatePredicate({ not: { field: "owner_occupied", op: "eq", value: true } }, {}).value).toBe("unknown");
  });
  it("rejects executable text, unlisted fields and coercive comparisons", () => {
    expect(evaluatePredicate("process.exit()", {}).value).toBe("unknown");
    expect(evaluatePredicate({ field: "constructor", op: "eq", value: "x" }, {}).value).toBe("unknown");
    expect(evaluatePredicate({ field: "units", op: "gte", value: "3" }, { units: 5 }).value).toBe("unknown");
  });
  it("never substitutes year built for a certificate-of-occupancy date", () => {
    const value = evaluatePredicate({ field: "certificate_of_occupancy_date", op: "lte", value: "1978-10-01" }, { year_built: 1970 });
    expect(value).toMatchObject({ value: "unknown", missing_facts: ["certificate_of_occupancy_date"] });
  });
});

describe("source-backed imports", () => {
  it("accepts exact quote/source identity and rejects invented evidence", () => {
    expect(validateRuleBundle({ rules: [rule("one")], ruleLogic: { one: { coverage: { all: [] } } } }, [source]).valid).toBe(true);
    expect(validateRuleBundle({ rules: [rule("one", { quoted_span: `${quote} invented addition` })] }, [source]).valid).toBe(false);
    expect(validateRuleBundle({ rules: [rule("one", { source_url: "https://wrong.invalid" })] }, [source]).valid).toBe(false);
    expect(validateRuleBundle({ rules: [rule("one")] }, [{ ...source, text: undefined, captured: false }]).valid).toBe(false);
    expect(validateRuleBundle({ rules: [rule("one")] }, [{ ...source, text: "A newer capture without the earlier quoted paragraph." }, source]).valid).toBe(true);
  });
  it("rejects duplicate IDs, unknown interaction targets and code predicates", () => {
    expect(validateRuleBundle({ rules: [rule("one"), rule("one")] }, [source]).valid).toBe(false);
    expect(validateRuleBundle({ rules: [rule("one")], ruleLogic: { one: { coverage: { all: [] }, supersedes: ["absent"] } } }, [source]).valid).toBe(false);
    expect(validateRuleBundle({ rules: [rule("one")], ruleLogic: { one: { coverage: { expression: "eval('x')" } } } }, [source]).valid).toBe(false);
  });
  it("rejects cyclic supersession rather than choosing a winner by array order", () => {
    const result = validateRuleBundle({ rules: [rule("a"), rule("b")], ruleLogic: { a: { coverage: { all: [] }, supersedes: ["b"] }, b: { coverage: { all: [] }, supersedes: ["a"] } } }, [source]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(issue => issue.message.includes("cycle"))).toBe(true);
  });
});

describe("temporal and geographic evaluation", () => {
  it("derives rolling certificate age from query date and completed calendar anniversaries", () => {
    expect(certificateAgeYears("2000-10-04", "2010-10-03")).toBe(9);
    expect(certificateAgeYears("2000-10-04", "2010-10-04")).toBe(10);
    expect(certificateAgeYears("2000-10-04", "2026-10-01")).toBe(25);
    expect(certificateAgeYears("2025-12-01", "2026-10-01")).toBe(0);
    expect(certificateAgeYears("2011-10-04", "2026-10-03")).toBe(14);
    expect(certificateAgeYears("2011-10-04", "2026-10-04")).toBe(15);
    expect(certificateAgeYears("2024-02-29", "2025-02-28")).toBe(0);
    expect(certificateAgeYears("2024-02-29", "2025-03-01")).toBe(1);
    expect(certificateAgeYears(null, "2026-10-01")).toBeNull();
    expect(certificateAgeYears("2027-01-01", "2026-10-01")).toBeNull();
    expect(certificateAgeYears("2026-02-30", "2026-10-01")).toBeNull();
  });
  it("supports a rolling fifteen-year condition without accepting a forged age or substituting year built", () => {
    const ctx = context([rule("rolling", { effective_date: "2000-01-01" })], { rolling: { coverage: { field: "certificate_age_years", op: "gte", value: 15 } } });
    ctx.propertyOverrides = { [njProperty.address_id]: { certificate_of_occupancy_date: "2011-10-04", certificate_age_years: 999 } };
    expect(evaluateProperty(njProperty.address_id, "2026-10-03", ctx)?.rules).toEqual([]);
    expect(evaluateProperty(njProperty.address_id, "2026-10-04", ctx)?.rules[0].result).toBe("applies");
    expect(evaluateProperty(njProperty.address_id, "2010-10-04", ctx)?.rules[0].result).toBe("unknown");
    expect(evaluateProperty(njProperty.address_id, "2026-10-03", ctx)?.input_snapshot.facts.certificate_age_years).toBe(14);
    ctx.propertyOverrides = { [njProperty.address_id]: { year_built: 1900, certificate_age_years: 999 } };
    expect(evaluateProperty(njProperty.address_id, "2026-10-04", ctx)?.rules[0].result).toBe("unknown");
    expect(evaluatePredicate({ field: "certificate_age_years", op: "gte", value: "15" }, { certificate_age_years: 20 }).value).toBe("unknown");
  });
  it("activates an enacted law on its effective date", () => {
    const future = rule("future", { status: "not_yet_effective", effective_date: "2027-07-01" });
    const ctx = context([future], { future: { coverage: { all: [] }, lifecycle: { enacted_on: "2026-07-20", effective_on: "2027-07-01" } } });
    expect(evaluateProperty(njProperty.address_id, "2026-10-01", ctx)?.rules[0].result).toBe("not_yet_effective");
    expect(evaluateProperty(njProperty.address_id, "2027-07-01", ctx)?.rules[0].result).toBe("applies");
    expect(ruleStatusAt(rule("pending", { status: "pending", effective_date: "2027-07-01" }), undefined, "2026-10-01").status).toBe("pending");
    expect(ruleStatusAt(rule("partial", { effective_date: "2026" }), undefined, "2026-06-01").status).toBe("unknown");
    expect(ruleStatusAt(rule("enacted", { status: "pending" }), { coverage: { all: [] }, lifecycle: { enacted_on: "2026-01-01" } }, "2026-10-01").status).toBe("unknown");
    expect(ruleStatusAt(rule("failed", { status: "failed" }), undefined, "2025-01-01").status).toBe("unknown");
    expect(() => evaluateProperty(njProperty.address_id, "2026-02-30", ctx)).toThrow();
  });
  it("requires verified city boundaries and preserves distinct requirements", () => {
    const city = rule("city", { level: "city", jurisdiction: `${njProperty.legal_city_candidate}, NJ` });
    const state = rule("state");
    const ctx = context([city, state], { city: { coverage: { all: [] }, supersedes: ["state"] }, state: { coverage: { all: [] } } });
    const unresolved = evaluateProperty(njProperty.address_id, undefined, ctx)!;
    expect(unresolved.rules.find(rule => rule.team_rule_id === "city")?.result).toBe("unknown");
    expect(unresolved.rules.find(rule => rule.team_rule_id === "state")?.result).toBe("applies");
    ctx.jurisdictionResolutions = verifiedJurisdictions();
    const resolved = evaluateProperty(njProperty.address_id, undefined, ctx)!;
    expect(resolved.rules.find(rule => rule.team_rule_id === "city")?.result).toBe("applies");
    expect(resolved.rules.find(rule => rule.team_rule_id === "state")?.result).toBe("superseded");
  });
  it("applies every direct supersession edge from one snapshot across all rule permutations", () => {
    const a = rule("a"), b = rule("b"), c = rule("c");
    const logic: Record<string, RuleLogic> = { a: { coverage: { all: [] }, supersedes: ["b"] }, b: { coverage: { all: [] }, supersedes: ["c"] }, c: { coverage: { all: [] } } };
    const permutations = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
    const snapshots = permutations.map(rules => evaluateProperty(njProperty.address_id, undefined, context(rules, logic))!.rules.map(result => ({ id: result.team_rule_id, result: result.result, explanation: result.explanation })).sort((left, right) => left.id.localeCompare(right.id)));
    expect(snapshots[0].map(({ id, result }) => ({ id, result }))).toEqual([{ id: "a", result: "applies" }, { id: "b", result: "superseded" }, { id: "c", result: "superseded" }]);
    for (const snapshot of snapshots.slice(1)) expect(snapshot).toEqual(snapshots[0]);
  });
  it("cannot supersede an applicable target from unknown coverage, missing evidence, or an inactive date", () => {
    const cases: { governing: RuleRecord; logic: RuleLogic; expected: string }[] = [
      { governing: rule("a"), logic: { coverage: { field: "owner_occupied", op: "eq", value: true }, supersedes: ["b"] }, expected: "unknown" },
      { governing: rule("a", { quoted_span: "This quotation is not in the captured source." }), logic: { coverage: { all: [] }, supersedes: ["b"] }, expected: "unknown" },
      { governing: rule("a", { status: "not_yet_effective", effective_date: "2027-01-01" }), logic: { coverage: { all: [] }, supersedes: ["b"] }, expected: "not_yet_effective" },
      { governing: rule("a", { status: "pending" }), logic: { coverage: { all: [] }, supersedes: ["b"] }, expected: "pending" },
    ];
    for (const { governing, logic, expected } of cases) for (const rules of [[governing, rule("b")], [rule("b"), governing]]) {
      const evaluation = evaluateProperty(njProperty.address_id, undefined, context(rules, { a: logic, b: { coverage: { all: [] } } }))!;
      expect(evaluation.rules.find(result => result.team_rule_id === "a")?.result).toBe(expected);
      expect(evaluation.rules.find(result => result.team_rule_id === "b")?.result).toBe("applies");
    }
  });
  it("does not call a missing-unit or unsupported-source rule applicable", () => {
    const ctx = context([rule("units")], { units: { coverage: { field: "units", op: "gte", value: 3 } } });
    const absentUnits = challengeData.properties.find(property => property.state === "NJ" && property.units === null)!;
    expect(evaluateProperty(absentUnits.address_id, undefined, ctx)?.rules[0].result).toBe("unknown");
    ctx.sources = [{ ...source, captured: false, text: undefined }];
    ctx.propertyOverrides = { [absentUnits.address_id]: { units: 10 } };
    expect(evaluateProperty(absentUnits.address_id, undefined, ctx)?.rules[0].result).toBe("unknown");
    expect(evaluateProperty(absentUnits.address_id, undefined, ctx)?.missing_facts).not.toContain("units");
  });
});

describe("change fixtures and exact exports", () => {
  it("never substitutes fixture expectations for evaluated rules", () => {
    const changes = evaluateChanges();
    expect(changes.every(change => change.evaluation_status === "not_evaluated")).toBe(true);
    expect(changes.map(change => change.expected_address_count)).toEqual([250, 90, 140, 110, 0]);
    expect(changes.every(change => change.affected_address_ids.length === 0)).toBe(true);
    const exported = exportSubmissions();
    expect(Object.keys(exported.lookups.lookups)).toHaveLength(500);
    expect(Object.keys(exported.changes)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(exported.readiness.ready).toBe(false);
  });
  it("evaluates all five tests only after real-shaped rules, predicates and boundary evidence are supplied", () => {
    const rules = [
      rule("CA-ALG-01", { jurisdiction: "CA", effective_date: "2026-01-01" }),
      rule("HOB-ALG-01", { jurisdiction: "Hoboken, NJ", level: "city" }),
      rule("JC-ALG-01", { jurisdiction: "Jersey City, NJ", level: "city" }),
      rule("NJ-ALG-01", { status: "not_yet_effective", effective_date: "2027-07-01" }),
      rule("MA-ALG-P1", { jurisdiction: "MA", status: "pending" }),
      rule("MA-ALG-P2", { jurisdiction: "MA", status: "pending" }),
      rule("MA-RENT-P1", { jurisdiction: "MA", category: "rent_increase_limits", status: "failed" }),
    ];
    const logic = Object.fromEntries(rules.map(rule => [rule.team_rule_id, { coverage: { all: [] } }])) as Record<string, RuleLogic>;
    logic["NJ-ALG-01"].conflicts_with = ["HOB-ALG-01", "JC-ALG-01"];
    const ctx = { ...context(rules, logic), jurisdictionResolutions: verifiedJurisdictions() };
    const evaluated = evaluateChanges(ctx);
    expect(evaluated.map(change => change.affected_address_ids.length)).toEqual([250, 90, 140, 110, 0]);
    expect(evaluated[2].conflict_flag_address_ids).toHaveLength(90);
    expect(evaluated.every(change => change.evaluation_status === "evaluated")).toBe(true);
    expect(evaluateProperty(challengeData.properties.find(property => property.state === "MA")!.address_id, undefined, ctx)?.rules.some(result => result.rule.category === "rent_increase_limits")).toBe(false);
  });
  it("pairs the same rule ID across temporal snapshots", () => {
    const rules = [rule("already-active", { effective_date: "2025-01-01" }), rule("still-future", { status: "not_yet_effective", effective_date: "2028-01-01" })];
    const ctx = context(rules, { "already-active": { coverage: { all: [] } }, "still-future": { coverage: { all: [] } } });
    const [result] = evaluateChangeCases([{ test_id: "PAIR", title: "Pair identities", type: "as_of", rule_ids: ["already-active", "still-future"], states: ["NJ"], as_of_before: "2026-01-01", as_of_after: "2027-01-01", expected_behavior: "No rule activates." }], [njProperty], [source], ctx);
    expect(result.affected_address_ids).toEqual([]);
  });
});
