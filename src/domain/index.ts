import generated from "../data/challenge.json";
import { CATEGORIES, DEFAULT_AS_OF, type ChallengeData, type DomainContext, type Dashboard, type SourceDocument } from "./types";
import { evaluatePropertyRecord, ruleStatusAt } from "./evaluator";
import { evaluateChangeCases } from "./changes";
import { validateRuleBundle as validateBundle, queryDateSchema } from "./validation";
export * from "./types";
export { predicateSchema, ruleRecordSchema, ruleLogicSchema, ruleBundleSchema, queryDateSchema } from "./validation";
export { evaluatePredicate } from "./predicates";
export { ruleStatusAt, certificateAgeYears } from "./evaluator";
export const challengeData = generated as unknown as ChallengeData;
export const properties = challengeData.properties;
export const sources = challengeData.sources;
export const changeFixtures = challengeData.changeFixtures;
const propertyIndex = new Map(properties.map(property => [property.address_id, property]));
const sourceIndex = new Map(sources.map(source => [source.doc_id, source]));
const pageNumber = (value: number | undefined, fallback: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;

export function searchProperties(query = "", options: { limit?: number; offset?: number; state?: string; city?: string } = {}) {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = properties.filter(property => (!options.state || property.state === options.state) && (!options.city || property.legal_city_candidate === options.city) && (!normalized || `${property.address_id} ${property.street_address} ${property.postal_city} ${property.state} ${property.zip} ${property.legal_city_candidate}`.toLocaleLowerCase().includes(normalized)));
  const limit = pageNumber(options.limit, 25, 500), offset = pageNumber(options.offset, 0, properties.length);
  return { properties: matches.slice(offset, offset + limit), total: matches.length, limit, offset };
}
export function getProperty(addressId: string) { return propertyIndex.get(addressId) ?? null; }
export function getSources(options: { query?: string; state?: string; status?: string; limit?: number; offset?: number } = {}, context: DomainContext = {}) {
  const query = options.query?.toLocaleLowerCase();
  const matches = (context.sources ?? sources).filter(source => {
    const statusMatches = !options.status || (options.status === "captured" ? source.captured : options.status === "link_only" ? !source.captured : source.status === options.status);
    return (!query || `${source.doc_id} ${source.jurisdictions} ${source.url} ${source.source_type}`.toLocaleLowerCase().includes(query)) && (!options.state || source.jurisdictions.includes(options.state)) && statusMatches;
  });
  const limit = pageNumber(options.limit, 100, 500), offset = pageNumber(options.offset, 0, matches.length);
  return { sources: matches.slice(offset, offset + limit).map(({ text: _text, ...metadata }) => metadata), total: matches.length, limit, offset };
}
export function getSource(docId: string, context: DomainContext = {}): SourceDocument | null { return context.sources?.find(source => source.doc_id === docId) ?? sourceIndex.get(docId) ?? null; }
export function getDashboard(context: DomainContext = {}): Dashboard {
  const currentSources = context.sources ?? sources;
  return { property_count: properties.length, source_count: currentSources.length, captured_source_count: currentSources.filter(source => source.captured).length, link_only_source_count: currentSources.filter(source => !source.captured).length, verified_rule_count: context.rules?.length ?? 0, change_case_count: changeFixtures.length, unresolved_jurisdiction_count: properties.filter(property => !context.jurisdictionResolutions?.[property.address_id]?.verified).length, missing_year_count: properties.filter(property => property.year_built === null).length, missing_units_count: properties.filter(property => property.units === null).length, missing_zip_count: properties.filter(property => !property.zip).length, states: [...new Set(properties.map(property => property.state))].map(state => ({ state, property_count: properties.filter(property => property.state === state).length })), categories: CATEGORIES, default_as_of: DEFAULT_AS_OF, notices: ["Not legal advice.", "Fixture expectations are separate from evaluated results.", context.rules?.length ? "Source-reviewed rules are available; missing property and tenancy facts remain explicit." : "No legal rules are available in this context. An empty result does not establish that no laws apply."] };
}
export function getCoverageReport(context: DomainContext = {}) {
  const evaluated = properties.map(property => evaluatePropertyRecord(property, DEFAULT_AS_OF, context, context.sources ?? sources));
  const withRecords = evaluated.filter(item => item.rules.length > 0);
  const withApplicable = evaluated.filter(item => item.rules.some(rule => rule.result === "applies"));
  const examples = [
    { persona: "Renters", address_id: "A0001", purpose: "Read screening and deposit duties, inspect source quotes and identify facts needed for rent protections." },
    { persona: "Advocates and agencies", address_id: "A0008", purpose: "Compare Jersey City and state rules, then inspect future NJ FAIR and possible local interactions in change tracking." },
    { persona: "Housing providers", address_id: "A0010", purpose: "Review Cambridge and Massachusetts rental duties, screening costs and pending proposals with a dated property summary." },
  ];
  return { as_of: DEFAULT_AS_OF, total_addresses: properties.length, addresses_with_rules: withRecords.length, addresses_with_in_force_rules: withApplicable.length, empty_address_ids: evaluated.filter(item => !item.rules.length).map(item => item.property.address_id), minimum_rules_per_address: Math.min(...evaluated.map(item => item.rules.length)), verified_municipalities: evaluated.filter(item => item.jurisdiction.verified).length, unresolved_municipality_ids: evaluated.filter(item => !item.jurisdiction.verified).map(item => item.property.address_id), coverage_complete: false, audit: challengeData.corpusAudit ?? null, cities: [...new Set(properties.map(property => `${property.legal_city_candidate}, ${property.state}`))].map(city => { const items=evaluated.filter(item => `${item.property.legal_city_candidate}, ${item.property.state}`===city); return { city, addresses: items.length, with_rules: items.filter(item => item.rules.length).length, with_in_force_rules: items.filter(item => item.rules.some(rule => rule.result === "applies")).length, verified_municipalities: items.filter(item => item.jurisdiction.verified).length }; }), examples: examples.map(example => { const item=evaluated.find(item => item.property.address_id===example.address_id)!; return { ...example, street_address: item.property.street_address, city: item.jurisdiction.city ?? item.property.legal_city_candidate, rules: item.rules.length, in_force_rules: item.rules.filter(rule => rule.result === "applies").length, missing_facts: item.missing_facts, url: `/?address_id=${example.address_id}&as_of=${DEFAULT_AS_OF}` }; }), limitations: ["Data availability measures recorded requirements; it does not certify complete legal coverage.", "Missing ownership, tenant history, occupancy certificates and exemption notices must be supplied with evidence rather than inferred from public maps.", "Unmatched or ambiguous municipalities retain statewide records and candidate-city rules marked unknown."] };
}
export function evaluateProperty(addressId: string, asOf = DEFAULT_AS_OF, context: DomainContext = {}) {
  const property = getProperty(addressId);
  if (!property) return null;
  return evaluatePropertyRecord(property, asOf, context, context.sources ?? sources);
}
export function evaluateChanges(context: DomainContext = {}) { return evaluateChangeCases(changeFixtures, properties, context.sources ?? sources, context); }
export function validateRuleBundle(input: unknown, documents: readonly SourceDocument[] = sources) { return validateBundle(input, documents); }
export function exportSubmissions(asOf = DEFAULT_AS_OF, context: DomainContext = {}) {
  queryDateSchema.parse(asOf);
  const evaluated = properties.map(property => evaluatePropertyRecord(property, asOf, context, context.sources ?? sources));
  const changes = evaluateChanges(context);
  return {
    rules: { rules: (context.rules ?? []).map(rule => {
      const temporal = ruleStatusAt(rule, context.ruleLogic?.[rule.team_rule_id], asOf).status;
      const status = temporal === "applies" ? "in_force" : temporal === "pending" ? "pending" : temporal === "not_yet_effective" ? "not_yet_effective" : rule.status;
      return { ...rule, status };
    }) },
    lookups: { as_of: asOf, lookups: Object.fromEntries(evaluated.map(item => [item.property.address_id, item.rules.map(rule => ({ team_rule_id: rule.team_rule_id, result: rule.result, explanation: rule.explanation, conflict_flag: rule.conflict_flag }))])) },
    changes: Object.fromEntries(changes.map(change => [change.test_id, { affected_address_ids: change.affected_address_ids, conflict_flag_address_ids: change.conflict_flag_address_ids, notes: change.notes }])),
    readiness: { ready: Boolean(context.rules?.length) && changes.every(change => change.evaluation_status === "evaluated"), rule_count: context.rules?.length ?? 0, evaluated_address_count: properties.length, incomplete_cases: changes.filter(change => change.evaluation_status !== "evaluated").map(change => change.test_id), unresolved_address_count: evaluated.filter(item => !item.jurisdiction.verified || item.rules.some(rule => rule.result === "unknown")).length },
  };
}
