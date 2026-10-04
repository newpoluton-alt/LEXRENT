import type { ChangeFixture, ChangeEvaluation, DomainContext, PropertyRecord, SourceDocument, EvaluatedRule } from "./types";
import { DEFAULT_AS_OF } from "./types";
import { evaluatePropertyRecord } from "./evaluator";

const distinct = (items: string[]) => [...new Set(items)];
export function evaluateChangeCases(fixtures: readonly ChangeFixture[], properties: readonly PropertyRecord[], sources: readonly SourceDocument[], context: DomainContext): ChangeEvaluation[] {
  const allRules = context.rules ?? [];
  const idsForReference = (reference: string) => allRules.filter(rule => rule.team_rule_id === reference || context.ruleLogic?.[rule.team_rule_id]?.fixture_rule_ids?.includes(reference)).map(rule => rule.team_rule_id);
  return fixtures.map(fixture => {
    const ruleIds = distinct(fixture.rule_ids.flatMap(idsForReference));
    const conflictIds = distinct((fixture.conflict_with ?? []).flatMap(idsForReference));
    const missingIds = fixture.rule_ids.filter(reference => !idsForReference(reference).length);
    const conflictMissing = (fixture.conflict_with ?? []).filter(reference => !idsForReference(reference).length);
    const relevant = properties.filter(property => !fixture.states || fixture.states.includes(property.state));
    const expectedCount = fixture.type === "negative" ? 0 : fixture.type === "boundary" ? properties.filter(property => property.state === "NJ" && ["Hoboken", "Jersey City"].includes(property.legal_city_candidate)).length : relevant.length;
    const expectedConflicts = fixture.test_id === "T3" ? properties.filter(property => property.state === "NJ" && ["Hoboken", "Jersey City"].includes(property.legal_city_candidate)).length : 0;
    const output: ChangeEvaluation = { test_id: fixture.test_id, title: fixture.title, type: fixture.type, expected_behavior: fixture.expected_behavior, expected_address_count: expectedCount, expected_conflict_count: expectedConflicts, evaluation_status: "not_evaluated", affected_address_ids: [], conflict_flag_address_ids: [], unresolved_address_ids: [], missing_rule_ids: [...missingIds, ...conflictMissing], matched_rule_ids: ruleIds, notes: "", snapshots: [] };
    if (missingIds.length) { output.notes = `Not evaluated: import evidence-backed rules for ${missingIds.join(", ")}. Fixture expectations are not evaluated legal results.`; return output; }
    const scenarioDates = fixture.type === "as_of" ? [{ date: fixture.as_of_before!, label: "before" }, { date: fixture.as_of_after!, label: "after" }] : [{ date: fixture.as_of ?? DEFAULT_AS_OF, label: fixture.type === "pending" ? "current_pending" : "current" }];
    const snapshots = scenarioDates.map(({ date, label }) => {
      const evaluated = relevant.map(property => evaluatePropertyRecord(property, date, context, sources));
      const resultCounts: Record<string, number> = {};
      for (const result of evaluated.flatMap(item => item.rules.filter(rule => ruleIds.includes(rule.team_rule_id)))) resultCounts[result.result] = (resultCounts[result.result] ?? 0) + 1;
      output.snapshots.push({ as_of: date, scenario: label, result_counts: resultCounts });
      return evaluated;
    });
    const after = snapshots.at(-1)!;
    const related = (rules: EvaluatedRule[]) => rules.filter(rule => ruleIds.includes(rule.team_rule_id));
    if (fixture.type === "negative") {
      const failDate = fixture.as_of ?? DEFAULT_AS_OF;
      const verifiedFailed = allRules.filter(rule => ruleIds.includes(rule.team_rule_id)).every(rule => rule.status === "failed" || Boolean(context.ruleLogic?.[rule.team_rule_id]?.lifecycle?.failed_on && context.ruleLogic[rule.team_rule_id].lifecycle!.failed_on! <= failDate));
      const violations = after.filter(item => related(item.rules).length > 0);
      output.unresolved_address_ids = violations.map(item => item.property.address_id);
      output.evaluation_status = verifiedFailed && !violations.length ? "evaluated" : "needs_review";
      output.notes = verifiedFailed && !violations.length ? "The imported proposal is recorded as failed. It produces no applicable rent cap and the affected set is empty." : "Negative case needs review: the proposal must be recorded as failed and must produce no lookup rule.";
      return output;
    }
    for (let index = 0; index < after.length; index++) {
      const item = after[index], matches = related(item.rules);
      const unknown = matches.some(rule => rule.result === "unknown");
      if (unknown) output.unresolved_address_ids.push(item.property.address_id);
      if (fixture.type === "as_of") {
        const before = related(snapshots[0][index].rules);
        if (matches.some(rule => (rule.result === "applies" || rule.result === "superseded") && before.some(previous => previous.team_rule_id === rule.team_rule_id && previous.result === "not_yet_effective"))) output.affected_address_ids.push(item.property.address_id);
        else if (!unknown && !matches.length && relevant.length) output.unresolved_address_ids.push(item.property.address_id);
      } else if (fixture.type === "pending") {
        if (matches.length && matches.every(rule => rule.result === "pending")) output.affected_address_ids.push(item.property.address_id);
        else if (!unknown) output.unresolved_address_ids.push(item.property.address_id);
      } else if (matches.some(rule => ["applies", "superseded"].includes(rule.result))) output.affected_address_ids.push(item.property.address_id);
      if (item.rules.some(rule => [...ruleIds, ...conflictIds].includes(rule.team_rule_id) && rule.conflict_flag && !rule.missing_facts.includes("legal_municipality"))) output.conflict_flag_address_ids.push(item.property.address_id);
    }
    output.unresolved_address_ids = distinct(output.unresolved_address_ids);
    const countsMatch = output.affected_address_ids.length === expectedCount && (!fixture.conflict_with?.length || output.conflict_flag_address_ids.length === expectedConflicts);
    output.evaluation_status = output.unresolved_address_ids.length || conflictMissing.length || !countsMatch ? "needs_review" : "evaluated";
    output.notes = fixture.type === "pending" ? "Affected IDs are hypothetical exposure if the imported pending proposals were enacted; they are not current-law protections." : "Affected IDs come from imported rules and evaluated property facts, not from the fixture expectation.";
    if (output.evaluation_status === "needs_review") output.notes += " Jurisdiction, rule status, coverage, or expected-case outcomes need review.";
    return output;
  });
}
