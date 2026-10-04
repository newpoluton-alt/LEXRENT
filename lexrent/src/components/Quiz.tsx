import { useState } from "react";
import { useLang, type TKey } from "@/lib/i18n";
import { NUMERIC_FACTS, type FactKey, type Facts } from "@/lib/laws";

export function Quiz({ keys, onClose, onDone }: { keys: FactKey[]; onClose: () => void; onDone: (f: Facts) => void }) {
  const { t } = useLang();
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Facts>({});
  const [num, setNum] = useState("");
  const key = keys[i]!;
  const isNum = NUMERIC_FACTS.includes(key);
  const last = i === keys.length - 1;

  const advance = (val: Facts[FactKey] | undefined) => {
    const next = { ...answers, [key]: val };
    setAnswers(next);
    setNum("");
    if (last) onDone(next);
    else setI(i + 1);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg border-2 border-primary bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between text-xs uppercase">
          <span>{t("question")} {i + 1} {t("of")} {keys.length}</span>
          <button onClick={onClose} className="underline">{t("close")}</button>
        </div>
        <div className="mb-4 h-1.5 w-full bg-muted">
          <div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / keys.length) * 100}%` }} />
        </div>
        <h2 className="mb-2 text-sm font-semibold uppercase">{t("quizTitle")}</h2>
        <p className="mb-5 text-lg">{t(`q_${key}` as TKey)}</p>
        {isNum ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (num) advance(Number(num));
            }}
            className="flex gap-2"
          >
            <input
              autoFocus
              type="number"
              min={key === "yearBuilt" ? 1700 : 1}
              max={key === "yearBuilt" ? new Date().getFullYear() : 5000}
              value={num}
              onChange={(e) => setNum(e.target.value)}
              className="flex-1 border-2 border-primary bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
            />
            <button className="btn-primary" disabled={!num}>{last ? t("finish") : t("next")}</button>
          </form>
        ) : (
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => advance(true)}>{t("yes")}</button>
            <button className="btn-primary flex-1" onClick={() => advance(false)}>{t("no")}</button>
          </div>
        )}
        <div className="mt-4 flex justify-between text-sm">
          <button disabled={i === 0} onClick={() => setI(i - 1)} className="underline disabled:opacity-30">{t("back")}</button>
          <button onClick={() => advance(undefined)} className="underline">{t("notSure")}</button>
        </div>
      </div>
    </div>
  );
}
