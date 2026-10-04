import { safeParsePredicate } from "./validation";
import type { FactRecord, Predicate } from "./types";
export interface PredicateDecision { value: boolean | "unknown"; missing_facts: string[]; reasons: string[] }
const distinct = (items: string[]) => [...new Set(items)];
function visit(predicate: Predicate, facts: FactRecord): PredicateDecision {
  if ("all" in predicate || "any" in predicate) {
    const all = "all" in predicate;
    const children = (all ? predicate.all : (predicate as { any: Predicate[] }).any).map(child => visit(child, facts));
    if (children.some(child => child.value === !all)) return { value: !all, missing_facts: [], reasons: [] };
    if (children.some(child => child.value === "unknown")) return { value: "unknown", missing_facts: distinct(children.flatMap(child => child.missing_facts)), reasons: distinct(children.flatMap(child => child.reasons)) };
    return { value: all, missing_facts: [], reasons: [] };
  }
  if ("not" in predicate) { const child = visit(predicate.not, facts); return { ...child, value: child.value === "unknown" ? "unknown" : !child.value }; }
  const fact = Object.prototype.hasOwnProperty.call(facts, predicate.field) ? facts[predicate.field] : undefined;
  if (fact === null || fact === undefined) return { value: "unknown", missing_facts: [predicate.field], reasons: [`Missing ${predicate.field.replaceAll("_", " ")}.`] };
  const expected = predicate.value;
  if (predicate.op === "in") return { value: (expected as (string | number | boolean)[]).includes(fact), missing_facts: [], reasons: [] };
  if (typeof fact !== typeof expected) return { value: "unknown", missing_facts: [predicate.field], reasons: [`${predicate.field} has an incompatible data type.`] };
  let value: boolean;
  switch (predicate.op) {
    case "eq": value = fact === expected; break;
    case "neq": value = fact !== expected; break;
    case "lt": value = (fact as number) < (expected as number); break;
    case "lte": value = (fact as number) <= (expected as number); break;
    case "gt": value = (fact as number) > (expected as number); break;
    case "gte": value = (fact as number) >= (expected as number); break;
    default: return { value: "unknown", missing_facts: [], reasons: ["Unsupported comparator."] };
  }
  return { value, missing_facts: [], reasons: [] };
}
export function evaluatePredicate(input: unknown, facts: FactRecord): PredicateDecision {
  const parsed = safeParsePredicate(input);
  return parsed.success ? visit(parsed.data, facts) : { value: "unknown", missing_facts: ["executable_coverage"], reasons: ["Coverage must use the supported typed predicate format."] };
}
