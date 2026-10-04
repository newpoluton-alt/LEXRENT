import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { challengeData, DEFAULT_AS_OF, evaluateProperty, evaluateChanges, getCoverageReport, ruleStatusAt, validateRuleBundle, type DomainContext, type FactRecord } from "../../src/domain";

const seeded: DomainContext = {
  rules: challengeData.verifiedRules,
  ruleLogic: challengeData.ruleLogic,
  sources: challengeData.sources,
  jurisdictionResolutions: challengeData.jurisdictionResolutions,
};
const documents = new Map(challengeData.sources.map(source => [source.doc_id, source]));
const hashes = new Map(challengeData.sources.filter(source => source.captured && source.text).map(source => [source.doc_id, createHash("sha256").update(source.text!).digest("hex")]));
const evaluations = challengeData.properties.map(property => evaluateProperty(property.address_id, DEFAULT_AS_OF, seeded)!);
const ruleById = (id: string) => challengeData.verifiedRules.find(rule => rule.team_rule_id === id)!;
const evaluateWithFacts = (addressId: string, facts: FactRecord) => evaluateProperty(addressId, DEFAULT_AS_OF, { ...seeded, propertyOverrides: { [addressId]: facts } })!;

describe("source-reviewed challenge corpus", () => {
  it("rejects missing supplemental evidence for dates or proposal status", () => {
    const rule = ruleById("CA-ALG-01");
    expect(rule.supporting_source_doc_ids).toContain("S017");
    const input = { rules: challengeData.verifiedRules, ruleLogic: challengeData.ruleLogic };
    expect(validateRuleBundle(input, challengeData.sources.filter(source => source.doc_id !== "S017"))).toMatchObject({ valid: false });
    expect(validateRuleBundle(input, challengeData.sources.map(source => source.doc_id === "D045" ? { ...source, captured: false, text: undefined } : source))).toMatchObject({ valid: false });
  });
  it("gives all 500 addresses an applicable state baseline with exact hashed evidence", () => {
    expect(evaluations).toHaveLength(500);
    expect(validateRuleBundle({ rules: seeded.rules, ruleLogic: seeded.ruleLogic }, challengeData.sources)).toMatchObject({ valid: true, errors: [], warnings: [] });
    for (const evaluation of evaluations) {
      expect(evaluation.rules.some(result => result.rule.level === "state" && result.result === "applies"), evaluation.property.address_id).toBe(true);
      expect(evaluation.coverage_complete).toBe(false);
      for (const result of evaluation.rules) {
        const evidence = result.evidence!;
        expect(evidence, `${evaluation.property.address_id}/${result.team_rule_id}`).not.toBeNull();
        const document = documents.get(evidence.doc_id)!;
        expect(document.captured).toBe(true);
        expect(evidence.source_url).toBe(document.url);
        expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(evidence.sha256).toBe(hashes.get(document.doc_id));
        expect(document.text!.slice(evidence.start_offset, evidence.end_offset)).toBe(result.rule.quoted_span);
        expect(evidence.quoted_span).toBe(result.rule.quoted_span);
      }
    }
  });

  it("keeps 400 Census and 47 parcel-supported municipalities with 53 cautious state fallbacks", () => {
    const verified = evaluations.filter(evaluation => evaluation.jurisdiction.verified);
    const unresolved = evaluations.filter(evaluation => !evaluation.jurisdiction.verified);
    expect(verified).toHaveLength(447);
    expect(verified.filter(evaluation => evaluation.jurisdiction.method === "census_geographies")).toHaveLength(400);
    const parcels = verified.filter(evaluation => evaluation.jurisdiction.method === "manual_review");
    expect(parcels).toHaveLength(47);
    for (const evaluation of parcels) {
      const resolution = evaluation.input_snapshot.resolution!;
      expect(evaluation.property.state).toBe("NJ");
      expect(resolution.parcel_evidence!.PROP_LOC).toBe(evaluation.property.street_address);
      expect(resolution.parcel_evidence!.capture_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(resolution.parcel_evidence!.provider_response_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(resolution.municipality_id).toBe(`NJ:${resolution.parcel_evidence!.PCL_MUN}`);
    }
    expect(unresolved).toHaveLength(53);
    for (const evaluation of evaluations) {
      for (const result of evaluation.rules.filter(result => result.rule.level === "city")) {
        const city = result.rule.jurisdiction.slice(0, -4);
        expect(city).toBe(evaluation.jurisdiction.city ?? evaluation.property.legal_city_candidate);
        if (!evaluation.jurisdiction.verified) {
          expect(result.result).toBe("unknown");
          expect(result.missing_facts).toContain("legal_municipality");
        }
      }
      if (!evaluation.jurisdiction.verified) {
        expect(evaluation.jurisdiction.city).toBeNull();
        expect(evaluation.rules.some(result => result.rule.level === "state" && result.result === "applies")).toBe(true);
        expect(evaluation.missing_facts).toContain("legal_municipality");
      }
    }
  });

  it("evaluates all 90 local NJ interaction addresses after exact complete-range parcel review", () => {
    const change = evaluateChanges(seeded).find(item => item.test_id === "T2")!;
    expect(change).toMatchObject({ evaluation_status: "evaluated", expected_address_count: 90, unresolved_address_ids: [], missing_rule_ids: [] });
    expect(change.affected_address_ids).toHaveLength(90);
    for (const id of change.affected_address_ids) {
      const resolution = challengeData.jurisdictionResolutions![id];
      expect(resolution.state).toBe("NJ");
      expect(["Hoboken", "Jersey City"]).toContain(resolution.legal_city);
      expect(evaluateProperty(id, "2027-07-01", seeded)!.rules.find(rule => rule.team_rule_id === "NJ-ALG-01")?.evidence).not.toBeNull();
    }
  });

  it("supports the three real renter, advocate and housing-provider examples", () => {
    const renter = evaluateProperty("A0001", DEFAULT_AS_OF, seeded)!;
    const advocate = evaluateProperty("A0008", DEFAULT_AS_OF, seeded)!;
    const provider = evaluateProperty("A0010", DEFAULT_AS_OF, seeded)!;
    expect(renter.property.street_address).toBe("6238 DE LONGPRE AVE");
    expect(advocate.property.street_address).toBe("1065 SUMMIT AVENUE");
    expect(provider.property.street_address).toBe("134 Oxford St");
    expect(renter.jurisdiction).toMatchObject({ city: "Los Angeles", verified: true });
    expect(advocate.jurisdiction).toMatchObject({ city: "Jersey City", verified: true });
    expect(provider.jurisdiction).toMatchObject({ city: "Cambridge", verified: true });
    expect(renter.rules.find(rule => rule.team_rule_id === "CA-FEE-01")?.result).toBe("applies");
    expect(advocate.rules.find(rule => rule.team_rule_id === "JC-ALG-01")?.result).toBe("applies");
    expect(advocate.rules.find(rule => rule.team_rule_id === "NJ-ALG-01")?.result).toBe("not_yet_effective");
    expect(provider.rules.find(rule => rule.team_rule_id === "MA-FEE-02")?.result).toBe("applies");
    expect(provider.rules.find(rule => rule.team_rule_id === "MA-ALG-P1")?.result).toBe("pending");
    expect(getCoverageReport(seeded)).toMatchObject({ total_addresses: 500, addresses_with_rules: 500, addresses_with_in_force_rules: 500, coverage_complete: false });
    expect(getCoverageReport(seeded).examples.map(example => example.address_id)).toEqual(["A0001", "A0008", "A0010"]);
  });

  it("activates the NJ fee and FAIR duties on supported dates and excludes the failed MA initiative", () => {
    const fee = ruleById("NJ-FEE-01"), fair = ruleById("NJ-ALG-01"), failed = ruleById("MA-RENT-P1");
    expect(ruleStatusAt(fee, seeded.ruleLogic?.[fee.team_rule_id], "2026-04-30").status).toBe("not_yet_effective");
    expect(ruleStatusAt(fee, seeded.ruleLogic?.[fee.team_rule_id], "2026-05-01").status).toBe("applies");
    expect(ruleStatusAt(fair, seeded.ruleLogic?.[fair.team_rule_id], "2027-06-30").status).toBe("not_yet_effective");
    expect(ruleStatusAt(fair, seeded.ruleLogic?.[fair.team_rule_id], "2027-07-01").status).toBe("applies");
    for (const property of challengeData.properties.filter(property => property.state === "NJ")) {
      expect(evaluateProperty(property.address_id, "2027-07-01", seeded)!.rules.find(result => result.team_rule_id === fair.team_rule_id)?.result).toBe("applies");
    }
    expect(ruleStatusAt(failed, seeded.ruleLogic?.[failed.team_rule_id], "2026-06-22").status).toBe("pending");
    expect(ruleStatusAt(failed, seeded.ruleLogic?.[failed.team_rule_id], "2026-06-23").status).toBe("excluded");
    for (const evaluation of evaluations.filter(evaluation => evaluation.property.state === "MA")) {
      expect(evaluation.rules.some(result => result.team_rule_id === failed.team_rule_id)).toBe(false);
      expect(evaluation.rules.find(result => result.team_rule_id === "MA-RENT-01")?.rule.key_value).toContain("No mandatory cap");
    }
  });

  it("does not equate an individual voucher with a restriction on the property", () => {
    const facts: FactRecord = { is_subsidized: true, certificate_of_occupancy_date: "1970-01-01", special_housing_exempt: false, separately_alienable: false, city_rent_controlled: false };
    const unknown = evaluateWithFacts("A0001", facts).rules.find(result => result.team_rule_id === "CA-RENT-01")!;
    expect(unknown.result).toBe("unknown");
    expect(unknown.missing_facts).toContain("affordable_housing_restricted");
    expect(evaluateWithFacts("A0001", { ...facts, affordable_housing_restricted: false }).rules.find(result => result.team_rule_id === "CA-RENT-01")?.result).toBe("applies");
    expect(evaluateWithFacts("A0001", { ...facts, affordable_housing_restricted: true }).rules.some(result => result.team_rule_id === "CA-RENT-01")).toBe(false);
  });

  it("keeps certificate-based coverage unknown when only construction year or a forged age is supplied", () => {
    const evaluation = evaluateWithFacts("A0001", { year_built: 1900, certificate_age_years: 126, affordable_housing_restricted: false, special_housing_exempt: false, separately_alienable: false, city_rent_controlled: false });
    expect(evaluation.input_snapshot.facts.certificate_age_years).toBeNull();
    const cap = evaluation.rules.find(result => result.team_rule_id === "CA-RENT-01")!;
    expect(cap.result).toBe("unknown");
    expect(cap.missing_facts).toContain("certificate_age_years");
  });

  it("preserves explicit empty-context safeguards alongside the seeded baseline", () => {
    const empty = evaluateProperty("A0001", DEFAULT_AS_OF, { rules: [], ruleLogic: {}, jurisdictionResolutions: {} })!;
    expect(empty.rules).toEqual([]);
    expect(empty.coverage_complete).toBe(false);
    expect(empty.jurisdiction.verified).toBe(false);
    expect(empty.notices.join(" ")).toContain("empty result does not mean no laws apply");
  });
});
