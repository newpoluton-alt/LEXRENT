import { sources, challengeData, validateRuleBundle, type DomainContext, type JurisdictionResolution, type RuleLogic, type RuleRecord } from "@/domain";
import { DatabaseError, getJurisdictionResolutions, isDatabaseConfigured, getLatestRuleBundle, listSourceCaptures } from "./db";

/** An immutable rule version is selected once for each request. Never invent rules on a database failure. */
export async function loadContext(options: { allowEvidenceRepair?: boolean } = {}): Promise<{ context: DomainContext; bundleId: string | null; createdAt: string | null; evidenceNeedsReview?: boolean }> {
  const baseline: DomainContext = { rules: challengeData.verifiedRules, ruleLogic: challengeData.ruleLogic ?? {}, sources, jurisdictionResolutions: challengeData.jurisdictionResolutions ?? {} };
  if (!isDatabaseConfigured()) return { context: baseline, bundleId: null, createdAt: challengeData.generated_at };
  const [current, captures, resolutions] = await Promise.all([getLatestRuleBundle(), listSourceCaptures(), getJurisdictionResolutions()]);
  const documents = sources.map(source => {
    const capture = captures.find(item => item.docId === source.doc_id && item.source_url === source.url);
    return capture ? { ...source, captured: true, text: capture.text, sha256: capture.hash, retrieved_at: capture.retrieved_at, status: "captured" } : source;
  });
  const metadata = current?.metadata as { ruleLogic?: Record<string, RuleLogic> } | undefined;
  const candidate = current ? { rules: current.rules, ruleLogic: metadata?.ruleLogic ?? {} } : { rules: baseline.rules, ruleLogic: baseline.ruleLogic };
  const checked = validateRuleBundle(candidate, documents);
  if (checked && !checked.valid && !options.allowEvidenceRepair) throw new DatabaseError("DATABASE_UNAVAILABLE", "The current rule version needs evidence review after a source update. Import a validated version before evaluating it.", 503);
  return {
    context: { rules: checked?.bundle?.rules ?? (options.allowEvidenceRepair ? current?.rules as RuleRecord[] ?? baseline.rules : []), ruleLogic: checked?.bundle?.ruleLogic ?? (options.allowEvidenceRepair ? metadata?.ruleLogic ?? baseline.ruleLogic : {}), sources: documents, jurisdictionResolutions: { ...baseline.jurisdictionResolutions, ...resolutions as Record<string, JurisdictionResolution> } },
    bundleId: current?.id ?? null, createdAt: current?.createdAt ?? challengeData.generated_at,
    evidenceNeedsReview: !!checked && !checked.valid,
  };
}
