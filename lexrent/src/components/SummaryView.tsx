import type { Building, Place } from "@/lib/geo";
import { CATEGORIES, CATEGORY_LABEL, EXTRAS, WEAK_SOURCE, sourceTypeOf, type Entry, type FactKey, type Facts, type Lang, type resolveLaws } from "@/lib/laws";
import { useLang } from "@/lib/i18n";
import { ConfidenceBadge, StatusBadge } from "@/components/Evidence";

type Res = ReturnType<typeof resolveLaws>;
type Props = {
  place: Place;
  date: string;
  facts: Facts;
  building: Building | null;
  res: Res;
  retrievedAt?: string;
  onEvidence: (id: string) => void;
};

const S = (lang: Lang, en: string, es: string) => (lang === "es" ? es : en);
const FACT: Record<FactKey, [string, string]> = {
  yearBuilt: ["construction year", "año de construcción"],
  units: ["number of units", "número de unidades"],
  ownerOccupied: ["owner occupancy", "ocupación por el dueño"],
  corporateOwner: ["owner type (corporate/REIT/LLC)", "tipo de dueño (corporación/REIT/LLC)"],
  subsidized: ["subsidy / federal mortgage status", "subsidio / hipoteca federal"],
  rentStabilized: ["rent-stabilization registration", "registro de renta estabilizada"],
  smallLandlord: ["landlord portfolio size", "tamaño de cartera del arrendador"],
};

function fmtDate(d: string, lang: Lang) {
  const dt = new Date(d + "T00:00:00");
  return isNaN(+dt) ? d : dt.toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SummaryView({ place, date, facts, building, res, retrievedAt, onEvidence }: Props) {
  const { lang, t } = useLang();
  if (!res) return null;
  const unknown = S(lang, "unknown", "desconocido");
  const use = building?.tags["building"];
  const city = place.city || place.district;
  const Cite = ({ e }: { e: Entry }) => (
    <button onClick={() => onEvidence(e.law.id)} className="text-left italic underline">[{e.law.lawNo}]</button>
  );
  const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 border-b border-foreground/20 pb-1 text-xl">{children}</h3>;
  const unknownEntries = res.active.filter((e) => e.status === "unknown");
  const weak = res.all.filter((e) => WEAK_SOURCE[sourceTypeOf(e.law)]);
  const lvl = (n: number) => res.jurisdictions.find((j) => j.level === n)?.names.join(", ");

  return (
    <section className="py-6">
      <h2 className="mb-2 text-3xl font-semibold uppercase">
        {t("summaryOf")} <span className="normal-case font-normal">{place.label}</span>
      </h2>
      <p className="mb-6 inline-block bg-accent px-3 py-1 text-sm font-semibold">
        {S(lang, "Rules as of", "Normas vigentes al")} {fmtDate(date, lang)}
      </p>

      <div className="space-y-8">
        <div>
          <H>{S(lang, "1. Building facts", "1. Datos del edificio")}</H>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="font-semibold">{S(lang, "Address", "Dirección")}</dt><dd>{place.label}</dd>
            <dt className="font-semibold">{S(lang, "State", "Estado")}</dt><dd>{place.state ?? unknown}</dd>
            <dt className="font-semibold">{S(lang, "County", "Condado")}</dt><dd>{place.county ?? unknown}</dd>
            <dt className="font-semibold">{S(lang, "Legal city", "Ciudad legal")}</dt>
            <dd>{lvl(2) || city || unknown}{city && lvl(2) && !lvl(2)!.includes(city) ? S(lang, ` (mailing city: ${city})`, ` (ciudad postal: ${city})`) : ""}</dd>
            <dt className="font-semibold">{S(lang, "Year built", "Año de construcción")}</dt><dd>{facts.yearBuilt ?? unknown}</dd>
            <dt className="font-semibold">{S(lang, "Units", "Unidades")}</dt><dd>{facts.units ?? unknown}</dd>
            <dt className="font-semibold">{S(lang, "Use code", "Código de uso")}</dt><dd>{use && use !== "yes" ? use : unknown}</dd>
          </dl>
        </div>

        <div>
          <H>{S(lang, "2. Rules by category", "2. Normas por categoría")}</H>
          <ul className="space-y-2 text-sm">
            {CATEGORIES.map((c) => {
              const e = res.top.find((x) => x.category === c)?.entry ?? res.all.find((x) => x.law.category === c);
              return (
                <li key={c} className="grid gap-2 md:grid-cols-[220px_150px_1fr]">
                  <strong>{CATEGORY_LABEL[c][lang]}</strong>
                  <span>{e ? <StatusBadge s={e.status} /> : <StatusBadge s="unknown" />}</span>
                  <span>
                    {e ? <>{e.law.title[lang]} — {e.law.desc[lang]} <Cite e={e} /></> : S(lang, "No rule found in the corpus for this address.", "No se encontró ninguna norma para esta dirección.")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <H>{S(lang, "3. Upcoming changes", "3. Cambios próximos")}</H>
          {res.future.length === 0 && res.proposals.length === 0 ? (
            <p className="text-sm">{S(lang, "None found.", "Ninguno encontrado.")}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {res.future.map((f) => {
                const e = res.all.find((x) => x.law.id === f.law.id);
                return (
                  <li key={f.law.id}>
                    {f.law.title[lang]} — {f.kind === "starts" ? S(lang, "applies", "aplica desde") : S(lang, "ends", "termina")} {fmtDate(f.on, lang)} {e && <Cite e={e} />}
                  </li>
                );
              })}
              {res.proposals.map((e) => (
                <li key={e.law.id}>
                  <StatusBadge s={e.status} /> {e.law.title[lang]} <Cite e={e} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <H>{S(lang, "4. Missing information", "4. Información faltante")}</H>
          {unknownEntries.length === 0 ? (
            <p className="text-sm">{S(lang, "No rule depends on missing facts.", "Ninguna norma depende de datos faltantes.")}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {unknownEntries.map((e) => {
                const miss = (e.law.needs ?? []).filter((k) => facts[k] === undefined).map((k) => FACT[k][lang === "es" ? 1 : 0]);
                return (
                  <li key={e.law.id}>
                    <strong>{e.law.title[lang]}</strong>: {S(lang, "Unknown because the", "Desconocido porque falta")} {miss.join(", ")} {S(lang, miss.length > 1 ? "are missing." : "is missing.", ".")} <Cite e={e} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <H>{S(lang, "5. Conflicts and source warnings", "5. Conflictos y advertencias de fuente")}</H>
          {res.conflicts.length === 0 && weak.length === 0 && <p className="text-sm">{S(lang, "None found.", "Ninguno encontrado.")}</p>}
          <ul className="space-y-2 text-sm">
            {res.conflicts.map((c, i) => (
              <li key={i} className="border-2 border-destructive p-2">
                <strong className="text-destructive">{S(lang, "Needs human review", "Requiere revisión humana")}:</strong>{" "}
                <button className="underline" onClick={() => onEvidence(c.a.id)}>{c.a.title[lang]}</button> vs{" "}
                <button className="underline" onClick={() => onEvidence(c.b.id)}>{c.b.title[lang]}</button>. {c.note[lang]}
              </li>
            ))}
            {weak.map((e) => (
              <li key={e.law.id} className="border-l-4 border-accent pl-2">
                ⚠ {e.law.title[lang]}: {WEAK_SOURCE[sourceTypeOf(e.law)]![lang]} <Cite e={e} />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <H>{S(lang, "6. Confidence and audit", "6. Confianza y auditoría")}</H>
          <p className="mb-2 flex items-center gap-2 text-sm">
            {S(lang, "Overall confidence", "Confianza general")}:{" "}
            <ConfidenceBadge c={res.overall >= 0.75 ? "high" : res.overall >= 0.5 ? "medium" : "low"} score={res.overall} />
          </p>
          <ul className="space-y-1 text-sm">
            {res.active.filter((e) => e.status !== "notApplicable").map((e) => (
              <li key={e.law.id} className="flex flex-wrap items-center gap-2">
                <ConfidenceBadge c={e.confidence} score={e.score} />
                <span>{e.law.title[lang]}</span>
                <span className="opacity-70">— {e.law.source.name}{EXTRAS[e.law.id]?.quote ? "" : S(lang, " (no quoted text)", " (sin cita textual)")}</span>
                <button className="underline" onClick={() => onEvidence(e.law.id)}>{S(lang, "Audit view", "Vista de auditoría")}</button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-70">
            {S(lang, "As-of date", "Fecha de consulta")}: {date}
            {retrievedAt ? ` · ${S(lang, "Retrieved", "Consultado")}: ${retrievedAt}` : ""}
          </p>
        </div>

        <p className="bg-accent px-3 py-2 text-sm font-semibold">
          {S(lang, "Not legal advice. Verify with the official source or a lawyer.", "No es asesoría legal. Verifique con la fuente oficial o un abogado.")}
        </p>
      </div>
    </section>
  );
}
