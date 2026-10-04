"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Check, ChevronLeft, ChevronRight, Download, LoaderCircle, Printer, Search, Sparkles } from "lucide-react";
import type { Dashboard, EvaluatedRule, FactRecord, PropertyEvaluation, PropertyRecord } from "@/domain/types";
import { AddressSearch } from "./lovable/address-search";
import { SiteHeader } from "./lovable/site-header";
import { Skyline } from "./lovable/skyline";
import { useLang } from "./lovable/language";
import { PropertyMap } from "./lovable/property-map";
import { RealLifeView } from "./lovable/real-life-view";
import { getAreaMapLocation, type MapLocation } from "@/lib/property-map-location";
import { FactQuiz } from "./lovable/fact-quiz";
import { CategoryPanel, EvidenceDialog, LawTable, PropertySummary } from "./lovable/results";
import { getAccountSnapshot, useAccount } from "@/lib/account-state";

type Tab = "overview" | "list" | "summary";
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status}).`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
function localToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export default function LexrentApp() {
  const { t, pick } = useLang();
  const [property, setProperty] = useState<PropertyRecord | null>(null);
  const [date, setDate] = useState("2026-10-01");
  const [evaluation, setEvaluation] = useState<PropertyEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState({ address: false, date: false });
  const [tab, setTab] = useState<Tab>("overview");
  const account = useAccount();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [quiz, setQuiz] = useState(false);
  const [evidence, setEvidence] = useState<EvaluatedRule | null>(null);
  const [scenarioFacts, setScenarioFacts] = useState<FactRecord>({});
  const [searchKey, setSearchKey] = useState(0);
  const [rows, setRows] = useState<PropertyRecord[]>([]);
  const [listQuery, setListQuery] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const generation = useRef(0);
  const [mapped, setMapped] = useState<{ addressId: string; location: MapLocation } | null>(null);
  const handleMapLocation = useCallback((addressId: string, location: MapLocation) => setMapped({ addressId, location }), []);

  useEffect(() => {
    let live = true;
    request<Dashboard>("/api/dashboard").then(data => { if (live) setDashboard(data); }).catch(() => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    setSavedIds([]);
    if (!account.user) return;
    let live = true;
    request<{ saved: { address_id: string }[] }>("/api/saved").then(data => { if (live) setSavedIds(data.saved.map(item => item.address_id)); }).catch(() => { /* Saving will surface a service error if the user requests it. */ });
    return () => { live = false; };
  }, [account.user?.id]);

  const runLookup = useCallback(async (addressId: string, asOf: string, facts: FactRecord = {}, updateUrl = true) => {
    const current = ++generation.current;
    setLoading(true); setError(""); setEvaluation(null); setEvidence(null); setNotice("");
    try {
      const data = await request<PropertyEvaluation>("/api/lookup", post({ address_id: addressId, as_of: asOf, facts }));
      if (generation.current !== current) return;
      setEvaluation(data); setProperty(data.property); setDate(data.as_of); setScenarioFacts(facts); setTab("overview");
      if (updateUrl) window.history.replaceState(null, "", `/?${new URLSearchParams({ address_id: addressId, as_of: asOf })}`);
    } catch (e) { if (generation.current === current) setError((e as Error).message); }
    finally { if (generation.current === current) setLoading(false); }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("address_id");
    if (id) void runLookup(id, params.get("as_of") || "2026-10-01", {}, false);
    return () => { generation.current += 1; };
  }, [runLookup]);
  useEffect(() => {
    if (tab !== "list") return;
    const controller = new AbortController();
    setListLoading(true); setListError("");
    const timer = setTimeout(() => {
      request<{ properties: PropertyRecord[]; total: number }>(`/api/properties?${new URLSearchParams({ q: listQuery, state, page: String(page), limit: "12" })}`, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) { setRows(data.properties); setTotal(data.total); } })
        .catch(e => { if (!controller.signal.aborted) setListError((e as Error).message); })
        .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    }, listQuery ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [tab, listQuery, state, page]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    setErrors({ address: !property, date: !date });
    if (!property || !date) return;
    void runLookup(property.address_id, date, evaluation?.property.address_id === property.address_id ? scenarioFacts : {});
  }
  function newSearch() {
    generation.current += 1; setEvaluation(null); setProperty(null); setScenarioFacts({}); setLoading(false); setError(""); setNotice(""); setErrors({ address: false, date: false }); setDate("2026-10-01"); setTab("overview"); setSearchKey(k => k + 1);
    window.history.replaceState(null, "", "/");
  }
  function exportData() {
    if (!evaluation) return;
    const blob = new Blob([JSON.stringify({ scope: "research_assistance", ...evaluation }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `lexrent-${evaluation.property.address_id}-${evaluation.as_of}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveProperty() {
    if (!evaluation || saveLoading) return;
    if (!account?.user) { window.location.assign(`/sign-in?${new URLSearchParams({ next: `/?${new URLSearchParams({ address_id: evaluation.property.address_id, as_of: evaluation.as_of })}` })}`); return; }
    const id = evaluation.property.address_id;
    const owner = account.user.id;
    const remove = savedIds.includes(id);
    setSaveLoading(true); setNotice("");
    try {
      await request("/api/saved", { ...post({ address_id: id }), method: remove ? "DELETE" : "POST" });
      if (getAccountSnapshot().user?.id !== owner) return;
      setSavedIds(ids => remove ? ids.filter(saved => saved !== id) : [...ids, id]);
      setNotice(remove ? pick("Property removed from your saved list.", "Propiedad eliminada de su lista.") : pick("Property saved to your private account.", "Propiedad guardada en su cuenta privada."));
    } catch (e) { setError((e as Error).message); }
    finally { setSaveLoading(false); }
  }
  async function resolveBoundary() {
    if (!evaluation || resolving) return;
    setResolving(true); setError("");
    const { property: current, as_of: asOf } = evaluation;
    const scope = generation.current;
    try { await request(`/api/admin/jurisdictions/${current.address_id}`, post({})); if (scope === generation.current) await runLookup(current.address_id, asOf, scenarioFacts); }
    catch (e) { if (scope === generation.current) setError((e as Error).message); }
    finally { setResolving(false); }
  }
  const submitted = Boolean(evaluation || loading);
  const results = evaluation?.rules || [];
  const future = results.filter(entry => ["not_yet_effective", "pending"].includes(entry.result));
  const propertyContext = evaluation ? new URLSearchParams({ view: "assistant", address_id: evaluation.property.address_id, as_of: evaluation.as_of }).toString() : "view=assistant";
  const SearchBar = <div className="flex flex-col gap-2 md:flex-row md:items-start">
    <div className="min-w-0 md:w-[460px] md:shrink-0">
      <AddressSearch key={searchKey} disabled={loading} value={property} onSelect={p => { setProperty(p); setErrors(e => ({ ...e, address: false })); }} />
      {errors.address && <p className="mt-1 text-sm text-destructive">{t("errAddress")}</p>}
    </div>
    <span className="hidden self-start text-3xl font-bold leading-none md:mt-[5px] md:block">&amp;</span>
    <div className="md:w-[230px] md:shrink-0">
      <div className="flex items-center border-2 border-primary bg-primary text-primary-foreground">
        <input type="date" required disabled={loading} aria-label={t("datePh")} value={date} onChange={e => { setDate(e.target.value); setErrors(x => ({ ...x, date: false })); }} className="w-full min-w-0 bg-transparent px-2 py-2 text-sm outline-none [color-scheme:dark]" />
        <button type="button" disabled={loading} onClick={() => setDate(localToday())} className="shrink-0 self-stretch bg-accent px-3 text-sm font-semibold text-accent-foreground hover:brightness-105">{t("today")}</button>
      </div>
      {errors.date && <p className="mt-1 text-sm text-destructive">{t("errDate")}</p>}
    </div>
    {submitted && <button type="submit" className="btn-accent flex items-center justify-center gap-2" disabled={loading}>{loading ? <LoaderCircle size={17} className="animate-spin" /> : <Search size={17} />}{pick("Update", "Actualizar")}</button>}
  </div>;

  return <div className="flex min-h-screen flex-col">
    <SiteHeader />
    <main className={`mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 ${submitted ? "pb-10" : ""}`}>
      {!submitted ? <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <form onSubmit={search} className="flex w-fit max-w-full flex-col items-stretch">
          <h1 className="text-3xl md:text-4xl">{t("heroA")}</h1>
          <p className="mt-2 bg-primary px-4 py-1 text-3xl text-primary-foreground md:text-4xl">{t("heroB")}</p>
          <div className="mt-12 text-left">{SearchBar}</div>
          <button type="submit" className="btn-accent mt-8 self-center">{t("searchNow")}</button>
          <p className="mt-5 max-w-xl self-center text-xs text-muted-foreground">{pick("California · New Jersey · Massachusetts. Search the challenge’s property sample and choose the date that matters to you.", "California · Nueva Jersey · Massachusetts. Busque en la muestra del reto y elija la fecha que le interesa.")}</p>
          <Link href="/workspace?view=assistant" className="mt-5 flex items-center justify-center gap-2 self-center text-sm underline"><Sparkles size={15} />{pick("Ask LEXRENT with source evidence", "Pregunte a LEXRENT con evidencia de fuentes")}</Link>
          {error && <p role="alert" className="mt-4 max-w-xl bg-accent p-3 text-left text-sm">{error}</p>}
        </form>
      </section> : <>
        <section className="no-print pt-8"><form onSubmit={search}>{SearchBar}<div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={newSearch} className="btn-primary">{t("newSearch")}</button>
          <button type="button" onClick={exportData} disabled={!evaluation} className="btn-accent flex items-center gap-2"><Download size={15} />{t("exportData")}</button>
          <button type="button" disabled={!evaluation || saveLoading} onClick={() => void saveProperty()} className="flex items-center gap-2 border-2 border-primary bg-card px-3 py-2 text-sm">{saveLoading ? <LoaderCircle size={15} className="animate-spin" /> : savedIds.includes(evaluation?.property.address_id || "") ? <Check size={15} /> : <Bookmark size={15} />}{pick(savedIds.includes(evaluation?.property.address_id || "") ? "Saved" : "Save property", savedIds.includes(evaluation?.property.address_id || "") ? "Guardada" : "Guardar propiedad")}</button>
          <Link href={`/workspace?${propertyContext}`} className="ml-auto flex items-center gap-2 text-sm underline"><Sparkles size={16} />{pick("Ask about this address", "Pregunte sobre esta dirección")}</Link>
        </div></form></section>
        {notice && <p role="status" className="no-print mt-4 border-2 border-primary bg-accent p-3 text-sm">{notice}</p>}
        {error && <p role="alert" className="mt-4 border-2 border-destructive bg-card p-3 text-sm text-destructive">{error}</p>}
        {loading ? <div role="status" className="flex min-h-96 items-center justify-center gap-3 text-sm"><LoaderCircle className="animate-spin" size={22} />{pick("Checking the address, date and reviewed source evidence…", "Comprobando la dirección, fecha y evidencia revisada…")}</div> : evaluation && <>
          <div className="mt-6 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{evaluation.property.street_address}</h2><p className="mt-1 text-xs">{evaluation.property.postal_city}, {evaluation.property.state} {evaluation.property.zip} · {evaluation.property.address_id}</p></div><span className="bg-accent px-3 py-1 text-xs font-semibold">{pick("Results as of", "Resultados al")} {evaluation.as_of}</span></div>
          <div role="tablist" aria-label={pick("Property views", "Vistas de propiedad")} className="no-print mt-6 flex">
            {(["overview", "list", "summary"] as Tab[]).map(key => <button key={key} role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => setTab(key)} className={`-ml-[2px] flex-1 border-2 border-primary px-4 py-2 text-sm first:ml-0 md:max-w-36 ${tab === key ? "bg-primary text-primary-foreground" : "bg-card"}`}>{t(key)}</button>)}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "overview" && <>
              <section className="grid border-2 border-primary bg-primary md:grid-cols-[1fr_340px]">
                <div className="relative min-w-0 bg-card"><PropertyMap property={evaluation.property} onLocationChange={handleMapLocation} /></div>
                <CategoryPanel evaluation={evaluation} onEvidence={setEvidence} />
              </section>
              <RealLifeView property={evaluation.property} location={mapped?.addressId === evaluation.property.address_id ? mapped.location : getAreaMapLocation(evaluation.property)} />
              <section className="mt-3 flex flex-wrap items-center gap-2 border-2 border-primary bg-card px-4 py-3 text-sm">
                <span className="mr-1 text-xs font-semibold uppercase">{pick("Jurisdiction check", "Jurisdicción")}:</span>
                <span className="bg-primary px-2 py-1 text-primary-foreground">{pick("State", "Estado")}: {evaluation.jurisdiction.state}</span><ChevronRight size={16} />
                <span className={evaluation.jurisdiction.verified ? "bg-primary px-2 py-1 text-primary-foreground" : "border border-dashed border-primary px-2 py-1"}>{pick("Legal city", "Ciudad legal")}: {evaluation.jurisdiction.city || pick("Unresolved", "Sin resolver")}</span>
                <span className="ml-auto bg-accent px-2 py-1 text-xs font-semibold">{pick("Coverage incomplete", "Cobertura incompleta")}</span>
              </section>
              {!evaluation.jurisdiction.verified && <p className="mt-1 border-2 border-primary bg-card p-3 text-xs">{pick("Mailing city", "Ciudad postal")}: {evaluation.property.postal_city}. {pick("A postal address or map marker does not verify the municipality whose laws govern.", "Una dirección postal o marcador no verifica el municipio cuyas normas rigen.")}</p>}
              {account?.is_admin && !evaluation.jurisdiction.verified && <button disabled={resolving} onClick={() => void resolveBoundary()} className="no-print btn-primary mt-3 flex items-center gap-2">{resolving && <LoaderCircle size={15} className="animate-spin" />}{pick("Resolve legal boundary with Census evidence", "Verificar límite legal con evidencia del Censo")}</button>}
              <LawTable evaluation={evaluation} onEvidence={setEvidence} />
              <section className="mt-10"><h2 className="section-title mb-3 flex items-center gap-3"><span className="inline-flex h-7 w-7 items-center justify-center bg-accent text-accent-foreground">!</span>{t("changes")}</h2>
                {future.length ? future.map(entry => <div key={entry.team_rule_id} className="mb-3 border-l-4 border-accent pl-3 text-sm"><button className="font-semibold underline" onClick={() => setEvidence(entry)}>{entry.rule.title}</button><p className="mt-1">{entry.explanation}</p></div>) : <p className="text-sm">{pick("No future changes were returned by the reviewed rules. Coverage is incomplete; this does not establish that no changes exist.", "Las normas revisadas no devolvieron cambios futuros. La cobertura es incompleta; esto no demuestra que no existan cambios.")}</p>}
                <Link href="/workspace?view=changes" className="mt-3 inline-flex text-sm underline">{pick("Explore the law-change cases", "Explorar los casos de cambios legales")}</Link>
              </section>
              <section className="mt-10"><h2 className="section-title mb-3 flex items-center gap-3"><span className="inline-flex h-7 w-7 items-center justify-center bg-accent text-accent-foreground">?</span>{t("missing")}</h2><p className="text-sm">{pick("Housing rules can depend on several requirements at once. Add only facts you know; unknown answers remain visible.", "Las normas pueden depender de varios requisitos a la vez. Añada solo los datos que conozca; las respuestas desconocidas seguirán visibles.")}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{evaluation.missing_facts.map(fact => <li key={fact}>{fact.replaceAll("_", " ")}</li>)}</ul>
                <button onClick={() => setQuiz(true)} className="btn-primary mt-4">{t("fillIn")}</button>
                {Object.keys(scenarioFacts).length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>{pick("Your scenario facts are used for this session only.", "Los datos de su escenario se usan solo en esta sesión.")}</span><button onClick={() => void runLookup(evaluation.property.address_id, evaluation.as_of)} className="underline">{pick("Reset to original property facts", "Restablecer los datos originales")}</button></div>}
              </section>
              <section className="mt-8 border-2 border-primary bg-accent p-4 text-sm"><h3 className="font-semibold">{pick("Before relying on a result", "Antes de usar un resultado")}</h3><ul className="mt-2 list-disc space-y-2 pl-5">{evaluation.notices.map((item, i) => <li key={i}>{item}</li>)}</ul><Link className="mt-3 inline-block underline" href="/workspace?view=sources">{pick("Read the original source library", "Leer la biblioteca de fuentes originales")}</Link></section>
            </>}
            {tab === "list" && <section className="py-6">
              <div className="mb-4 flex flex-wrap items-end gap-3"><label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">{pick("Search properties", "Buscar propiedades")}<input className="border-2 border-primary bg-card px-3 py-2 text-sm" value={listQuery} onChange={e => { setListQuery(e.target.value); setPage(1); }} placeholder={pick("Street, city or property ID", "Calle, ciudad o ID")} /></label><label className="flex flex-col gap-1 text-xs">{pick("State", "Estado")}<select className="border-2 border-primary bg-card px-3 py-2 text-sm" value={state} onChange={e => { setState(e.target.value); setPage(1); }}><option value="">{pick("All states", "Todos los estados")}</option><option value="CA">California</option><option value="NJ">New Jersey</option><option value="MA">Massachusetts</option></select></label></div>
              {listError && <p role="alert" className="mb-3 text-sm text-destructive">{listError}</p>}
              <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr className="bg-primary text-primary-foreground">{[t("address"), t("zip"), t("built"), pick("Units", "Unidades"), pick("Research status", "Estado de investigación")].map(title => <th key={title} className="border-2 border-primary px-3 py-2 text-left font-normal">{title}</th>)}</tr></thead><tbody>
                {listLoading ? <tr><td colSpan={5} className="border-2 border-primary p-8 text-center">{t("searching")}</td></tr> : rows.length ? rows.map(row => <tr key={row.address_id} className={row.address_id === evaluation.property.address_id ? "bg-secondary" : "bg-card"}><td className="border-2 border-primary px-3 py-3"><button onClick={() => void runLookup(row.address_id, date || evaluation.as_of)} className="text-left underline">{row.street_address}</button><div className="mt-1 text-xs opacity-75">{row.postal_city}, {row.state} · {row.address_id}</div></td><td className="border-2 border-primary px-3 py-2">{row.zip || "—"}</td><td className="border-2 border-primary px-3 py-2">{row.year_built ?? "—"}</td><td className="border-2 border-primary px-3 py-2">{row.units ?? "—"}</td><td className="border-2 border-primary px-3 py-2"><span className="text-xs">{pick("Open for assessment", "Abrir para evaluar")}</span><button onClick={() => void runLookup(row.address_id, date || evaluation.as_of)} className="mt-1 block text-xs underline">{pick("Look up this address", "Consultar dirección")}</button></td></tr>) : <tr><td colSpan={5} className="border-2 border-primary p-8 text-center">{t("noResults")}</td></tr>}
              </tbody></table></div>
              <div className="mt-4 flex items-center justify-between gap-3 text-xs"><span>{total} {pick("properties", "propiedades")} · {pick("Page", "Página")} {page} / {Math.max(1, Math.ceil(total / 12))}</span><div className="flex gap-2"><button aria-label={pick("Previous page", "Página anterior")} disabled={page <= 1 || listLoading} onClick={() => setPage(p => p - 1)} className="border-2 border-primary p-2"><ChevronLeft size={18} /></button><button aria-label={pick("Next page", "Página siguiente")} disabled={page * 12 >= total || listLoading} onClick={() => setPage(p => p + 1)} className="border-2 border-primary p-2"><ChevronRight size={18} /></button></div></div>
              <p className="mt-5 border-l-4 border-accent pl-3 text-xs">{pick("Property facts come from the supplied assessor data. They do not confirm the applicability of a law or the exact legal boundary.", "Los datos proceden de la muestra del tasador. No confirman la aplicabilidad de una norma ni el límite legal exacto.")}</p>
            </section>}
            {tab === "summary" && <><div className="no-print mt-5 flex justify-end"><button onClick={() => window.print()} className="flex items-center gap-2 border-2 border-primary px-3 py-2 text-sm"><Printer size={16} />{pick("Print summary", "Imprimir resumen")}</button></div><PropertySummary evaluation={evaluation} onEvidence={setEvidence} /></>}
          </div>
        </>}
      </>}
    </main>
    {!submitted && <Skyline />}
    <footer className="no-print flex flex-wrap items-center justify-between gap-2 bg-primary px-6 py-3 text-xs text-primary-foreground"><span>{dashboard ? `${dashboard.property_count} ${pick("sample properties", "propiedades de muestra")} · ${dashboard.source_count} ${pick("sources", "fuentes")}` : "CA · NJ · MA"}</span><Link href="/about" className="font-semibold">LEXRENT</Link></footer>
    {evidence && evaluation && <EvidenceDialog entry={evidence} asOf={evaluation.as_of} onClose={() => setEvidence(null)} />}
    {quiz && evaluation && <FactQuiz initial={evaluation.input_snapshot.facts} missing={evaluation.missing_facts} onClose={() => setQuiz(false)} onApply={facts => { setQuiz(false); void runLookup(evaluation.property.address_id, evaluation.as_of, { ...scenarioFacts, ...facts }); }} />}
  </div>;
}
