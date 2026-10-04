export const DEFAULT_AS_OF = "2026-10-01";
export const CATEGORIES = ["rent_increase_limits", "just_cause_eviction", "security_deposits", "application_screening_fees", "screening_restrictions", "algorithmic_rent_setting"] as const;
export type Category = typeof CATEGORIES[number];
export type RuleStatus = "in_force" | "not_yet_effective" | "pending" | "failed";
export type LookupResult = "applies" | "unknown" | "superseded" | "not_yet_effective" | "pending";
export type Scalar = string | number | boolean;
export const FACT_FIELDS = ["year_built", "units", "certificate_of_occupancy_date", "certificate_age_years", "owner_type", "owner_occupied", "owner_total_properties", "owner_total_units", "tenancy_months", "construction_exemption_filed", "is_subsidized", "is_single_family", "residential_use", "state", "legal_city"] as const;
export type FactField = typeof FACT_FIELDS[number];
export type Predicate = { all: Predicate[] } | { any: Predicate[] } | { not: Predicate } | { field: FactField; op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in"; value: Scalar | Scalar[] };
export type FactRecord = Partial<Record<FactField, Scalar | null>>;
export interface RuleRecord {
  team_rule_id: string; jurisdiction: string; level: "state" | "city"; category: Category; status: RuleStatus;
  title: string; requirement: string; citation: string; source_url: string; quoted_span: string;
  key_value?: string | null; coverage_conditions?: string | Record<string, unknown> | null; exemptions?: string | null;
  overrides?: string[]; interaction?: string | null; effective_date?: string | null; source_doc_id?: string | null;
  confidence?: number | null; conflict_flag?: boolean; conflict_note?: string | null;
}
export interface RuleLogic {
  coverage: Predicate;
  lifecycle?: { enacted_on?: string | null; effective_on?: string | null; failed_on?: string | null; repealed_on?: string | null };
  supersedes?: string[]; conflicts_with?: string[]; fixture_rule_ids?: string[];
}
export interface RuleBundle { rules: RuleRecord[]; ruleLogic: Record<string, RuleLogic> }
export interface PropertyRecord {
  address_id: string; street_address: string; postal_city: string; state: string; zip: string;
  year_built: number | null; units: number | null; use_code: string; use_description: string; source_dataset: string; retrieved_at: string;
  legal_city_candidate: string; jurisdiction_status: "unresolved"; missing_facts: string[]; quality_flags: string[];
}
export interface SourceDocument {
  doc_id: string; jurisdictions: string; url: string; source_type: string; capture: string;
  retrieved_at: string; sha256: string; text_file: string; status: string; captured: boolean; text?: string;
}
export interface ChangeFixture {
  test_id: string; title: string; type: "as_of" | "boundary" | "pending" | "negative"; rule_ids: string[];
  as_of?: string; as_of_before?: string; as_of_after?: string; states?: string[]; conflict_with?: string[]; expected_behavior: string;
}
export interface RetrievalChunk { id: string; doc_id: string; chunk_index: number; text: string; context: string; source_sha256: string; start_offset: number; end_offset: number }
export interface ChallengeData { generated_at: string; properties: PropertyRecord[]; sources: SourceDocument[]; changeFixtures: ChangeFixture[]; verifiedRules: RuleRecord[]; knowledgeBaseChunks?: RetrievalChunk[]; knowledgeBaseAudit?: { provided_records: number; law_chunks: number; validated_chunks: number; rejected_chunks: number } }
export interface JurisdictionResolution {
  state: string; legal_city: string; verified: boolean; method: "census_geographies" | "tiger_boundary" | "manual_review";
  resolved_at: string; source_url: string; municipality_id?: string; note?: string;
}
export interface DomainContext {
  rules?: readonly RuleRecord[]; ruleLogic?: Record<string, RuleLogic>;
  jurisdictionResolutions?: Record<string, JurisdictionResolution>; propertyOverrides?: Record<string, FactRecord>;
  sources?: readonly SourceDocument[];
}
export interface EvidenceView { doc_id: string; source_url: string; citation: string; quoted_span: string; retrieved_at: string; sha256: string; start_offset: number; end_offset: number }
export interface EvaluatedRule {
  team_rule_id: string; rule: RuleRecord; result: LookupResult; explanation: string; conflict_flag: boolean;
  missing_facts: string[]; evidence: EvidenceView | null;
}
export interface PropertyEvaluation {
  property: PropertyRecord; as_of: string;
  jurisdiction: { state: string; city: string | null; candidate_city: string; verified: boolean; method: string };
  rules: EvaluatedRule[]; missing_facts: string[]; notices: string[]; coverage_complete: boolean; rule_count: number;
  input_snapshot: { facts: FactRecord; resolution: JurisdictionResolution | null };
}
export interface ChangeEvaluation {
  test_id: string; title: string; type: ChangeFixture["type"]; expected_behavior: string;
  expected_address_count: number; expected_conflict_count: number;
  evaluation_status: "not_evaluated" | "needs_review" | "evaluated";
  affected_address_ids: string[]; conflict_flag_address_ids: string[]; unresolved_address_ids: string[];
  missing_rule_ids: string[]; matched_rule_ids: string[]; notes: string; snapshots: { as_of: string; scenario: string; result_counts: Record<string, number> }[];
}
export interface ValidationIssue { path: string; message: string }
export interface BundleValidation { valid: boolean; errors: ValidationIssue[]; bundle: RuleBundle | null; warnings: string[] }
export interface Dashboard {
  property_count: number; source_count: number; captured_source_count: number; link_only_source_count: number;
  verified_rule_count: number; change_case_count: number; unresolved_jurisdiction_count: number;
  missing_year_count: number; missing_units_count: number; missing_zip_count: number;
  states: { state: string; property_count: number }[]; categories: readonly Category[]; default_as_of: string;
  notices: string[];
}
