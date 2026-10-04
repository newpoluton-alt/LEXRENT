import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { useLang } from "@/lib/i18n";
import { useState } from "react";
import { CATEGORIES, CATEGORY_LABEL, LAWS } from "@/lib/laws";
import { STATES } from "@/lib/geo";

export const Route = createFileRoute("/rights")({
  head: () => ({
    meta: [
      { title: "Learn your rights — LexRent" },
      { name: "description", content: "Plain-language guide to six areas of US rental law: rent limits, eviction, deposits, fees, screening and algorithmic pricing." },
      { property: "og:title", content: "Learn your tenant rights — LexRent" },
      { property: "og:description", content: "Six areas of rental law explained in plain language." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Rights,
});

const TEXT = {
  rent: ["Some states and cities cap how much rent can rise each year, often tied to inflation and building age.", "Algunos estados y ciudades limitan cuánto puede subir la renta cada año, según la inflación y la edad del edificio."],
  eviction: ["Just-cause laws mean a landlord needs a valid reason, like nonpayment, to end your tenancy.", "Las leyes de causa justificada exigen una razón válida, como falta de pago, para terminar el contrato."],
  deposit: ["Many places limit deposits and set deadlines for returning them with an itemized list.", "Muchos lugares limitan los depósitos y fijan plazos para devolverlos con lista detallada."],
  fees: ["Application and screening fees are often capped at the real cost of a background check.", "Las tarifas de solicitud suelen limitarse al costo real de la verificación."],
  screening: ["Laws restrict using criminal records, eviction history or income source to deny you.", "Las leyes restringen el uso de antecedentes penales, historial de desalojo o fuente de ingresos para rechazarle."],
  algorithmic: ["New laws ban landlords from using software that coordinates rents with competitors.", "Nuevas leyes prohíben usar software que coordine rentas entre competidores."],
} as const;

function Rights() {
  const { lang, t } = useLang();
  const es = lang === "es";
  const [state, setState] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const lawsFor = (c: string) =>
    LAWS.filter((l) => l.category === c && l.level < 2 && (l.stage ?? "enacted") === "enacted" && l.effective <= today && (!l.sunset || l.sunset > today) && l.match({ stateCode: state } as never))
      .sort((a, b) => b.level - a.level);
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="section-title mb-8 text-3xl">{t("rights")}</h1>
        <label className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="font-semibold">{es ? "Elija un estado:" : "Choose a state:"}</span>
          <select value={state} onChange={(e) => setState(e.target.value)} className="border-2 border-primary bg-card px-3 py-2 font-semibold text-primary">
            <option value="">{es ? "— Seleccionar estado —" : "— Select state —"}</option>
            {Object.entries(STATES).map(([n, c]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
        <div className="space-y-6">
          {CATEGORIES.map((c) => (
            <div key={c} className="border-l-4 border-accent pl-4">
              <h2 className="text-xl font-semibold">{CATEGORY_LABEL[c][lang]}</h2>
              <p className="mt-1">{TEXT[c][lang === "es" ? 1 : 0]}</p>
              {state && (() => {
                const ls = lawsFor(c);
                const hasState = ls.some((l) => l.level === 1);
                return (
                  <ul className="mt-3 space-y-2">
                    {!hasState && <li className="text-sm italic text-muted-foreground">{es ? "No se encontró ley estatal en esta categoría; solo aplica la ley federal (puede haber reglas locales)." : "No state law found in this category; only federal law applies (local rules may exist)."}</li>}
                    {ls.map((l) => (
                      <li key={l.id} className="border border-border bg-card p-3">
                        <div className="text-xs font-semibold uppercase text-primary">{l.jurisdiction} · {l.lawNo}</div>
                        <div className="font-semibold">{l.title[lang]}</div>
                        <p className="text-sm">{l.desc[lang]}</p>
                        <a href={l.source.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">{l.source.name}</a>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
