import type { DomainContext, PropertyRecord, SourceDocument, RuleRecord, RuleLogic, PropertyEvaluation, EvaluatedRule, FactRecord, LookupResult } from "./types";
import { DEFAULT_AS_OF } from "./types";
import { isValidDate, queryDateSchema, sourceForRule } from "./validation";
import { evaluatePredicate } from "./predicates";

type TemporalDecision = { status: LookupResult | "excluded"; reason: string };
export function certificateAgeYears(certificateDate: unknown, asOf: string): number | null {
  if (typeof certificateDate !== "string" || !isValidDate(certificateDate) || !isValidDate(asOf) || certificateDate > asOf) return null;
  return Number(asOf.slice(0, 4)) - Number(certificateDate.slice(0, 4)) - (asOf.slice(5) < certificateDate.slice(5) ? 1 : 0);
}
export function ruleStatusAt(rule: RuleRecord, logic: RuleLogic | undefined, asOf: string): TemporalDecision {
  const lifecycle = logic?.lifecycle;
  if (lifecycle?.repealed_on && asOf >= lifecycle.repealed_on) return { status: "excluded", reason: `Repealed on ${lifecycle.repealed_on}.` };
  if (rule.status === "failed" || lifecycle?.failed_on) {
    if (!lifecycle?.failed_on && asOf < DEFAULT_AS_OF) return { status: "unknown", reason: "The proposal is recorded as failed in the source snapshot, but its failure date is unavailable for this historical query." };
    return lifecycle?.failed_on && asOf < lifecycle.failed_on ? { status: "pending", reason: `The proposal failed on ${lifecycle.failed_on}; it was not enacted on this earlier query date.` } : { status: "excluded", reason: "This proposal failed and creates no applicable protection." };
  }
  if (lifecycle?.enacted_on && asOf < lifecycle.enacted_on) return { status: "pending", reason: `Enacted on ${lifecycle.enacted_on}, after the query date.` };
  if (rule.status === "pending" && !(lifecycle?.enacted_on && lifecycle.enacted_on <= asOf)) return { status: "pending", reason: "This is a proposal, not enacted law." };
  const effective = lifecycle?.effective_on ?? rule.effective_date;
  if (rule.status === "pending" && lifecycle?.enacted_on && lifecycle.enacted_on <= asOf && !effective) return { status: "unknown", reason: "Enactment is recorded, but an effective date is required to confirm activation." };
  if (effective) {
    const earliest = effective.length === 4 ? `${effective}-01-01` : effective.length === 7 ? `${effective}-01` : effective;
    const latest = effective.length === 4 ? `${effective}-12-31` : effective.length === 7 ? `${effective}-${String(new Date(Number(effective.slice(0, 4)), Number(effective.slice(5, 7)), 0).getDate()).padStart(2, "0")}` : effective;
    if (asOf < earliest) return { status: "not_yet_effective", reason: `Effective ${effective}, after the query date.` };
    if (asOf < latest) return { status: "unknown", reason: `Effective date ${effective} lacks day-level precision.` };
  }
  if (!effective && rule.status === "not_yet_effective") return asOf === DEFAULT_AS_OF ? { status: "not_yet_effective", reason: "Enacted but the exact effective date has not been supplied." } : { status: "unknown", reason: "The effective date is required to evaluate this query date." };
  if (!effective && asOf < DEFAULT_AS_OF) return { status: "unknown", reason: "The source snapshot confirms current status but supplies no exact historical effective date. Adoption alone does not establish when a waiting or publication period ended." };
  return { status: "applies", reason: "In force on the query date." };
}

export function evaluatePropertyRecord(property: PropertyRecord, asOf: string, context: DomainContext, sources: readonly SourceDocument[]): PropertyEvaluation {
  queryDateSchema.parse(asOf);
  const resolution = context.jurisdictionResolutions?.[property.address_id];
  const verified = Boolean(resolution?.verified && resolution.legal_city && resolution.source_url && resolution.resolved_at);
  const state = verified ? resolution!.state : property.state;
  const city = verified ? resolution!.legal_city : null;
  const facts: FactRecord = { year_built: property.year_built, units: property.units, residential_use: true, ...(context.propertyOverrides?.[property.address_id] ?? {}), state, legal_city: city };
  // Derived facts always replace caller overrides; a construction year is never a certificate date.
  facts.certificate_age_years = certificateAgeYears(facts.certificate_of_occupancy_date, asOf);
  const results: EvaluatedRule[] = [];
  for (const rule of context.rules ?? []) {
    const ruleState = rule.level === "state" ? rule.jurisdiction : rule.jurisdiction.slice(-2);
    if (ruleState !== state) continue;
    const ruleCity = rule.level === "city" ? rule.jurisdiction.slice(0, -4) : null;
    if (verified && ruleCity && ruleCity.toLocaleLowerCase() !== city!.toLocaleLowerCase()) continue;
    if (!verified && ruleCity && ruleCity.toLocaleLowerCase() !== property.legal_city_candidate.toLocaleLowerCase()) continue;
    const logic = context.ruleLogic?.[rule.team_rule_id];
    const temporal = ruleStatusAt(rule, logic, asOf);
    if (temporal.status === "excluded") continue;
    const coverage = evaluatePredicate(logic?.coverage ?? rule.coverage_conditions, facts);
    if (coverage.value === false) continue;
    const source = sourceForRule(rule, sources);
    const quoteOffset = source?.text?.indexOf(rule.quoted_span) ?? -1;
    const evidence = source?.captured && quoteOffset >= 0 ? { doc_id: source.doc_id, source_url: source.url, citation: rule.citation, quoted_span: rule.quoted_span, retrieved_at: source.retrieved_at, sha256: source.sha256, start_offset: quoteOffset, end_offset: quoteOffset + rule.quoted_span.length } : null;
    const missing = [...coverage.missing_facts, ...(!verified && ruleCity ? ["legal_municipality"] : []), ...(!evidence ? ["verified_source_evidence"] : [])];
    let result: LookupResult = temporal.status;
    if (coverage.value === "unknown" || missing.length) result = "unknown";
    const reasons = [temporal.reason, ...coverage.reasons];
    if (!verified && ruleCity) reasons.push(`Legal municipality is unresolved; ${property.legal_city_candidate} is a postal-city candidate, not a verified boundary match.`);
    if (!evidence) reasons.push("The supporting quote has not been validated against captured source text.");
    results.push({ team_rule_id: rule.team_rule_id, rule, result, explanation: reasons.join(" "), conflict_flag: Boolean(rule.conflict_flag), missing_facts: [...new Set(missing)], evidence });
  }
  // Every direct edge uses the same applicability snapshot. Replacing B cannot
  // erase B's reviewed replacement of C merely because A was processed first.
  const initiallyApplicable = new Map(results.filter(result => result.result === "applies").map(result => [result.team_rule_id, result]));
  const supersededBy = new Map<string, Map<string, EvaluatedRule>>();
  for (const governing of initiallyApplicable.values()) for (const targetId of context.ruleLogic?.[governing.team_rule_id]?.supersedes ?? []) {
    if (!initiallyApplicable.has(targetId)) continue;
    const governingRules = supersededBy.get(targetId) ?? new Map<string, EvaluatedRule>();
    governingRules.set(governing.team_rule_id, governing);
    supersededBy.set(targetId, governingRules);
  }
  for (const [targetId, governingRules] of supersededBy) {
    const target = initiallyApplicable.get(targetId)!;
    target.result = "superseded";
    for (const governing of [...governingRules.values()].sort((a, b) => a.team_rule_id.localeCompare(b.team_rule_id))) target.explanation += ` ${governing.rule.title} (${governing.team_rule_id}) supersedes this requirement under the explicit interaction record.`;
  }
  for (const governing of results) {
    const logic = context.ruleLogic?.[governing.team_rule_id];
    for (const targetId of logic?.conflicts_with ?? []) {
      const target = results.find(result => result.team_rule_id === targetId);
      if (target) { governing.conflict_flag = true; target.conflict_flag = true; governing.explanation += ` Possible conflict with ${targetId}; human review required.`; target.explanation += ` Possible conflict with ${governing.team_rule_id}; human review required.`; }
    }
  }
  const missing_facts = [...new Set([...property.missing_facts.filter(field => field === "legal_municipality" ? !verified : facts[field as keyof FactRecord] === null || facts[field as keyof FactRecord] === undefined), ...results.flatMap(result => result.missing_facts)])];
  const notices = ["Not legal advice.", "Only imported, evidence-backed rule records are evaluated; this is not a compliance certification."];
  if (!(context.rules?.length)) notices.push("No legal rules have been imported. An empty result does not mean no laws apply.");
  if (!verified) notices.push("The legal municipality is unresolved. City coverage requires a verified jurisdiction match.");
  if (typeof facts.certificate_of_occupancy_date === "string" && facts.certificate_of_occupancy_date > asOf) notices.push("The supplied certificate-of-occupancy date is after the query date; certificate age remains unknown.");
  return { property, as_of: asOf, jurisdiction: { state, city, candidate_city: property.legal_city_candidate, verified, method: verified ? resolution!.method : "postal_city_candidate" }, rules: results, missing_facts, notices, coverage_complete: false, rule_count: results.length, input_snapshot: { facts, resolution: verified ? resolution! : null } };
}
