import { Skyline } from "@/components/Skyline";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { AddressSearch } from "@/components/AddressSearch";
import { MapView } from "@/components/MapView";
import { StreetView } from "@/components/StreetView";
import { Quiz } from "@/components/Quiz";
import { SummaryView } from "@/components/SummaryView";
import { ConfidenceBadge, EvidenceModal, StatusBadge } from "@/components/Evidence";
import { useLang, type TKey } from "@/lib/i18n";
import { fetchBuilding, fetchNYCData, isNYC, type Building, type NYCData, type Place } from "@/lib/geo";
import { CATEGORIES, CATEGORY_LABEL, CORE_FACTS, resolveLaws, WEAK_SOURCE, sourceTypeOf, type Category, type Facts, type FactKey } from "@/lib/laws";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LexRent — Rental housing rights by address" },
      { name: "description", content: "Search any US address and date to see the rent, eviction, deposit and screening laws that apply — with sources." },
      { property: "og:title", content: "LexRent — Rental housing rights by address" },
      { property: "og:description", content: "See the tenant laws behind your address, in English or Spanish." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Tab = "overview" | "list" | "summary";
type HistoryItem = { place: Place; facts: Facts };

function Index() {
  const { t, lang } = useLang();
  const [place, setPlace] = useState<Place | null>(null);
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<{ a?: boolean; d?: boolean }>({});
  const [sub, setSub] = useState<{ place: Place; date: string } | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [bLoading, setBLoading] = useState(false);
  const [facts, setFacts] = useState<Facts>({});
  const [nyc, setNyc] = useState<NYCData | null>(null);
  const [nycLoading, setNycLoading] = useState(false);
  const [confInfo, setConfInfo] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [retrievedAt, setRetrievedAt] = useState("");
  const [quiz, setQuiz] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sliderYear, setSliderYear] = useState(new Date().getFullYear());

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem("lexrent-history") ?? "[]")); } catch { /* ignore */ }
  }, []);

  const run = async () => {
    const e = { a: !place, d: !date };
    setErrors(e);
    if (e.a || e.d || !place) return;
    setSub({ place, date });
    setSliderYear(Number(date.slice(0, 4)));
    setRetrievedAt(new Date().toLocaleString(lang === "es" ? "es-US" : "en-US"));
    setTab("overview");
    setBuilding(null);
    setNyc(null);
    setBLoading(true);
    let f: Facts = {};
    try {
      const b = await fetchBuilding(place);
      setBuilding(b);
      const y = parseInt((b?.tags["start_date"] ?? b?.tags["building:start_date"] ?? "").slice(0, 4));
      const u = parseInt(b?.tags["building:flats"] ?? "");
      if (y > 1700) f.yearBuilt = y;
      if (u > 0) f.units = u;
    } catch { /* map falls back to marker */ }
    setBLoading(false);
    setFacts(f);
    const item = { place, facts: f };
    setHistory((h) => {
      const n = [item, ...h.filter((x) => x.place.id !== place.id)].slice(0, 12);
      localStorage.setItem("lexrent-history", JSON.stringify(n));
      return n;
    });
    if (isNYC(place)) {
      setNycLoading(true);
      fetchNYCData(place).then(setNyc).catch(() => setNyc(null)).finally(() => setNycLoading(false));
    }
  };

  const updateFacts = (nf: Facts) => {
    const merged = { ...facts };
    (Object.keys(nf) as FactKey[]).forEach((k) => { if (nf[k] !== undefined) (merged as Record<string, unknown>)[k] = nf[k]; });
    setFacts(merged);
    if (sub) setHistory((h) => {
      const n = h.map((x) => (x.place.id === sub.place.id ? { ...x, facts: merged } : x));
      localStorage.setItem("lexrent-history", JSON.stringify(n));
      return n;
    });
  };

  const res = useMemo(() => (sub ? resolveLaws(sub.place, sub.date, facts) : null), [sub, facts]);
  const quizKeys = useMemo(() => {
    if (!res) return [];
    const k = res.missing;
    return k.length ? k : [];
  }, [res]);

  const exportData = () => {
    if (!sub || !res) return;
    const rows = [["Address", "Date", "Category", "Law No.", "Title", "Description", "Status", "Confidence", "Jurisdiction", "Source", "Retrieved at"]];
    res.all.forEach((e) => rows.push([sub.place.label, sub.date, CATEGORY_LABEL[e.law.category][lang], e.law.lawNo, e.law.title[lang], e.law.desc[lang], t(e.status as TKey), e.confidence, e.law.jurisdiction, e.law.source.url, retrievedAt]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `lexrent-${sub.place.label.replace(/\W+/g, "-")}-${sub.date}.csv`;
    a.click();
  };

  const newSearch = () => { setSub(null); setPlace(null); setDate(""); setFacts({}); setErrors({}); };

  const SearchBar = (
    <div className="flex flex-col gap-2 md:flex-row md:items-start">
      <div className="md:w-[460px] md:shrink-0">
        <AddressSearch value={place} onSelect={(p) => { setPlace(p); if (p) setErrors((e) => ({ ...e, a: false })); }} />
        {errors.a && <p className="mt-1 text-sm text-destructive">{t("errAddress")}</p>}
      </div>
      <span className="hidden self-start text-3xl font-bold leading-none md:mt-[5px] md:block md:transition-all md:duration-300">&amp;</span>
      <div className="md:w-[190px] md:shrink-0">
        <label className="flex items-center bg-primary text-primary-foreground">
          <input
            type="date"
            required
            aria-label={t("datePh")}
            value={date}
            onChange={(e) => { setDate(e.target.value); setErrors((x) => ({ ...x, d: false })); }}
            className="w-full bg-transparent px-3 py-2 text-sm outline-none [color-scheme:dark]"
          />
          <button type="button" onClick={() => { setDate(new Date().toISOString().slice(0, 10)); setErrors((x) => ({ ...x, d: false })); }} className="shrink-0 bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90">{t("today")}</button>
        </label>
        {errors.d && <p className="mt-1 text-sm text-destructive">{t("errDate")}</p>}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10">
        {!sub ? (
          <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
            <div className="flex w-fit max-w-full flex-col items-stretch">
              <h1 className="text-3xl md:text-4xl">{t("heroA")}</h1>
              <p className="mt-2 bg-primary px-4 py-1 text-3xl text-primary-foreground md:text-4xl">{t("heroB")}</p>
              <div className="mt-12 text-left">{SearchBar}</div>
              <button onClick={run} className="btn-accent mt-8 self-center">{t("searchNow")}</button>
            </div>
          </section>
        ) : (
          <>
            <section className="pt-8">
              <form onSubmit={(e) => { e.preventDefault(); run(); }}>
                {SearchBar}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {tab === "list" && (
                    <div className="relative">
                      <button type="button" onClick={() => setFilterOpen((o) => !o)} className="btn-primary min-w-32">{t("filter")}</button>
                      {filterOpen && (
                        <ul className="absolute z-[800] mt-1 w-64 border-2 border-primary bg-popover">
                          {(["all", ...CATEGORIES] as const).map((c) => (
                            <li key={c}>
                              <button type="button" onClick={() => { setFilter(c); setFilterOpen(false); }}
                                className={`w-full px-3 py-2 text-left text-sm ${filter === c ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                                {c === "all" ? t("allCategories") : CATEGORY_LABEL[c][lang]}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <button type="button" onClick={newSearch} className="btn-primary">{t("newSearch")}</button>
                    <button type="button" onClick={exportData} className="btn-accent">{t("exportData")}</button>
                  </div>
                </div>
              </form>
            </section>

            <div className="mt-6 flex items-center justify-between">
              <div className="flex">
                {(["overview", "list", "summary"] as Tab[]).map((k) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`w-36 border-2 border-primary px-4 py-2 text-sm -ml-[2px] first:ml-0 ${tab === k ? "bg-primary text-primary-foreground" : "bg-card"}`}>
                    {t(k)}
                  </button>
                ))}
              </div>
            </div>

            {tab === "overview" && res && (
              <>
                <section className="grid border-2 border-primary bg-primary md:grid-cols-[1fr_340px]">
                  <div className="relative bg-card">
                    <MapView lat={sub.place.lat} lon={sub.place.lon} polygon={building?.polygon ?? null} />
                    {(bLoading || (!building && !bLoading)) && (
                      <div className="absolute bottom-2 left-2 z-[500] bg-card px-2 py-1 text-xs">
                        {bLoading ? t("loadingBuilding") : t("mapNoBuilding")}
                      </div>
                    )}
                  </div>
                  <div className="p-5 text-primary-foreground">
                    <h2 className="mb-4 flex items-center gap-3 text-2xl font-semibold uppercase">
                      {t("yourLaws")}
                      <span className="inline-flex h-7 w-7 items-center justify-center bg-accent text-accent-foreground">?</span>
                    </h2>
                    <ul className="space-y-3 text-sm">
                      {res.top.map(({ category, entry }) => (
                        <li key={category} className={entry?.status === "unknown" ? "flex items-start justify-between gap-2 bg-accent p-2 text-accent-foreground" : ""}>
                          <div>
                            <div className="text-xs uppercase opacity-80">{CATEGORY_LABEL[category][lang]}</div>
                            {entry ? (
                              <>
                                <div>{entry.law.title[lang]}</div>
                                <button onClick={() => setEvidenceId(entry.law.id)} className="text-left italic underline">[{entry.law.lawNo}]</button>
                                {entry.conflict && <div className="text-xs font-semibold">⚠ {t("humanReview")}</div>}
                              </>
                            ) : (
                              <div className="italic opacity-80">—</div>
                            )}
                          </div>
                          {entry?.status === "unknown" && <span className="text-2xl font-bold">!</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-xs">{t("retrievedAt")}: {retrievedAt}</p>
                  </div>
                </section>

                <StreetView lat={sub.place.lat} lon={sub.place.lon} />


                <section className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 border-2 border-primary bg-card px-4 py-3 text-sm" aria-label={t("jurisdictionStack")}>
                  <span className="mr-2 text-xs font-semibold uppercase">{t("jurisdictionStack")}:</span>
                  {res.jurisdictions.map((j, i) => (
                    <span key={j.level} className="flex items-center gap-2">
                      {i > 0 && <ChevronRight className="h-4 w-4" />}
                      <span className={j.names.length ? "bg-primary px-2 py-0.5 text-primary-foreground" : "border border-dashed border-primary px-2 py-0.5 opacity-60"}>
                        <span className="text-xs opacity-80">{t(j.level === 0 ? "federal" : j.level === 1 ? "state" : "local")}: </span>
                        {j.names.length ? j.names.join(", ") : [sub.place.county, sub.place.district || sub.place.city].filter(Boolean).join(" / ") || "—"}
                      </span>
                    </span>
                  ))}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs uppercase">{t("overallConfidence")}:</span>
                    <ConfidenceBadge c={res.overall >= 0.75 ? "high" : res.overall >= 0.5 ? "medium" : "low"} score={res.overall} />
                    <button type="button" onClick={() => setConfInfo((v) => !v)}
                      className="ml-1 border border-primary px-2 py-0.5 text-xs underline hover:bg-muted">
                      {t("confHow")}
                    </button>
                  </span>
                </section>
                {confInfo && (
                  <section className="mt-1 border-2 border-primary bg-card p-4 text-sm" aria-label={t("confHow")}>
                    <h3 className="mb-2 text-sm font-semibold uppercase">{t("confHow")}</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>{t("confExplSource")}</li>
                      <li>{t("confExplDeduct")}</li>
                      <li>{t("confExplBand")}</li>
                      <li>{t("confExplOverall")}</li>
                    </ul>
                  </section>
                )}

                {res.conflicts.length > 0 && (
                  <section className="mt-6 border-2 border-destructive bg-card p-4" role="alert">
                    <h2 className="mb-2 text-lg font-semibold uppercase text-destructive">⚠ {t("conflicts")}</h2>
                    {res.conflicts.map((c) => (
                      <div key={c.a.id + c.b.id} className="mb-2 text-sm">
                        <button className="underline" onClick={() => setEvidenceId(c.a.id)}>{c.a.title[lang]} ({c.a.jurisdiction})</button>
                        {" ⟷ "}
                        <button className="underline" onClick={() => setEvidenceId(c.b.id)}>{c.b.title[lang]} ({c.b.jurisdiction})</button>
                        <p className="mt-1">{c.note[lang]}</p>
                      </div>
                    ))}
                  </section>
                )}

                <section className="mt-10">
                  <h2 className="section-title mb-1">{t("checkAll")}</h2>
                  <p className="mb-4 text-sm opacity-80">{t("clickEvidence")}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-primary text-primary-foreground">
                          {(["category", "lawNo", "description", "status", "confidence", "source", "retrievedAt"] as TKey[]).map((h) => (
                            <th key={h} className="border-2 border-primary px-3 py-2 text-left font-normal">{t(h)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {CATEGORIES.flatMap((c) => {
                          const rows = res.all.filter((e) => e.law.category === c);
                          if (!rows.length)
                            return [
                              <tr key={c}>
                                <td className="border-2 border-primary px-3 py-2">{CATEGORY_LABEL[c][lang]}</td>
                                <td className="border-2 border-primary px-3 py-2">—</td>
                                <td className="border-2 border-primary px-3 py-2" colSpan={5}>{t("noLawFound")}</td>
                              </tr>,
                            ];
                          return rows.map((e) => {
                            const weak = WEAK_SOURCE[sourceTypeOf(e.law)];
                            return (
                              <tr key={e.law.id} onClick={() => setEvidenceId(e.law.id)} tabIndex={0}
                                onKeyDown={(ev) => ev.key === "Enter" && setEvidenceId(e.law.id)}
                                className={`cursor-pointer hover:bg-muted ${["notApplicable", "failed"].includes(e.status) ? "opacity-60" : ""}`}>
                                <td className="border-2 border-primary px-3 py-2">{CATEGORY_LABEL[c][lang]}</td>
                                <td className="border-2 border-primary px-3 py-2">{e.law.lawNo}<div className="text-xs opacity-70">{e.law.jurisdiction}</div></td>
                                <td className="border-2 border-primary px-3 py-2">
                                  <strong>{e.law.title[lang]}.</strong> {e.law.desc[lang]}
                                  {weak && <div className="mt-1 text-xs text-destructive">⚠ {t("weakSource")}: {weak[lang]}</div>}
                                  {e.conflict && <div className="mt-1 text-xs font-semibold text-destructive">⚠ {t("humanReview")}</div>}
                                </td>
                                <td className="border-2 border-primary px-3 py-2"><StatusBadge s={e.status} /></td>
                                <td className="border-2 border-primary px-3 py-2"><ConfidenceBadge c={e.confidence} score={e.score} /></td>
                                <td className="border-2 border-primary px-3 py-2"><a href={e.law.source.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="underline">{e.law.source.name}</a></td>
                                <td className="border-2 border-primary px-3 py-2 text-xs">{retrievedAt}</td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mt-10">
                  <h2 className="section-title mb-3 flex items-center gap-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center bg-accent text-accent-foreground">!</span>{t("changes")}
                  </h2>
                  {res.future.length ? res.future.map((f) => (
                    <p key={f.law.id + f.kind} className="mb-3">
                      <StatusBadge s={f.kind === "starts" ? "notYetEffective" : "applicable"} />{" "}
                      <strong>"{f.law.title[lang]}"</strong> ({f.law.lawNo}) {f.kind === "starts" ? t("willApply") : t("willEnd")} {f.on} {t("accordingTo")}{" "}
                      <a href={f.law.source.url} target="_blank" rel="noreferrer" className="underline">{f.law.source.name}</a>
                    </p>
                  )) : <p>{t("noFuture")}</p>}
                  {res.proposals.length > 0 && (
                    <>
                      <h3 className="mb-2 mt-6 font-semibold">{t("proposals")}</h3>
                      {res.proposals.map((e) => (
                        <p key={e.law.id} className="mb-2">
                          <StatusBadge s={e.status} />{" "}
                          <button className="font-semibold underline" onClick={() => setEvidenceId(e.law.id)}>{e.law.title[lang]}</button> ({e.law.lawNo}) — {e.law.desc[lang]}
                        </p>
                      ))}
                    </>
                  )}
                </section>

                <section className="mt-10">
                  <h2 className="section-title mb-3 flex items-center gap-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center bg-accent text-accent-foreground">?</span>{t("missing")}
                  </h2>
                  {res.missing.length ? (
                    <>
                      <p>{t("missingIntro")}</p>
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-left">
                        {res.missing.map((k) => <li key={k}>{t(`q_${k}` as TKey)}</li>)}
                      </ul>
                      <p className="mt-2">{t("missingBetter")}</p>
                      <button onClick={() => setQuiz(true)} className="btn-primary mt-4">{t("fillIn")}</button>
                    </>
                  ) : (
                    <>
                      <p>{t("noMissing")}</p>
                      <button onClick={() => setQuiz(true)} className="mt-3 text-sm underline">{t("fillIn")}</button>
                    </>
                  )}
                </section>
              </>
            )}

            {tab === "list" && (
              <section className="pb-6">
                <div className="flex items-stretch">
                  <div className="flex-1 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-primary text-primary-foreground">
                          <th className="border-2 border-primary px-3 py-2 font-normal">{t("address")}</th>
                          <th className="border-2 border-primary px-3 py-2 font-normal">{t("zip")}</th>
                          <th className="border-2 border-primary px-3 py-2 font-normal">{t("built")}</th>
                          <th className="border-2 border-primary px-3 py-2 font-normal">{t("lawsRelevant")}</th>
                          {(filter === "all" ? CATEGORIES : [filter]).map((c) => (
                            <th key={c} className="border-2 border-primary px-3 py-2 text-xs font-normal">{CATEGORY_LABEL[c][lang]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 && <tr><td colSpan={10} className="border-2 border-primary px-3 py-6 text-center">{t("noHistory")}</td></tr>}
                        {history.map((h) => {
                          const d = `${sliderYear}${(sub.date || "2026-01-01").slice(4)}`;
                          const r = resolveLaws(h.place, d, h.facts);
                          const rel = r.active.filter((e) => e.status !== "notApplicable" && (filter === "all" || e.law.category === filter));
                          return (
                            <tr key={h.place.id} className={h.place.id === sub.place.id ? "bg-muted" : ""}>
                              <td className="border-2 border-primary px-3 py-2">{h.place.housenumber} {h.place.street}, {h.place.city ?? h.place.district}</td>
                              <td className="border-2 border-primary px-3 py-2 text-center">{h.place.postcode}</td>
                              <td className="border-2 border-primary px-3 py-2 text-center">{h.facts.yearBuilt ?? "?"}</td>
                              <td className="border-2 border-primary px-3 py-2 text-center font-semibold">{rel.length}</td>
                              {(filter === "all" ? CATEGORIES : [filter]).map((c) => (
                                <td key={c} className="border-2 border-primary px-3 py-2 text-center">{rel.filter((e) => e.law.category === c).length}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ChevronRight className="h-10 w-10 self-center" />
                </div>
                <div className="mt-8">
                  <div className="mb-2 flex justify-between text-sm"><span>{t("evalDate")}</span><strong>{sliderYear}</strong></div>
                  <input type="range" min={2015} max={2032} value={sliderYear} onChange={(e) => setSliderYear(Number(e.target.value))}
                    className="w-full accent-accent" aria-label={t("evalDate")} />
                  <div className="flex justify-between text-xs opacity-70"><span>2015</span><span>2032</span></div>
                </div>
              </section>
            )}

            {tab === "summary" && res && (
              <SummaryView
                place={sub.place}
                date={sub.date}
                facts={facts}
                building={building}
                res={res}
                retrievedAt={retrievedAt}
                onEvidence={setEvidenceId}
              />
            )}
          </>
        )}
      </main>
      {!sub && <Skyline />}
      <footer className={`${sub ? "mt-auto" : ""} flex justify-end gap-4 bg-primary px-6 py-3 text-sm text-primary-foreground`}><span className="font-semibold">LEXRENT</span></footer>
      {evidenceId && sub && res && (() => {
        const e = res.all.find((x) => x.law.id === evidenceId);
        return e ? <EvidenceModal entry={e} place={sub.place} date={sub.date} facts={facts} retrievedAt={retrievedAt} onClose={() => setEvidenceId(null)} /> : null;
      })()}
      {quiz && (
        <Quiz
          keys={quizKeys.length ? quizKeys : CORE_FACTS}
          onClose={() => setQuiz(false)}
          onDone={(f) => { updateFacts(f); setQuiz(false); }}
        />
      )}
    </div>
  );
}
