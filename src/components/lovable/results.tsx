"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Category, EvaluatedRule, PropertyEvaluation } from "@/domain/types";
import { useLang } from "./language";

const CATEGORIES: Category[] = ["rent_increase_limits", "just_cause_eviction", "security_deposits", "application_screening_fees", "screening_restrictions", "algorithmic_rent_setting"];
const CATEGORY_LABELS: Record<Category, [string, string]> = {
  rent_increase_limits: ["Rent increase limits", "Límites al aumento de renta"],
  just_cause_eviction: ["Just-cause eviction", "Desalojo con causa justificada"],
  security_deposits: ["Security deposits", "Depósitos de garantía"],
  application_screening_fees: ["Application & screening fees", "Tarifas de solicitud y evaluación"],
  screening_restrictions: ["Screening restrictions", "Restricciones de evaluación"],
  algorithmic_rent_setting: ["Algorithmic rent setting", "Fijación algorítmica de renta"],
};
const FACT_LABELS: Record<string, [string, string]> = {
  year_built: ["Year built", "Año de construcción"], units: ["Number of units", "Número de unidades"],
  certificate_of_occupancy_date: ["Certificate-of-occupancy date", "Fecha del certificado de ocupación"],
  certificate_age_years: ["Completed certificate anniversaries", "Aniversarios completos del certificado"],
  owner_type: ["Owner type", "Tipo de propietario"], owner_occupied: ["Owner occupancy", "Ocupación por el propietario"],
  owner_total_properties: ["Owner's total properties", "Número total de propiedades del propietario"],
  owner_total_units: ["Owner's total units", "Número total de unidades del propietario"],
  tenancy_months: ["Tenancy in months", "Meses de arrendamiento"],
  all_tenants_12_months: ["All tenants have occupied for 12 months", "Todos los inquilinos llevan 12 meses"],
  construction_exemption_filed: ["Construction exemption filing", "Registro de exención de construcción"],
  is_subsidized: ["Subsidized housing", "Vivienda subsidiada"], is_single_family: ["Single-family property", "Vivienda unifamiliar"],
  residential_use: ["Residential use", "Uso residencial"], state: ["State", "Estado"], legal_city: ["Legal municipality", "Municipio legal"],
  legal_municipality: ["Verified legal municipality", "Municipio legal verificado"], verified_source_evidence: ["Validated source evidence", "Evidencia de fuente validada"],
  affordable_housing_restricted: ["Recorded affordability restriction", "Restricción de asequibilidad registrada"],
  special_housing_exempt: ["Reviewed special-housing exemption", "Exención de vivienda especial revisada"],
  separately_alienable: ["Separately transferable title", "Título transferible por separado"],
  exemption_notice_provided: ["Required exemption notice documented", "Aviso de exención requerido documentado"],
  owner_llc_has_corporate_member: ["LLC has a corporate member", "La LLC tiene un miembro corporativo"],
  shares_kitchen_or_bath_with_owner: ["Kitchen or bathroom shared with owner", "Cocina o baño compartido con el propietario"],
  city_rent_controlled: ["Reviewed city rent-control coverage", "Cobertura municipal de control de renta revisada"],
  city_eviction_covered: ["Reviewed city eviction-rule coverage", "Cobertura municipal de desalojo revisada"],
  city_fair_chance_covered: ["Reviewed city fair-chance coverage", "Cobertura municipal de oportunidades justas revisada"],
  vacation_or_recreational_lease_100_days_or_less: ["Vacation or recreational lease of 100 days or less", "Alquiler vacacional o recreativo de 100 días o menos"],
  seasonal_or_transient_tenancy: ["Reviewed seasonal or transient tenancy", "Alquiler estacional o transitorio revisado"],
  family_trust_disability_unit: ["Reviewed family-trust disability-unit exception", "Excepción de unidad por discapacidad en fideicomiso familiar revisada"],
  security_deposit_law_invoked_30_days: ["Deposit-law written request effective", "Solicitud escrita de la ley de depósitos efectiva"],
  boston_fair_chance_program: ["Boston fair-chance program participation", "Participación en el programa de oportunidades justas de Boston"],
  cambridge_notification_exempt: ["Reviewed Cambridge notification exemption", "Exención de notificación de Cambridge revisada"],
  tenancy_at_will: ["Tenancy at will", "Alquiler a voluntad"],
};
const STATUS: Record<string, { label: [string, string]; style: string }> = {
  applies: { label: ["Applies", "Aplica"], style: "bg-primary text-primary-foreground" },
  in_force: { label: ["In force", "En vigor"], style: "bg-primary text-primary-foreground" },
  unknown: { label: ["Unknown", "Desconocido"], style: "bg-accent text-accent-foreground" },
  superseded: { label: ["Superseded", "Reemplazado"], style: "border border-primary bg-muted text-foreground" },
  not_yet_effective: { label: ["Not yet effective", "Aún no vigente"], style: "border border-primary bg-card" },
  pending: { label: ["Pending", "Pendiente"], style: "border border-dashed border-primary bg-card" },
  failed: { label: ["Failed", "No aprobado"], style: "bg-muted text-muted-foreground line-through" },
};

function sourceHref(value: string | undefined) {
  try { const url = new URL(value ?? ""); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function factLabel(field: string, pick: (en: string, es: string) => string) {
  const label = FACT_LABELS[field]; return label ? pick(...label) : field.replaceAll("_", " ");
}
function factValue(value: unknown, pick: (en: string, es: string) => string) {
  if (value === null || value === undefined || value === "") return pick("Unknown", "Desconocido");
  return typeof value === "boolean" ? pick(value ? "Yes" : "No", value ? "Sí" : "No") : String(value);
}
function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 border-b border-foreground/20 pb-1 text-xl">{children}</h3>;
}
function EmptyCoverage() {
  const { pick } = useLang();
  return <p className="text-sm italic opacity-80">{pick("Reviewed coverage is unavailable for this category. An empty result does not establish that no law applies.", "La cobertura revisada no está disponible en esta categoría. Un resultado vacío no significa que no se aplique ninguna ley.")}</p>;
}
function RequirementList({ entries, category, limit = 3, render }: { entries: EvaluatedRule[]; category: Category; limit?: number; render: (entry: EvaluatedRule) => ReactNode }) {
  const { pick } = useLang();
  const remaining = entries.slice(limit);
  const reviewCount = entries.filter(entry => entry.conflict_flag).length;
  return <div>
    <p className="mb-2 text-xs opacity-80">{entries.length} {pick("recorded requirements", "requisitos registrados")} · {entries.filter(entry => entry.result === "unknown").length} {pick("unknown", "desconocidos")}{reviewCount > 0 && <> · <strong>{reviewCount} {pick("need human review", "requieren revisión humana")}</strong></>}</p>
    <ul className="space-y-3">{entries.slice(0, limit).map(render)}</ul>
    {remaining.length > 0 && <details className="mt-3 border-t border-current/20 pt-2 print:contents">
      <summary className="cursor-pointer text-xs font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current print:hidden">{pick(`Show ${remaining.length} more requirements`, `Mostrar ${remaining.length} requisitos más`)} <span className="sr-only">— {pick(...CATEGORY_LABELS[category])}</span></summary>
      <ul className="mt-3 space-y-3 print:block">{remaining.map(render)}</ul>
    </details>}
  </div>;
}

export function LookupDataStatus({ evaluation }: { evaluation: PropertyEvaluation }) {
  const { pick } = useLang();
  const gaps = [...new Set(evaluation.missing_facts)];
  const factGaps = gaps.filter(field => Object.hasOwn(FACT_LABELS, field) && !["legal_municipality", "verified_source_evidence"].includes(field));
  const reviewGaps = gaps.filter(field => !factGaps.includes(field));
  const applies = evaluation.rules.filter(entry => entry.result === "applies").length;
  const unknown = evaluation.rules.filter(entry => entry.result === "unknown").length;
  return <div className="border-2 border-primary bg-card p-4 text-sm" aria-label={pick("Law records and information gaps", "Normas registradas y datos faltantes")}>
    <dl className="grid gap-3 sm:grid-cols-3">
      <div><dt className="text-xs uppercase text-muted-foreground">{pick("Recorded requirements returned", "Requisitos registrados devueltos")}</dt><dd className="mt-1 text-xl font-semibold text-primary">{evaluation.rules.length}</dd><p className="mt-1 text-xs">{applies} {pick("apply", "aplican")} · {unknown} {pick("unknown", "desconocidos")}</p></div>
      <div><dt className="text-xs uppercase text-muted-foreground">{pick("Property or tenancy facts still needed", "Datos de propiedad o alquiler pendientes")}</dt><dd className="mt-1 text-xl font-semibold text-primary">{factGaps.length}</dd><p className="mt-1 text-xs">{pick("Missing facts can leave a recorded rule's result unknown.", "Los datos faltantes pueden dejar desconocido el resultado de una norma registrada.")}</p></div>
      <div><dt className="text-xs uppercase text-muted-foreground">{pick("Jurisdiction or evidence items still needed", "Datos de jurisdicción o evidencia pendientes")}</dt><dd className="mt-1 text-xl font-semibold text-primary">{reviewGaps.length}</dd><p className="mt-1 text-xs">{pick("These gaps require source or boundary review.", "Estos datos requieren revisar fuentes o límites territoriales.")}</p></div>
    </dl>
    <p className="mt-3 border-t border-primary/20 pt-3 text-xs text-muted-foreground">{evaluation.rules.length ? pick("Recorded rules and missing facts are separate. This lookup does not establish complete legal coverage; a zero in a gap count does not prove that every applicable law has been reviewed.", "Las normas registradas y los datos faltantes son distintos. Esta consulta no establece una cobertura legal completa; un cero en los datos pendientes no demuestra que se hayan revisado todas las leyes aplicables.") : pick("No reviewed requirements were returned for this address and date. This does not mean that no law applies. Property facts and gaps in the reviewed source inventory are separate.", "No se devolvieron requisitos revisados para esta dirección y fecha. Esto no significa que no se aplique ninguna ley. Los datos de la propiedad y las limitaciones del inventario de fuentes revisadas son distintos.")}</p>
  </div>;
}
function ReviewedConfidence({ entry }: { entry: EvaluatedRule }) {
  const { pick, lang } = useLang();
  const value = entry.rule.confidence;
  return <span className="text-xs" title={pick("Recorded confidence in the reviewed rule; not a probability that it applies to this property.", "Confianza registrada en la norma revisada; no es la probabilidad de que se aplique a esta propiedad.")}>
    {typeof value === "number" && Number.isFinite(value) ? pick("Reviewed rule confidence: ", "Confianza en la norma revisada: ") + new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(value) : pick("Confidence not provided", "Confianza no proporcionada")}
  </span>;
}

export function RuleStatus({ value }: { value: string }) {
  const { pick } = useLang(); const status = STATUS[value];
  return <span className={"inline-block whitespace-nowrap px-2 py-0.5 text-xs " + (status?.style ?? "border border-primary bg-card")}>{status ? pick(...status.label) : value}</span>;
}

export function EvidenceDialog({ entry, asOf, onClose }: { entry: EvaluatedRule; asOf: string; onClose: () => void }) {
  const { pick } = useLang();
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  const { rule, evidence } = entry;
  useEffect(() => {
    const element = dialog.current, previousFocus = document.activeElement, overflow = document.body.style.overflow;
    if (!element) return;
    element.showModal(); document.body.style.overflow = "hidden"; closeButton.current?.focus();
    return () => { element.close(); document.body.style.overflow = overflow; if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  const source = sourceHref(evidence?.source_url ?? rule.source_url);
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} aria-modal="true"
    className="fixed inset-0 m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-2xl overflow-auto border-2 border-primary bg-card p-0 text-foreground backdrop:bg-foreground/40"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }}>
    <div className="p-6">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase opacity-70">{pick("Evidence", "Evidencia")} · {pick(...CATEGORY_LABELS[rule.category])} · {rule.jurisdiction}</div>
          <h2 id={titleId} className="text-xl font-semibold">{rule.title}</h2>
          <div className="text-sm">{rule.citation}</div>
        </div>
        <button ref={closeButton} type="button" onClick={onClose} className="shrink-0 text-sm underline">{pick("Close", "Cerrar")}</button>
      </div>
      <p id={descriptionId} className="mb-4 text-sm">{rule.requirement}</p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RuleStatus value={entry.result} /><ReviewedConfidence entry={entry} />
        {entry.conflict_flag && <span className="bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">{pick("Needs human review", "Requiere revisión humana")}</span>}
      </div>
      <h3 className="text-sm font-semibold uppercase">{pick("Quoted text from the captured source", "Cita textual de la fuente capturada")}</h3>
      {evidence ? <blockquote className="mt-1 whitespace-pre-wrap border-l-4 border-primary bg-background p-3 text-sm">{evidence.quoted_span}</blockquote> : <p className="mt-1 border-l-4 border-accent bg-background p-3 text-sm">{pick("No validated source capture is attached to this result. Evidence requires review before reliance.", "No hay una captura validada de la fuente para este resultado. La evidencia requiere revisión.")}</p>}
      <p className="mt-2 text-xs opacity-70">{pick("A matching quote confirms its presence in the stored capture. It does not independently verify the source's legal status, completeness or interpretation.", "Una cita coincidente confirma su presencia en la captura guardada. No verifica por sí sola su estado legal, integridad o interpretación.")}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-semibold">{pick("Source", "Fuente")}</dt><dd className="break-all">{source ? <a href={source} target="_blank" rel="noreferrer" className="underline">{evidence?.doc_id ?? rule.source_doc_id ?? pick("Open source", "Abrir fuente")} · {evidence?.source_url ?? rule.source_url}</a> : pick("Unavailable", "No disponible")}</dd>
        <dt className="font-semibold">{pick("Retrieved at", "Fecha de captura")}</dt><dd>{evidence?.retrieved_at ?? pick("No validated capture", "Sin captura validada")}</dd>
        <dt className="font-semibold">{pick("Query date", "Fecha de consulta")}</dt><dd>{asOf}</dd>
        <dt className="font-semibold">{pick("Reported effective date", "Fecha de vigencia registrada")}</dt><dd>{rule.effective_date ?? pick("Not supplied", "No proporcionada")}</dd>
        <dt className="font-semibold">{pick("Recorded lifecycle status", "Estado legislativo registrado")}</dt><dd><RuleStatus value={rule.status} /></dd>
        <dt className="font-semibold">{pick("Requirement ID", "ID del requisito")}</dt><dd className="break-all">{entry.team_rule_id}</dd>
        <dt className="font-semibold">{pick("Jurisdiction level", "Nivel de jurisdicción")}</dt><dd>{rule.level === "state" ? pick("State", "Estado") : pick("City", "Ciudad")} · {rule.jurisdiction}</dd>
      </dl>
      <h3 className="mt-5 text-sm font-semibold uppercase">{pick("Evaluator reasoning", "Razonamiento del evaluador")}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm">{entry.explanation}</p>
      {entry.missing_facts.length > 0 && <div className="mt-4 border-l-4 border-accent pl-3"><h3 className="text-sm font-semibold">{pick("Facts or evidence still needed", "Datos o evidencia pendientes")}</h3><ul className="mt-1 list-disc pl-5 text-sm">{entry.missing_facts.map(field => <li key={field}>{factLabel(field, pick)}</li>)}</ul></div>}
      {rule.exemptions && <><h3 className="mt-4 text-sm font-semibold uppercase">{pick("Recorded exemptions", "Exenciones registradas")}</h3><p className="mt-1 whitespace-pre-wrap text-sm">{rule.exemptions}</p></>}
      {rule.coverage_conditions && <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">{pick("Recorded coverage conditions", "Condiciones de cobertura registradas")}</summary><pre className="mt-2 whitespace-pre-wrap break-words bg-background p-3 font-sans">{typeof rule.coverage_conditions === "string" ? rule.coverage_conditions : JSON.stringify(rule.coverage_conditions, null, 2)}</pre></details>}
      {(entry.conflict_flag || rule.interaction) && <div className="mt-4 border-2 border-destructive p-3 text-sm"><h3 className="font-semibold">{pick("Interactions and review", "Interacciones y revisión")}</h3>{rule.interaction && <p className="mt-1">{rule.interaction}</p>}{rule.conflict_note && <p className="mt-1">{rule.conflict_note}</p>}{entry.conflict_flag && !rule.conflict_note && <p className="mt-1">{pick("A conflict flag was returned. Review the evaluator's explanation and related records.", "El evaluador indicó un conflicto. Revise su explicación y las normas relacionadas.")}</p>}</div>}
      {evidence && <details className="mt-4 text-xs"><summary className="cursor-pointer font-semibold">{pick("Capture audit details", "Auditoría de la captura")}</summary><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1"><dt>SHA-256</dt><dd className="break-all">{evidence.sha256}</dd><dt>{pick("Character offsets", "Posiciones de caracteres")}</dt><dd>{evidence.start_offset}–{evidence.end_offset}</dd></dl></details>}
    </div>
  </dialog>;
}

export function CategoryPanel({ evaluation, onEvidence }: { evaluation: PropertyEvaluation; onEvidence: (entry: EvaluatedRule) => void }) {
  const { pick } = useLang();
  return <aside className="bg-primary p-5 text-primary-foreground">
    <h2 className="mb-4 flex items-center gap-3 text-2xl font-semibold uppercase">{pick("Your laws", "Tus normas")}<span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center bg-accent text-accent-foreground">?</span></h2>
    <p className="mb-4 text-xs">{evaluation.rules.length} {pick("reviewed requirements returned for this address and date. Missing facts can leave their results unknown.", "requisitos revisados para esta dirección y fecha. Los datos faltantes pueden dejar sus resultados desconocidos.")}</p>
    <ul className="space-y-4 text-sm">{CATEGORIES.map(category => {
      const entries = evaluation.rules.filter(entry => entry.rule.category === category);
      return <li key={category}><div className="mb-1 text-xs uppercase opacity-80">{pick(...CATEGORY_LABELS[category])}</div>
        {entries.length ? <RequirementList entries={entries} category={category} limit={2} render={entry => <li key={entry.team_rule_id} className={entry.result === "unknown" ? "bg-accent p-2 text-accent-foreground" : "border-l-2 border-primary-foreground/30 pl-2"}>
          <button type="button" onClick={() => onEvidence(entry)} className="text-left underline decoration-1 underline-offset-2">{entry.rule.title}</button>
          <div className="mt-1 flex flex-wrap items-center gap-2"><RuleStatus value={entry.result} /><span className="text-xs">{entry.rule.citation}</span></div>
          {entry.conflict_flag && <div className="mt-1 text-xs font-semibold">{pick("Needs human review", "Requiere revisión humana")}</div>}
        </li>} /> : <p className="text-xs italic opacity-80">{pick("No reviewed requirement returned; coverage is incomplete.", "No se devolvió un requisito revisado; la cobertura es incompleta.")}</p>}
      </li>;
    })}</ul>
    <p className="mt-4 border-t border-primary-foreground/30 pt-3 text-xs">{pick("Complete legal coverage has not been established.", "No se ha establecido una cobertura legal completa.")}</p>
  </aside>;
}

export function LawTable({ evaluation, onEvidence }: { evaluation: PropertyEvaluation; onEvidence: (entry: EvaluatedRule) => void }) {
  const { pick } = useLang();
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const id = useId();
  const visibleCategories = CATEGORIES.filter(category => categoryFilter === "all" || category === categoryFilter);
  const queryText = query.trim().toLocaleLowerCase();
  const visibleRules = evaluation.rules.filter(entry => (categoryFilter === "all" || entry.rule.category === categoryFilter) && [entry.rule.title, entry.rule.requirement, entry.rule.citation, entry.team_rule_id, entry.rule.jurisdiction].some(value => value.toLocaleLowerCase().includes(queryText)));
  const headers = [["Category", "Categoría"], ["Law / requirement", "Ley / requisito"], ["Description", "Descripción"], ["Status", "Estado"], ["Recorded confidence", "Confianza registrada"], ["Source", "Fuente"], ["Retrieved at", "Fecha de captura"]];
  return <section className="mt-10">
    <h2 className="section-title mb-1">{pick("Check all the relevant requirements", "Revisa todos los requisitos relevantes")}</h2>
    <p className="mb-4 text-sm opacity-80">{pick("Open a requirement to inspect its evidence and reasoning. Separate obligations from the same law remain separate records.", "Abre un requisito para revisar su evidencia y razonamiento. Las obligaciones de una misma ley se muestran por separado.")}</p>
    <LookupDataStatus evaluation={evaluation} />
    <div className="my-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1"><label htmlFor={`${id}-search`} className="mb-1 block text-xs font-semibold uppercase">{pick("Find a returned requirement", "Buscar un requisito devuelto")}</label><input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} className="w-full border-2 border-primary bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" placeholder={pick("Title, citation or requirement ID", "Título, cita o ID del requisito")} /></div>
      <div><label htmlFor={`${id}-category`} className="mb-1 block text-xs font-semibold uppercase">{pick("Category", "Categoría")}</label><select id={`${id}-category`} value={categoryFilter} onChange={event => setCategoryFilter(event.target.value as Category | "all")} className="max-w-full border-2 border-primary bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><option value="all">{pick("All six categories", "Las seis categorías")}</option>{CATEGORIES.map(category => <option key={category} value={category}>{pick(...CATEGORY_LABELS[category])}</option>)}</select></div>
      {(query || categoryFilter !== "all") && <button type="button" onClick={() => { setQuery(""); setCategoryFilter("all"); }} className="px-1 py-2 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{pick("Clear filters", "Quitar filtros")}</button>}
    </div>
    <p className="mb-2 text-xs text-muted-foreground" role="status">{pick(`Showing ${visibleRules.length} of ${evaluation.rules.length} returned requirements.`, `Mostrando ${visibleRules.length} de ${evaluation.rules.length} requisitos devueltos.`)}</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[880px] border-collapse text-sm">
      <thead><tr className="bg-primary text-primary-foreground">{headers.map(([en, es]) => <th key={en} scope="col" className="border-2 border-primary px-3 py-2 text-left font-normal">{pick(en, es)}</th>)}</tr></thead>
      <tbody>{queryText && !visibleRules.length && <tr><td colSpan={7} className="border-2 border-primary p-4">{pick("No returned requirement matches these filters. Clear the filters to see the recorded results.", "Ningún requisito devuelto coincide con estos filtros. Quita los filtros para ver los resultados registrados.")}</td></tr>}{visibleCategories.flatMap(category => {
        const entries = visibleRules.filter(entry => entry.rule.category === category);
        if (!entries.length) return !queryText ? [<tr key={category}><td className="border-2 border-primary px-3 py-2">{pick(...CATEGORY_LABELS[category])}</td><td className="border-2 border-primary px-3 py-2" colSpan={6}><EmptyCoverage /></td></tr>] : [];
        return entries.map(entry => {
          const source = sourceHref(entry.evidence?.source_url ?? entry.rule.source_url);
          return <tr key={entry.team_rule_id} onClick={() => onEvidence(entry)} className={"cursor-pointer hover:bg-muted " + (entry.result === "superseded" ? "bg-muted/40" : "")}>
            <td className="border-2 border-primary px-3 py-2">{pick(...CATEGORY_LABELS[category])}</td>
            <td className="border-2 border-primary px-3 py-2"><button type="button" onClick={event => { event.stopPropagation(); onEvidence(entry); }} className="text-left underline">{entry.rule.citation}</button><div className="mt-1 text-xs opacity-70">{entry.rule.jurisdiction} · {entry.team_rule_id}</div><div className="mt-1 text-xs opacity-70">{pick("Recorded effective date", "Fecha de vigencia registrada")}: {entry.rule.effective_date ?? pick("Not supplied", "No proporcionada")}</div></td>
            <td className="border-2 border-primary px-3 py-2"><strong>{entry.rule.title}</strong>{entry.rule.key_value && <div className="mt-1 font-semibold">{entry.rule.key_value}</div>}{entry.conflict_flag && <div className="mt-1 text-xs font-semibold text-destructive">{pick("Needs human review", "Requiere revisión humana")}</div>}{entry.missing_facts.length > 0 && <div className="mt-1 text-xs">{pick("Still needed: ", "Pendiente: ") + entry.missing_facts.map(field => factLabel(field, pick)).join(", ")}</div>}<details className="mt-2" onClick={event => event.stopPropagation()}><summary className="cursor-pointer text-xs underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{pick("Requirement details", "Detalles del requisito")}<span className="sr-only">: {entry.rule.title}</span></summary><p className="mt-2 whitespace-pre-wrap text-sm">{entry.rule.requirement}</p><p className="mt-2 text-xs text-muted-foreground">{entry.explanation}</p></details></td>
            <td className="border-2 border-primary px-3 py-2"><RuleStatus value={entry.result} /></td>
            <td className="border-2 border-primary px-3 py-2"><ReviewedConfidence entry={entry} /></td>
            <td className="border-2 border-primary px-3 py-2">{source ? <a href={source} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="underline">{entry.evidence?.doc_id ?? entry.rule.source_doc_id ?? pick("Open source", "Abrir fuente")}</a> : pick("Unavailable", "No disponible")}</td>
            <td className="border-2 border-primary px-3 py-2 text-xs">{entry.evidence?.retrieved_at ?? pick("No validated capture", "Sin captura validada")}</td>
          </tr>;
        });
      })}</tbody>
    </table></div>
  </section>;
}

export function PropertySummary({ evaluation, onEvidence }: { evaluation: PropertyEvaluation; onEvidence: (entry: EvaluatedRule) => void }) {
  const { pick } = useLang();
  const summaryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let originallyClosed: HTMLDetailsElement[] = [];
    const beforePrint = () => {
      originallyClosed = [...(summaryRef.current?.querySelectorAll<HTMLDetailsElement>("details:not([open])") ?? [])];
      originallyClosed.forEach(details => { details.open = true; });
    };
    const afterPrint = () => { originallyClosed.forEach(details => { if (details.isConnected) details.open = false; }); originallyClosed = []; };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => { window.removeEventListener("beforeprint", beforePrint); window.removeEventListener("afterprint", afterPrint); afterPrint(); };
  }, []);
  const property = evaluation.property, facts = evaluation.input_snapshot.facts;
  const future = evaluation.rules.filter(entry => ["pending", "not_yet_effective"].includes(entry.result));
  const conflicts = evaluation.rules.filter(entry => entry.conflict_flag), withoutEvidence = evaluation.rules.filter(entry => !entry.evidence);
  const extraFacts = Object.entries(facts).filter(([key]) => !["state", "legal_city", "year_built", "units", "certificate_of_occupancy_date", "certificate_age_years"].includes(key));
  const sourceFacts: [string, string, ReactNode][] = [
    ["Address", "Dirección", [property.street_address, property.postal_city, property.state, property.zip].filter(Boolean).join(", ")],
    ["Address ID", "ID de dirección", property.address_id], ["State", "Estado", evaluation.jurisdiction.state],
    ["Legal municipality", "Municipio legal", evaluation.jurisdiction.verified ? evaluation.jurisdiction.city : pick("Unresolved", "Sin resolver")],
    ["Postal-city candidate", "Ciudad postal candidata", evaluation.jurisdiction.candidate_city],
    ["Year built used", "Año de construcción utilizado", factValue(facts.year_built, pick)],
    ["Units used", "Unidades utilizadas", factValue(facts.units, pick)],
    ["Certificate-of-occupancy date", "Fecha del certificado de ocupación", factValue(facts.certificate_of_occupancy_date, pick)],
    ["Completed certificate anniversaries", "Aniversarios completos del certificado", factValue(facts.certificate_age_years, pick)],
    ["Sample year built / units", "Año de construcción / unidades de la muestra", factValue(property.year_built, pick) + " / " + factValue(property.units, pick)],
    ["Property use", "Uso de la propiedad", property.use_description || property.use_code || pick("Unknown", "Desconocido")],
    ["Property dataset", "Conjunto de datos de la propiedad", property.source_dataset],
    ["Property retrieved at", "Fecha de captura de la propiedad", property.retrieved_at],
  ];
  return <section ref={summaryRef} className="py-6">
    <h2 className="mb-2 text-3xl font-semibold uppercase">{pick("Your summary of", "Tu resumen de")} <span className="font-normal normal-case">{property.street_address}</span></h2>
    <p className="mb-6 inline-block bg-accent px-3 py-1 text-sm font-semibold">{pick("Query date", "Fecha de consulta")}: {evaluation.as_of}</p>
    <div className="mb-6"><LookupDataStatus evaluation={evaluation} /></div>
    <div className="space-y-8">
      <div><SectionHeading>{pick("1. Building facts", "1. Datos del edificio")}</SectionHeading>
        <dl className="grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-6 gap-y-2 text-sm">{sourceFacts.map(([en, es, value]) => <div key={en} className="contents"><dt className="font-semibold">{pick(en, es)}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}{extraFacts.map(([field, value]) => <div key={field} className="contents"><dt className="font-semibold">{factLabel(field, pick)}</dt><dd>{factValue(value, pick)}</dd></div>)}</dl>
        <p className="mt-3 text-xs opacity-80">{pick("Facts used are preserved with this lookup. Supplied scenario values are not independently verified property records. Certificate age is derived from the certificate date and query date.", "Los datos utilizados se conservan con esta consulta. Los datos aportados para el escenario no son registros de propiedad verificados independientemente. La edad del certificado se deriva de su fecha y la fecha de consulta.")}</p>
        {property.quality_flags.length > 0 && <p className="mt-2 text-xs">{pick("Sample quality flags: ", "Indicadores de calidad de la muestra: ") + property.quality_flags.map(value => value.replaceAll("_", " ")).join(", ")}</p>}
        {evaluation.input_snapshot.resolution && <p className="mt-2 text-xs">{pick("Boundary method: ", "Método de verificación territorial: ") + evaluation.input_snapshot.resolution.method} · {evaluation.input_snapshot.resolution.resolved_at} · <a href={sourceHref(evaluation.input_snapshot.resolution.source_url)} target="_blank" rel="noreferrer" className="underline">{pick("Boundary evidence", "Evidencia territorial")}</a></p>}
      </div>
      <div><SectionHeading>{pick("2. Requirements by category", "2. Requisitos por categoría")}</SectionHeading>
        <div className="space-y-4">{CATEGORIES.map(category => {
          const entries = evaluation.rules.filter(entry => entry.rule.category === category);
          return <div key={category} className="grid gap-2 md:grid-cols-[220px_1fr]"><strong className="text-sm">{pick(...CATEGORY_LABELS[category])}</strong>
            {entries.length ? <div className="text-sm"><RequirementList entries={entries} category={category} render={entry => <li key={entry.team_rule_id}><div className="mb-1 flex flex-wrap items-center gap-2"><RuleStatus value={entry.result} />{entry.conflict_flag && <strong className="text-xs text-destructive">{pick("Needs human review", "Requiere revisión humana")}</strong>}</div><strong>{entry.rule.title}</strong> — {entry.rule.requirement} <button type="button" onClick={() => onEvidence(entry)} className="text-left italic underline">[{entry.rule.citation}]</button><p className="mt-1 text-xs opacity-80">{entry.explanation}</p></li>} /></div> : <EmptyCoverage />}
          </div>;
        })}</div>
      </div>
      <div><SectionHeading>{pick("3. Upcoming and pending records", "3. Normas futuras y propuestas pendientes")}</SectionHeading>
        {future.length ? <ul className="list-disc space-y-2 pl-5 text-sm">{future.map(entry => <li key={entry.team_rule_id}><RuleStatus value={entry.result} /> <button type="button" onClick={() => onEvidence(entry)} className="underline">{entry.rule.title}</button>{entry.rule.effective_date && <span> · {pick("Reported effective date", "Fecha de vigencia registrada")}: {entry.rule.effective_date}</span>}<p className="mt-1 text-xs">{entry.explanation}</p></li>)}</ul> : <p className="text-sm">{pick("No upcoming or pending records were returned in this lookup. The reviewed inventory may be incomplete.", "Esta consulta no devolvió normas futuras o pendientes. El inventario revisado puede estar incompleto.")}</p>}
      </div>
      <div><SectionHeading>{pick("4. Missing information", "4. Información faltante")}</SectionHeading>
        {evaluation.missing_facts.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{evaluation.missing_facts.map(field => <li key={field}>{factLabel(field, pick)}</li>)}</ul> : <p className="text-sm">{pick("No additional missing facts were reported for this evaluation. Complete legal coverage has not been established.", "No se indicaron datos adicionales pendientes para esta evaluación. No se ha establecido una cobertura legal completa.")}</p>}
        {evaluation.rules.filter(entry => entry.result === "unknown").map(entry => <p key={entry.team_rule_id} className="mt-2 border-l-4 border-accent pl-3 text-sm"><strong>{entry.rule.title}: </strong>{entry.explanation}</p>)}
      </div>
      <div><SectionHeading>{pick("5. Conflicts and source review", "5. Conflictos y revisión de fuentes")}</SectionHeading>
        {!conflicts.length && !withoutEvidence.length && <p className="text-sm">{pick("No conflict flags or missing evidence were reported in the returned records.", "No se indicaron conflictos o evidencia faltante en los registros devueltos.")}</p>}
        <ul className="space-y-2 text-sm">{conflicts.map(entry => <li key={entry.team_rule_id} className="border-2 border-destructive p-3"><strong className="text-destructive">{pick("Needs human review", "Requiere revisión humana")}: </strong><button type="button" onClick={() => onEvidence(entry)} className="underline">{entry.rule.title}</button><p className="mt-1">{entry.rule.conflict_note ?? entry.explanation}</p></li>)}{withoutEvidence.map(entry => <li key={"source-" + entry.team_rule_id} className="border-l-4 border-accent pl-3"><button type="button" onClick={() => onEvidence(entry)} className="underline">{entry.rule.title}</button>: {pick("No validated captured evidence is attached.", "No hay evidencia capturada validada.")}</li>)}</ul>
      </div>
      <div><SectionHeading>{pick("6. Evidence and audit", "6. Evidencia y auditoría")}</SectionHeading>
        <p className="mb-3 text-sm">{pick("Complete legal coverage has not been established. Rule confidence, when supplied, is not a property-coverage probability.", "No se ha establecido una cobertura legal completa. La confianza registrada en una norma no representa la probabilidad de cobertura de la propiedad.")}</p>
        <details open={evaluation.rules.length <= 3} className="border border-primary/30 bg-card p-3"><summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">{pick(`Inspect ${evaluation.rules.length} returned evidence records`, `Consultar ${evaluation.rules.length} registros de evidencia devueltos`)}</summary><ul className="mt-3 space-y-3 text-sm">{evaluation.rules.map(entry => <li key={entry.team_rule_id} className="border-l-2 border-primary/30 pl-3"><div><strong>{entry.rule.title}</strong> · {entry.team_rule_id} · <RuleStatus value={entry.result} /></div><div className="mt-1"><ReviewedConfidence entry={entry} /></div><div className="mt-1 text-xs">{entry.evidence?.doc_id ?? entry.rule.source_doc_id ?? pick("Source ID unavailable", "ID de fuente no disponible")} · {entry.evidence?.retrieved_at ?? pick("No validated capture", "Sin captura validada")}</div><button type="button" onClick={() => onEvidence(entry)} className="mt-1 underline print:hidden">{pick("Audit view", "Vista de auditoría")}</button>{sourceHref(entry.evidence?.source_url ?? entry.rule.source_url) && <a href={sourceHref(entry.evidence?.source_url ?? entry.rule.source_url)} target="_blank" rel="noreferrer" className="ml-3 break-all text-xs underline">{entry.evidence?.source_url ?? entry.rule.source_url}</a>}</li>)}</ul></details>
        <p className="mt-4 text-xs">{pick("Query date", "Fecha de consulta")}: {evaluation.as_of} · {pick("Returned requirements", "Requisitos devueltos")}: {evaluation.rule_count}</p>
      </div>
      {evaluation.notices.length > 0 && <div className="border-l-4 border-accent pl-3"><ul className="space-y-1 text-xs">{evaluation.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></div>}
      <p className="bg-accent px-3 py-2 text-sm font-semibold">{pick("Not legal advice. Verify evidence and interpretation before relying on a result.", "No es asesoría legal. Verifica la evidencia y su interpretación antes de utilizar un resultado.")}</p>
    </div>
  </section>;
}
