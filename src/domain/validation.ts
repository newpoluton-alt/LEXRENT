import { z } from "zod";
import { CATEGORIES, FACT_FIELDS, type Predicate, type RuleBundle, type RuleRecord, type RuleLogic, type SourceDocument, type BundleValidation, type ValidationIssue } from "./types";

export const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const queryDateSchema = z.string().refine(isValidDate, "Use a real calendar date in YYYY-MM-DD format.");
const partialDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).refine(value => value.length === 4 ? Number(value) >= 1 : value.length === 7 ? isValidDate(`${value}-01`) : isValidDate(value));
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
export const predicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.object({ all: z.array(predicateSchema).max(100) }).strict(),
  z.object({ any: z.array(predicateSchema).max(100) }).strict(),
  z.object({ not: predicateSchema }).strict(),
  z.object({ field: z.enum(FACT_FIELDS), op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "in"]), value: z.union([scalar, z.array(scalar).min(1).max(100)]) }).strict().superRefine((predicate, ctx) => {
    if ((predicate.op === "in") !== Array.isArray(predicate.value)) ctx.addIssue({ code: "custom", message: "Only the in comparator takes an array." });
    const numeric = ["year_built", "units", "certificate_age_years", "owner_total_properties", "owner_total_units", "tenancy_months"].includes(predicate.field);
    const boolean = ["owner_occupied", "construction_exemption_filed", "is_subsidized", "is_single_family", "residential_use"].includes(predicate.field);
    const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
    const type = numeric ? "number" : boolean ? "boolean" : "string";
    if (values.some(value => typeof value !== type)) ctx.addIssue({ code: "custom", message: `Values for ${predicate.field} must be ${type}.` });
    if (["lt", "lte", "gt", "gte"].includes(predicate.op) && !numeric && predicate.field !== "certificate_of_occupancy_date") ctx.addIssue({ code: "custom", message: "Ordered comparisons require a numeric fact or certificate date." });
    if (predicate.field === "certificate_of_occupancy_date" && values.some(value => typeof value !== "string" || !isValidDate(value))) ctx.addIssue({ code: "custom", message: "Certificate dates must be complete valid calendar dates." });
  }),
]));

export const ruleRecordSchema = z.object({
  team_rule_id: z.string().min(1).max(160), jurisdiction: z.string().min(2), level: z.enum(["state", "city"]), category: z.enum(CATEGORIES),
  status: z.enum(["in_force", "not_yet_effective", "pending", "failed"]), title: z.string().min(1), requirement: z.string().min(1),
  citation: z.string().min(1), source_url: z.url(), quoted_span: z.string().min(20),
  key_value: z.string().nullable().optional(), coverage_conditions: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
  exemptions: z.string().nullable().optional(), overrides: z.array(z.string()).optional(), interaction: z.string().nullable().optional(),
  effective_date: partialDate.nullable().optional(), source_doc_id: z.string().nullable().optional(), confidence: z.number().min(0).max(1).nullable().optional(),
  conflict_flag: z.boolean().optional(), conflict_note: z.string().nullable().optional(),
}).passthrough();
export const ruleLogicSchema: z.ZodType<RuleLogic> = z.object({
  coverage: predicateSchema,
  lifecycle: z.object({ enacted_on: queryDateSchema.nullable().optional(), effective_on: queryDateSchema.nullable().optional(), failed_on: queryDateSchema.nullable().optional(), repealed_on: queryDateSchema.nullable().optional() }).strict().optional(),
  supersedes: z.array(z.string()).optional(), conflicts_with: z.array(z.string()).optional(), fixture_rule_ids: z.array(z.string()).optional(),
}).strict();
export const ruleBundleSchema = z.object({ rules: z.array(ruleRecordSchema).max(5000), ruleLogic: z.record(z.string(), ruleLogicSchema).default({}) }).strict();

function predicateDepth(input: unknown, depth = 0): number {
  if (depth > 25) return depth;
  if (!input || typeof input !== "object") return depth;
  const value = input as Record<string, unknown>;
  if (Array.isArray(value.all) || Array.isArray(value.any)) return Math.max(depth, ...(value.all as unknown[] ?? value.any as unknown[]).map(child => predicateDepth(child, depth + 1)));
  if ("not" in value) return predicateDepth(value.not, depth + 1);
  return depth;
}

export function safeParsePredicate(input: unknown) {
  if (predicateDepth(input) > 25) return { success: false as const, error: new z.ZodError([{ code: "custom", path: [], message: "Predicate nesting exceeds 25 levels." }]) };
  return predicateSchema.safeParse(input);
}

export function validateRuleBundle(input: unknown, sources: readonly SourceDocument[]): BundleValidation {
  const normalized = Array.isArray(input) ? { rules: input, ruleLogic: {} } : input;
  const errors: ValidationIssue[] = [], warnings: string[] = [];
  if (normalized && typeof normalized === "object") {
    const logic = (normalized as { ruleLogic?: Record<string, unknown> }).ruleLogic;
    if (logic) for (const [id, value] of Object.entries(logic)) if (predicateDepth((value as { coverage?: unknown })?.coverage) > 25) errors.push({ path: `ruleLogic.${id}.coverage`, message: "Predicate nesting exceeds 25 levels." });
  }
  if (errors.length) return { valid: false, errors, warnings, bundle: null };
  const parsed = ruleBundleSchema.safeParse(normalized);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })), warnings, bundle: null };
  const bundle = parsed.data as RuleBundle;
  const ids = new Set<string>();
  bundle.rules.forEach((rule, index) => {
    const path = `rules.${index}`;
    if (ids.has(rule.team_rule_id)) errors.push({ path: `${path}.team_rule_id`, message: "Rule IDs must be unique within a bundle." });
    ids.add(rule.team_rule_id);
    const candidates = sources.filter(source => rule.source_doc_id ? source.doc_id === rule.source_doc_id : source.url === rule.source_url);
    const source = candidates.find(source => source.url === rule.source_url && source.captured && source.text?.includes(rule.quoted_span)) ?? candidates[0];
    if (!source) errors.push({ path: `${path}.source_doc_id`, message: "Source must identify a known captured document." });
    else {
      if (source.url !== rule.source_url) errors.push({ path: `${path}.source_url`, message: "Source URL does not match the referenced source document." });
      if (!source.captured || !source.text) errors.push({ path: `${path}.quoted_span`, message: "This source has no captured text; a link alone cannot validate evidence." });
      else if (!source.text.includes(rule.quoted_span)) errors.push({ path: `${path}.quoted_span`, message: "Quoted span must occur verbatim in the captured source." });
      if (!rule.source_doc_id) rule.source_doc_id = source.doc_id;
    }
    if (rule.level === "state" && !/^[A-Z]{2}$/.test(rule.jurisdiction)) errors.push({ path: `${path}.jurisdiction`, message: "State jurisdiction must be a two-letter state code." });
    if (rule.level === "city" && !/^.+, [A-Z]{2}$/.test(rule.jurisdiction)) errors.push({ path: `${path}.jurisdiction`, message: "City jurisdiction must use City, ST." });
    if (!bundle.ruleLogic[rule.team_rule_id]) {
      const embedded = predicateSchema.safeParse(rule.coverage_conditions);
      if (embedded.success) bundle.ruleLogic[rule.team_rule_id] = { coverage: embedded.data };
      else warnings.push(`${rule.team_rule_id}: coverage is not executable; matching returns unknown.`);
    }
    if (rule.exemptions && !bundle.ruleLogic[rule.team_rule_id]) warnings.push(`${rule.team_rule_id}: exemption coverage needs review.`);
    const lifecycle = bundle.ruleLogic[rule.team_rule_id]?.lifecycle;
    if (lifecycle?.enacted_on && lifecycle.effective_on && lifecycle.effective_on < lifecycle.enacted_on) errors.push({ path: `ruleLogic.${rule.team_rule_id}.lifecycle`, message: "Effective date cannot precede enactment." });
    if (lifecycle?.effective_on && rule.effective_date && !lifecycle.effective_on.startsWith(rule.effective_date)) errors.push({ path: `ruleLogic.${rule.team_rule_id}.lifecycle.effective_on`, message: "Lifecycle effective date disagrees with the rule record." });
  });
  for (const [id, logic] of Object.entries(bundle.ruleLogic)) {
    if (!ids.has(id)) errors.push({ path: `ruleLogic.${id}`, message: "Logic references a rule missing from this bundle." });
    for (const target of [...(logic.supersedes ?? []), ...(logic.conflicts_with ?? [])]) if (!ids.has(target) || target === id) errors.push({ path: `ruleLogic.${id}`, message: `Interaction references an invalid rule: ${target}.` });
  }
  for (const rule of bundle.rules) for (const target of rule.overrides ?? []) if (!ids.has(target) || target === rule.team_rule_id) errors.push({ path: `rules.${rule.team_rule_id}.overrides`, message: `Invalid interaction reference: ${target}.` });
  const colors = new Map<string, number>();
  for (const root of ids) {
    if (colors.get(root)) continue;
    const stack = [{ id: root, next: 0 }];
    colors.set(root, 1);
    while (stack.length) {
      const current = stack.at(-1)!;
      const targets = bundle.ruleLogic[current.id]?.supersedes ?? [];
      if (current.next >= targets.length) { colors.set(current.id, 2); stack.pop(); continue; }
      const target = targets[current.next++];
      if (!ids.has(target)) continue;
      if (colors.get(target) === 1) errors.push({ path: `ruleLogic.${current.id}.supersedes`, message: "Supersession cycle detected; precedence must have an unambiguous direction." });
      else if (!colors.get(target)) { colors.set(target, 1); stack.push({ id: target, next: 0 }); }
    }
  }
  return { valid: errors.length === 0, errors, warnings, bundle: errors.length === 0 ? bundle : null };
}

export function sourceForRule(rule: RuleRecord, sources: readonly SourceDocument[]) {
  const candidates = sources.filter(source => source.url === rule.source_url && (!rule.source_doc_id || source.doc_id === rule.source_doc_id));
  return candidates.find(source => source.captured && source.text?.includes(rule.quoted_span)) ?? candidates[0];
}
