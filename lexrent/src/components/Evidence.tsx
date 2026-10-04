import { useLang, type TKey } from "@/lib/i18n";
import { CATEGORY_LABEL, EXTRAS, WEAK_SOURCE, reasoning, sourceTypeOf, type Confidence, type Entry, type Facts, type Status } from "@/lib/laws";
import type { Place } from "@/lib/geo";

export function StatusBadge({ s }: { s: Status }) {
  const { t } = useLang();
  const cls: Record<Status, string> = {
    applicable: "bg-primary text-primary-foreground",
    unknown: "bg-accent text-accent-foreground",
    notYetEffective: "border border-primary bg-card",
    pending: "border border-dashed border-primary bg-card",
    failed: "bg-muted line-through",
    notApplicable: "bg-muted text-muted-foreground",
  };
  return <span className={`inline-block whitespace-nowrap px-2 py-0.5 text-xs ${cls[s]}`}>{t(s as TKey)}</span>;
}

export function ConfidenceBadge({ c, score }: { c: Confidence; score?: number }) {
  const { t } = useLang();
  const bars = c === "high" ? 3 : c === "medium" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1 text-xs" title={score !== undefined ? `${Math.round(score * 100)}%` : undefined}>
      <span className="flex items-end gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-1 ${i <= bars ? (c === "low" ? "bg-destructive" : c === "medium" ? "bg-accent" : "bg-primary") : "bg-muted"}`} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {t(c)}
    </span>
  );
}

export function EvidenceModal({ entry, place, date, facts, retrievedAt, onClose }: {
  entry: Entry; place: Place; date: string; facts: Facts; retrievedAt: string; onClose: () => void;
}) {
  const { t, lang } = useLang();
  const l = entry.law;
  const quote = EXTRAS[l.id]?.quote;
  const weak = WEAK_SOURCE[sourceTypeOf(l)];
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label={t("evidence")} className="max-h-[90vh] w-full max-w-2xl overflow-auto border-2 border-primary bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase opacity-70">{t("evidence")} · {CATEGORY_LABEL[l.category][lang]} · {l.jurisdiction}</div>
            <h2 className="text-xl font-semibold">{l.title[lang]}</h2>
            <div className="text-sm">{l.lawNo}</div>
          </div>
          <button onClick={onClose} className="text-sm underline">{t("close")}</button>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StatusBadge s={entry.status} />
          <ConfidenceBadge c={entry.confidence} score={entry.score} />
          {entry.conflict && <span className="bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">⚠ {t("humanReview")}</span>}
        </div>
        {weak && (
          <div className="mb-4 border-l-4 border-destructive bg-muted p-3 text-sm">
            <strong>{t("weakSource")}:</strong> {weak[lang]}
          </div>
        )}
        <h3 className="text-sm font-semibold uppercase">{t("quote")}</h3>
        {quote ? (
          <>
            <blockquote className="mt-1 border-l-4 border-primary bg-background p-3 text-sm italic">"{quote}"</blockquote>
            <p className="mt-1 text-xs opacity-70">{t("verifyQuote")}</p>
          </>
        ) : (
          <p className="mt-1 border-l-4 border-accent bg-background p-3 text-sm">{t("noQuote")}</p>
        )}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-semibold">{t("source")}</dt>
          <dd><a href={l.source.url} target="_blank" rel="noreferrer" className="underline">{l.source.name}</a></dd>
          <dt className="font-semibold">{t("retrievedAt")}</dt><dd>{retrievedAt}</dd>
          <dt className="font-semibold">{t("asOf")}</dt><dd>{date}</dd>
        </dl>
        <h3 className="mt-4 text-sm font-semibold uppercase">{t("reasoningH")}</h3>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
          {reasoning(entry, place, date, facts, lang).map((r, i) => <li key={i}>{r}</li>)}
        </ol>
      </div>
    </div>
  );
}
