"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/lovable/site-header";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Bookmark, BookOpen, Building2, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, Code2, Copy, ExternalLink, FileCheck2, FileText, Filter, FolderOpen, GitCompareArrows, Home, Layers3, LayoutDashboard, LoaderCircle, LockKeyhole, MapPin, Menu, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, UsersRound, X } from "lucide-react";

type View = "dashboard" | "properties" | "changes" | "sources" | "saved" | "assistant" | "admin";
type Property = { address_id: string; street_address: string; postal_city: string; state: string; zip: string; year_built: number | null; units: number | null; use_description?: string; source_dataset?: string; retrieved_at?: string; legal_city_candidate?: string; missing_facts?: string[]; quality_flags?: string[] };
type Source = { doc_id: string; jurisdictions: string; url: string; source_type: string; capture?: string; retrieved_at?: string; status?: string; sha256?: string; text_file?: string; captured?: boolean; text?: string };
type Rule = { team_rule_id: string; title: string; category: string; jurisdiction: string; level: string; status: string; requirement: string; key_value?: string | null; citation: string; source_doc_id?: string; source_url: string; quoted_span: string; effective_date?: string; exemptions?: string; conflict_note?: string };
type Result = { team_rule_id: string; result: string; explanation: string; conflict_flag?: boolean; missing_facts?: string[]; rule?: Rule; evidence?: { quoted_span?: string; source_doc_id?: string; doc_id?: string; retrieved_at?: string; sha256?: string; start_offset?: number; end_offset?: number; source_url?: string } };
type Lookup = { property?: Property; address?: Property; as_of: string; rules?: Result[]; results?: Result[]; missing_facts?: string[]; notices?: string[]; notes?: string[]; rule_count?: number; coverage_complete?: boolean; jurisdiction?: { state: string; city?: string | null; candidate_city?: string; verified: boolean; method?: string } };
type Test = { test_id: string; title: string; type: string; expected_behavior: string; as_of?: string; as_of_before?: string; as_of_after?: string; states?: string[]; rule_ids?: string[] };
type User = { id: string; email: string; name?: string };
type Counts = { properties?: number; sources?: number; captured_sources?: number; rules?: number; jurisdictions?: number; cities?: number };
type Capabilities = { ai?: { configured?: boolean }; auth?: { configured?: boolean }; database?: { configured?: boolean } };
type ChatCitation = { doc_id: string; url?: string; source_url?: string; quoted_span: string; retrieved_at?: string };
type ChatRetrieval = { mode: "hybrid_vector" | "lexical_fallback"; vector_status: "ready" | "not_indexed" | "unavailable" | "empty_query" };
type ChatMessage = { role: "user" | "assistant"; content: string; citations?: ChatCitation[]; missing_facts?: string[]; as_of?: string; retrieval?: ChatRetrieval; notices?: string[] };

const categories = [
  { id: "rent_increase_limits", label: "Rent increases", description: "Caps, formulas & annual adjustments", icon: Home, color: "green" },
  { id: "just_cause_eviction", label: "Eviction protections", description: "Just cause, notice & relocation", icon: ShieldCheck, color: "blue" },
  { id: "security_deposits", label: "Security deposits", description: "Limits, returns & exceptions", icon: LockKeyhole, color: "sand" },
  { id: "application_screening_fees", label: "Application fees", description: "Screening costs & refund requirements", icon: FileCheck2, color: "purple" },
  { id: "screening_restrictions", label: "Fair screening", description: "Access, background checks & discrimination", icon: UsersRound, color: "peach" },
  { id: "algorithmic_rent_setting", label: "Algorithmic pricing", description: "Rent-setting software & restrictions", icon: Code2, color: "mint" },
];

const navigation: { id: View; label: string; icon: typeof Home; section?: string }[] = [
  { id: "changes", label: "Law changes", icon: GitCompareArrows },
  { id: "sources", label: "Source library", icon: BookOpen },
  { id: "saved", label: "Saved properties", icon: Bookmark },
  { id: "assistant", label: "Ask LEXRENT", icon: Sparkles },
  { id: "admin", label: "Rule workspace", icon: SlidersHorizontal, section: "MANAGE" },
];

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status}).`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
function normalizeCounts(value: unknown): Counts {
  const data = value as Record<string, unknown>;
  const counts = (data.counts || data) as Record<string, number | undefined>;
  return { properties: counts.properties ?? counts.property_count, sources: counts.sources ?? counts.source_count, captured_sources: counts.captured_sources ?? counts.captured_source_count, rules: counts.rules ?? counts.verified_rule_count, jurisdictions: counts.jurisdictions };
}
function readable(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
function formattedDate(value?: string) { if (!value) return "Not recorded"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
function shortSource(source: Source) { try { return new URL(source.url).hostname.replace(/^www\./, ""); } catch { return source.url; } }
function sourceName(source: Source) {
  try {
    const url = new URL(source.url);
    if (url.hostname === "leginfo.legislature.ca.gov") {
      const code = url.searchParams.get("lawCode"), section = url.searchParams.get("sectionNum");
      const names: Record<string, string> = { CIV: "California Civil Code", GOV: "California Government Code" };
      if (code && section) return `${names[code] || `California ${code} Code`} § ${section}`;
      const bill = url.searchParams.get("bill_id")?.match(/([A-Z]{1,3})(\d+)$/);
      if (bill) return `California ${bill[1]} ${Number(bill[2])}`;
    }
    if (url.hostname.replace(/^www\./, "") === "malegislature.gov") {
      const law = decodeURIComponent(url.pathname).match(/\/GeneralLaws\/.*\/Chapter([^/]+)\/Section([^/]+)/i);
      if (law) return `Massachusetts General Laws ch. ${law[1]} § ${law[2]}`;
    }
    const slug = url.pathname.split("/").filter(Boolean).pop() || "Source document";
    return decodeURIComponent(slug).replace(/\.(pdf|x?html?|txt)$/i, "").replace(/[-_]/g, " ");
  } catch { return source.doc_id; }
}
function captured(source: Source) { return source.captured ?? Boolean(source.text_file); }

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { applies: "Applies", unknown: "Unknown", superseded: "Superseded", not_yet_effective: "Not yet effective", not_evaluated: "Not evaluated", needs_review: "Needs review", evaluated: "Evaluated", pending: "Pending", in_force: "In force", failed: "Failed", captured: "Text available", "link-only": "Link only" };
  return <span className={`status status-${value.replaceAll("_", "-")}`}><span />{labels[value] || value}</span>;
}

function Empty({ icon: Icon = FolderOpen, title, children, action }: { icon?: typeof Home; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={23} strokeWidth={1.5} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}

function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return <div className="error-banner" role="alert"><CircleHelp size={17} /><span>{message}</span>{onClose && <button className="icon-button" aria-label="Dismiss error" onClick={onClose}><X size={16} /></button>}</div>;
}

function AnswerText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part)}</>;
}

function ChangeOutcome({ data }: { data: Record<string, unknown> }) {
  const affected = Array.isArray(data.affected_address_ids) ? data.affected_address_ids as string[] : [];
  const unresolved = Array.isArray(data.unresolved_address_ids) ? data.unresolved_address_ids as string[] : [];
  const conflicts = Array.isArray(data.conflict_flag_address_ids) ? data.conflict_flag_address_ids as string[] : [];
  const missing = Array.isArray(data.missing_rule_ids) ? data.missing_rule_ids as string[] : [];
  const state = String(data.evaluation_status || "evaluated");
  return <div className="change-result"><div className="small-heading"><FileCheck2 size={16} />Evaluated outcome<Status value={state} /></div><p className="change-outcome-note">{typeof data.notes === "string" ? data.notes : state === "not_evaluated" ? "This case has not been evaluated against imported rules." : "Review the result alongside the source evidence and known property facts."}</p><div className="outcome-stats"><div><strong>{affected.length}</strong><span>Evaluated affected</span></div><div><strong>{unresolved.length}</strong><span>Need review</span></div><div><strong>{conflicts.length}</strong><span>Conflict flags</span></div></div>{typeof data.expected_address_count === "number" && <p className="helper-text">Fixture expectation: {data.expected_address_count} addresses. This is a test target, separate from the evaluated affected set.</p>}{missing.length > 0 && <div className="missing-rule-notice"><strong>Rules still needed</strong><div>{missing.map(id => <code key={id}>{id}</code>)}</div></div>}{affected.length > 0 && <details className="outcome-details"><summary>Inspect affected property IDs ({affected.length})</summary><div className="property-id-list">{affected.map(id => <code key={id}>{id}</code>)}</div></details>}<details className="outcome-details"><summary>View evaluation record</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></div>;
}

function Drawer({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab" && dialog.current) {
        const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')).filter(item => item.getClientRects().length > 0);
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  return <div className="drawer-layer"><button className="drawer-backdrop" aria-label="Close details" onClick={onClose} /><div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1} ref={dialog}><div className="drawer-heading"><div>{subtitle && <span className="eyebrow">{subtitle}</span>}<h2 id="drawer-title">{title}</h2></div><button className="icon-button" aria-label="Close details" onClick={onClose}><X size={21} /></button></div><div className="drawer-content">{children}</div></div></div>;
}

export default function ResearchWorkspace() {
  const [view, setView] = useState<View>("assistant");
  const [mobileNav, setMobileNav] = useState(false);
  const [asOf, setAsOf] = useState("2026-10-01");
  const [counts, setCounts] = useState<Counts>({});
  const [selected, setSelected] = useState<Property | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sourceDetail, setSourceDetail] = useState<Source | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [tests, setTests] = useState<Test[]>([]);
  const [activeTest, setActiveTest] = useState("T1");
  const [changeResult, setChangeResult] = useState<Record<string, unknown> | null>(null);
  const [changeLoading, setChangeLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [saved, setSaved] = useState<Property[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importText, setImportText] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [extractIds, setExtractIds] = useState<string[]>([]);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractProgress, setExtractProgress] = useState("");
  const [extractWarnings, setExtractWarnings] = useState<string[]>([]);
  const [captureDoc, setCaptureDoc] = useState("");
  const [captureUrl, setCaptureUrl] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [captureDate, setCaptureDate] = useState("");
  const [captureLoading, setCaptureLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatCitation, setChatCitation] = useState<ChatCitation | null>(null);
  const sourceGeneration = useRef(0);
  const changeGeneration = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const chatGeneration = useRef(0);

  useEffect(() => {
    let live = true;
    Promise.allSettled([
      request<{ counts?: Counts }>("/api/dashboard"),
      request<{ sources?: Source[] } | Source[]>("/api/sources"),
      request<{ tests?: Test[] } | Test[]>("/api/changes"),
      request<{ user: User | null; auth_configured: boolean; is_admin: boolean }>("/api/me"),
      request<Capabilities>("/api/capabilities"),
    ]).then(([dashboard, library, changes, account, capability]) => {
      if (!live) return;
      if (dashboard.status === "fulfilled") setCounts(normalizeCounts(dashboard.value));
      if (library.status === "fulfilled") setSources(Array.isArray(library.value) ? library.value : library.value.sources || []);
      if (changes.status === "fulfilled") setTests(Array.isArray(changes.value) ? changes.value : changes.value.tests || []);
      if (account.status === "fulfilled") { setUser(account.value.user); setAuthConfigured(account.value.auth_configured); setIsAdmin(account.value.is_admin); }
      if (capability.status === "fulfilled") setCapabilities(capability.value);
      if (dashboard.status === "rejected") setError(dashboard.reason.message);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("view");
    if (requested && navigation.some(item => item.id === requested)) setView(requested as View);
    const date = params.get("as_of");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setAsOf(date);
    const id = params.get("address_id");
    if (!id) return;
    let live = true;
    request<{properties: Property[]}>(`/api/properties?${new URLSearchParams({q:id,limit:"1"})}`).then(data => {
      const found = data.properties.find(property => property.address_id === id);
      if (live && found) setSelected(found);
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const loadSaved = useCallback(async () => {
    if (!user) return;
    try { const data = await request<{ saved: (Property | { property: Property })[] }>("/api/saved"); setSaved(data.saved.map(item => "property" in item ? item.property : item)); } catch (e) { setError((e as Error).message); }
  }, [user]);
  useEffect(() => { void loadSaved(); }, [loadSaved]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    chatGeneration.current += 1;
    setChatMessages([]); setChatError(""); setChatLoading(false); setChatCitation(null);
  }, [selected?.address_id, asOf]);
  useEffect(() => { changeGeneration.current += 1; setChangeResult(null); setChangeLoading(false); }, [activeTest]);
  useEffect(() => () => { sourceGeneration.current += 1; changeGeneration.current += 1; chatGeneration.current += 1; }, []);
  useEffect(() => { if (view === "assistant" && chatMessages.length) chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [chatMessages, chatLoading, view]);

  function navigate(next: View) {
    if (next === "properties" || next === "dashboard") { window.location.assign(selected ? `/?${new URLSearchParams({ address_id: selected.address_id, as_of: asOf })}` : "/"); return; }
    setView(next); setMobileNav(false); setError("");
    const params = new URLSearchParams({ view: next, as_of: asOf });
    if (selected) params.set("address_id", selected.address_id);
    window.history.replaceState(null, "", `/workspace?${params}`);
  }
  function selectProperty(property: Property) { window.location.assign(`/?${new URLSearchParams({ address_id: property.address_id, as_of: asOf })}`); }
  async function saveProperty(property: Property) {
    if (!user) { setNotice("Sign in to keep your saved properties across visits."); return; }
    const existing = saved.some(item => item.address_id === property.address_id);
    try { await request("/api/saved", { method: existing ? "DELETE" : "POST", body: JSON.stringify({ address_id: property.address_id }) }); await loadSaved(); setNotice(existing ? "Property removed from saved." : "Property saved to your workspace."); } catch (e) { setError((e as Error).message); }
  }
  function closeSource() { sourceGeneration.current += 1; setSourceDetail(null); setSourceLoading(false); }
  async function openSource(source: Source) {
    const generation = ++sourceGeneration.current;
    setSourceDetail(source); setSourceLoading(true);
    try {
      const data = await request<{ source?: Source; text?: string } & Partial<Source>>(`/api/sources/${source.doc_id}`);
      if (generation === sourceGeneration.current) setSourceDetail({ ...source, ...(data.source || data), text: data.text || data.source?.text });
    } catch (e) { if (generation === sourceGeneration.current) setError((e as Error).message); }
    finally { if (generation === sourceGeneration.current) setSourceLoading(false); }
  }
  async function evaluateChange() {
    const generation = ++changeGeneration.current;
    setChangeLoading(true); setChangeResult(null);
    try { const result = await request<Record<string, unknown>>(`/api/changes/${activeTest}`, post({ as_of: asOf })); if (generation === changeGeneration.current) setChangeResult(result); }
    catch (e) { if (generation === changeGeneration.current) setError((e as Error).message); }
    finally { if (generation === changeGeneration.current) setChangeLoading(false); }
  }
  async function importRules() {
    setImportLoading(true);
    try { const parsed = JSON.parse(importText); const body = Array.isArray(parsed) ? { rules: parsed } : parsed; if (!Array.isArray(body.rules)) throw new Error("Provide a rule array or an object with a rules array and optional ruleLogic."); const result = await request<{ count?: number; imported?: number; message?: string }>("/api/admin/rules", post(body)); setNotice(result.message || `${result.imported ?? result.count ?? body.rules.length} rules imported. Evidence and coverage are ready for review.`); const dashboard = await request<{ counts: Counts }>("/api/dashboard"); setCounts(normalizeCounts(dashboard)); } catch (e) { setError((e as Error).message); } finally { setImportLoading(false); }
  }
  async function extractRules() {
    setExtractLoading(true); setExtractWarnings([]); setError("");
    const accumulated = new Map<string, Rule>();
    const logic: Record<string, unknown> = {};
    const warnings: string[] = [];
    let completed = 0;
    try {
      for (const docId of extractIds) {
        let chunk = 0;
        const visited = new Set<number>();
        while (true) {
          if (visited.has(chunk)) throw new Error("The extraction server returned a repeated chunk. Your completed drafts have been preserved.");
          visited.add(chunk);
          setExtractProgress(`Document ${completed + 1} of ${extractIds.length} · ${docId} · reading chunk ${chunk + 1}`);
          const result = await request<{ bundle?: { rules: Rule[]; ruleLogic: Record<string, unknown> }; rules?: Rule[]; ruleLogic?: Record<string, unknown>; next_chunk: number | null; total_chunks: number; warnings?: string[] }>("/api/ai/extract", post({ doc_ids: [docId], chunk }));
          for (const rule of result.bundle?.rules || result.rules || []) {
            if (accumulated.has(rule.team_rule_id)) warnings.push(`${docId}: ${rule.team_rule_id} appeared in more than one chunk. The latest draft is retained; compare the complete source before importing.`);
            accumulated.set(rule.team_rule_id, rule);
          }
          Object.assign(logic, result.bundle?.ruleLogic || result.ruleLogic || {});
          warnings.push(...(result.warnings || []).map(warning => `${docId}: ${warning}`));
          setImportText(JSON.stringify({ rules: [...accumulated.values()], ruleLogic: logic }, null, 2));
          setExtractWarnings([...new Set(warnings)]);
          setExtractProgress(`Document ${completed + 1} of ${extractIds.length} · ${docId} · chunk ${chunk + 1} of ${result.total_chunks} complete · ${accumulated.size} draft rules`);
          if (result.next_chunk === null || result.next_chunk === undefined) break;
          chunk = result.next_chunk;
        }
        completed += 1;
      }
      setNotice(`${accumulated.size} draft rules extracted from ${completed} sources. Review the JSON and supporting quotations before importing. No rules have been published.`);
    } catch (e) { setError((e as Error).message); } finally { setExtractLoading(false); }
  }
  async function uploadCapture(event: React.FormEvent) {
    event.preventDefault(); setCaptureLoading(true);
    try {
      await request(`/api/admin/sources/${captureDoc}`, post({ text: captureText, source_url: captureUrl, retrieved_at: new Date(`${captureDate}Z`).toISOString() }));
      const data = await request<{ sources: Source[] }>("/api/sources"); setSources(data.sources);
      const dashboard = await request<{ counts: Counts }>("/api/dashboard"); setCounts(normalizeCounts(dashboard));
      setCaptureText(""); setNotice(`${captureDoc} captured text saved with its source URL and retrieval date.`);
    } catch (e) { setError((e as Error).message); } finally { setCaptureLoading(false); }
  }
  async function askLexrent(event?: React.FormEvent, suggested?: string) {
    event?.preventDefault();
    const question = (suggested || chatQuestion).trim();
    if (!question || chatLoading || !user || !capabilities.ai?.configured) return;
    const history = chatMessages.slice(-6).map(message => ({ role: message.role, content: message.content.slice(0, 3000) }));
    const generation = chatGeneration.current;
    setChatQuestion(""); setChatError(""); setChatLoading(true);
    setChatMessages(previous => [...previous, { role: "user", content: question, as_of: asOf }]);
    try {
      const result = await request<{ answer: string; citations: ChatCitation[]; missing_facts: string[]; as_of: string; retrieval?: ChatRetrieval; notices?: string[] }>("/api/ai/chat", post({ question, address_id: selected?.address_id, as_of: asOf, history }));
      if (generation === chatGeneration.current) setChatMessages(previous => [...previous, { role: "assistant", content: result.answer, citations: result.citations, missing_facts: result.missing_facts, as_of: result.as_of, retrieval: result.retrieval, notices: result.notices }]);
    } catch (e) {
      if (generation !== chatGeneration.current) return;
      setChatError((e as Error).message); setChatQuestion(question);
      setChatMessages(previous => previous[previous.length - 1]?.role === "user" && previous[previous.length - 1]?.content === question ? previous.slice(0, -1) : previous);
    } finally { if (generation === chatGeneration.current) setChatLoading(false); }
  }

  const visibleSources = sources.filter(source => `${source.doc_id} ${source.jurisdictions} ${source.url} ${source.source_type}`.toLowerCase().includes(sourceQuery.toLowerCase())).filter(source => sourceFilter === "all" || (sourceFilter === "captured" ? captured(source) : !captured(source)));
  const currentTest = tests.find(test => test.test_id === activeTest);
  const title: Record<View, string> = { dashboard: "Your housing law workspace", properties: "Property explorer", changes: "Law changes", sources: "Source library", saved: "Saved properties", assistant: "Ask LEXRENT", admin: "Rule workspace" };

  return <div className="app-shell">
    <SiteHeader />
    <main className="main-workspace">
      <header className="workspace-toolbar"><button className="icon-button mobile-menu" aria-label={mobileNav ? "Close navigation" : "Open navigation"} aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={21} /> : <Menu size={21} />}</button><nav className={`workspace-navigation ${mobileNav ? "navigation-open" : ""}`} aria-label="Workspace navigation">{navigation.map(item => <button key={item.id} className={`workspace-nav-item ${view === item.id ? "active" : ""}`} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><item.icon size={16} strokeWidth={1.7} /><span>{item.label}</span>{item.id === "saved" && saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button>)}</nav><label className="date-control"><CalendarDays size={15} /><span>As of</span><input type="date" value={asOf} onChange={event => { if (event.target.value) setAsOf(event.target.value); }} aria-label="Query date" /></label></header>
      <div className={`page-content view-${view}`}>
        {error && <ErrorBanner message={error} onClose={() => setError("")} />}
        {notice && <div className="notice-banner" role="status"><CheckCircle2 size={17} />{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={15} /></button></div>}

        <div className="mb-8 border-b-2 border-primary pb-4"><h1 className="text-3xl font-semibold uppercase">{title[view]}</h1><p className="mt-2 text-sm text-muted-foreground">{({ sources: "Read the original documents behind the housing rules.", changes: "Compare challenge expectations with evaluated law-change outcomes.", saved: "Your private saved list. Open an address to return to its overview.", assistant: "Research the captured source corpus with exact supporting quotations.", admin: "Review source captures, rule drafts and coverage before publication.", properties: "Search a property on the address-first home.", dashboard: "Search your rental housing rights." })[view]}</p><a href="/" className="mt-3 inline-block text-sm underline">Search an address →</a></div>
        {view === "changes" && <><div className="information-banner"><CircleHelp size={18} /><p><strong>Expectations are test fixtures.</strong> They describe the challenge’s intended behavior. Evaluated outcomes require imported rules, effective dates, and jurisdiction evidence.</p></div><div className="changes-layout"><div className="change-test-list">{tests.map(test => <button key={test.test_id} className={`change-test-card ${activeTest === test.test_id ? "selected" : ""}`} onClick={() => { setActiveTest(test.test_id); setChangeResult(null); }}><span className="test-number">{test.test_id}</span><div><span className="eyebrow">{test.type.replaceAll("_", " ")}</span><h3>{test.title}</h3><span>{test.states?.join(" · ") || "City boundary comparison"}</span></div><ChevronRight size={17} /></button>)}</div><section className="panel change-detail">{currentTest ? <><div className="change-detail-heading"><span className="test-number">{currentTest.test_id}</span><span className="subtle-label">SUPPLIED CHANGE CASE</span></div><h2>{currentTest.title}</h2><div className="fixture-box"><span className="small-heading">Fixture expectation</span><p>{currentTest.expected_behavior}</p></div>{(currentTest.as_of_before || currentTest.as_of_after) && <div className="change-date-comparison"><div><span>Before</span><strong>{formattedDate(currentTest.as_of_before)}</strong></div><ArrowRight size={18} /><div><span>After</span><strong>{formattedDate(currentTest.as_of_after)}</strong></div></div>}<div className="change-rule-ids"><span>Fixture rule IDs</span><div>{currentTest.rule_ids?.map(id => <code key={id}>{id}</code>)}</div></div><button className="button button-dark" disabled={changeLoading} onClick={() => void evaluateChange()}>{changeLoading ? <LoaderCircle className="spin" size={16} /> : <GitCompareArrows size={16} />}Evaluate imported rules</button><p className="helper-text">Evaluation uses the rules actually loaded into this workspace. Each case uses the supplied fixture dates shown here.</p>{changeResult && <ChangeOutcome data={changeResult} />}</> : <Empty icon={GitCompareArrows} title="Loading change cases">The five cases are read from the supplied challenge fixtures.</Empty>}</section></div></>}

        {view === "saved" && <section className="panel">{!user ? <Empty icon={Bookmark} title="Make room for your short list">Sign in to save properties and return to their evidence whenever you need it.<a className="button button-dark" href="/sign-in">Sign in<ArrowRight size={16} /></a>{!authConfigured && <span className="helper-text">Account access requires the workspace’s Neon Auth configuration.</span>}</Empty> : !saved.length ? <Empty icon={Bookmark} title="A clean slate">Save a property from the explorer to keep it here.<button className="button button-dark" onClick={() => navigate("properties")}>Explore properties<ArrowRight size={16} /></button></Empty> : <div className="saved-list">{saved.map(property => <div className="saved-row" key={property.address_id}><span className="property-icon"><Building2 size={21} /></span><button className="saved-address" onClick={() => selectProperty(property)}><strong>{property.street_address}</strong><span>{property.postal_city}, {property.state} {property.zip}</span></button><span className="source-id">{property.address_id}</span><button className="icon-button" aria-label={`Unsave ${property.street_address}`} onClick={() => void saveProperty(property)}><Bookmark size={19} fill="currentColor" /></button><button className="icon-button" aria-label={`Open ${property.street_address}`} onClick={() => selectProperty(property)}><ArrowUpRight size={18} /></button></div>)}</div>}</section>}

        {view === "assistant" && <div className="assistant-workspace"><section className="panel assistant-panel"><div className="assistant-panel-heading"><div><span className="assistant-small-mark"><Sparkles size={16} /></span><strong>LEXRENT Research Assistant</strong><span className="assistant-online"><span />{capabilities.ai?.configured ? "Source-grounded AI" : "AI connection needed"}</span></div>{chatMessages.length > 0 && <button className="text-button" disabled={chatLoading} onClick={() => { chatGeneration.current += 1; setChatMessages([]); setChatError(""); }}>New conversation<Plus size={13} /></button>}</div><div className="chat-messages" aria-live="polite" aria-relevant="additions text">{!chatMessages.length && <div className="assistant-welcome"><span className="assistant-orbit"><Sparkles size={29} strokeWidth={1.3} /></span><span className="eyebrow">LET’S FIND THE EVIDENCE</span><h2>A clearer question.<br />A better starting point.</h2><p>Ask about a requirement, compare source documents, or understand what facts are missing. I’ll work from the captured public corpus and show the supporting text.</p><div className="suggested-questions">{[{ title: "Understand coverage", question: selected ? "What facts are needed to determine which housing protections apply to this property? Cite the supplied sources and explain unknowns." : "What facts are needed to determine which housing protections apply to an apartment? Explain how state and city coverage differ, with sources." }, { title: "Compare the rules", question: "How do local rent increase rules interact with state rules in California? Use captured sources and explain exceptions or uncertain dates." }, { title: "Follow a change", question: "Which sources explain enacted and pending restrictions on algorithmic rent setting? Distinguish proposals, enacted law, and uncertain effective dates." }, { title: "Inspect the evidence", question: "What source-quality gaps could make a housing-law answer unreliable? Identify missing, outdated, or incomplete evidence in this corpus." }].map(suggestion => <button key={suggestion.title} disabled={chatLoading} onClick={() => setChatQuestion(suggestion.question)}><span>{suggestion.title}</span><ArrowUpRight size={14} /></button>)}</div></div>}{chatMessages.map((message, index) => <div key={index} className={`chat-message chat-${message.role}`}><span className="chat-avatar">{message.role === "assistant" ? <Layers3 size={17} /> : user?.name?.[0] || "Y"}</span><div className="chat-message-body"><div className="chat-message-label"><strong>{message.role === "assistant" ? "LEXRENT" : "You"}</strong>{message.as_of && <span>As of {message.as_of}</span>}</div><div className="chat-message-content"><AnswerText text={message.content} /></div>{message.retrieval && <div className="chat-retrieval"><Search size={12} /><span>{message.retrieval.mode === "hybrid_vector" ? "Topic + keyword source search" : "Keyword source search"}</span>{message.retrieval.mode === "lexical_fallback" && <small>{message.retrieval.vector_status === "ready" ? "Topic search found no matching current passages." : message.retrieval.vector_status === "not_indexed" ? "Topic search is still being prepared; keyword matches used." : message.retrieval.vector_status === "empty_query" ? "Topic search could not match this question; keyword matches used." : "Topic search was unavailable; keyword matches used."}</small>}</div>}{message.notices && message.notices.length > 0 && <details className="chat-research-notes"><summary>Research notes</summary><ul>{message.notices.map(note => <li key={note}>{note}</li>)}</ul></details>}{message.citations && message.citations.length > 0 && <div className="chat-citations"><span className="chat-citations-label"><BookOpen size={12} />Source evidence</span><div>{message.citations.map((citation, citationIndex) => <button key={`${citation.doc_id}-${citationIndex}`} onClick={() => setChatCitation(citation)}><span>{citationIndex + 1}</span>{citation.doc_id}<ArrowUpRight size={12} /></button>)}</div></div>}{message.missing_facts && message.missing_facts.length > 0 && <div className="chat-missing-facts"><div><CircleHelp size={13} /><strong>Facts or evidence still needed</strong></div><ul>{message.missing_facts.map(fact => <li key={fact}>{fact.replaceAll("_", " ")}</li>)}</ul></div>}</div></div>)}{chatLoading && <div className="chat-message chat-assistant"><span className="chat-avatar"><Layers3 size={17} /></span><div className="chat-message-body"><div className="chat-message-label"><strong>LEXRENT</strong></div><div className="chat-thinking"><LoaderCircle size={15} className="spin" />Reading the evidence and preparing an answer…</div></div></div>}<div ref={chatEnd} /></div>{chatError && <div className="chat-error"><ErrorBanner message={chatError} onClose={() => setChatError("")} /></div>}<div className="chat-composer-wrap">{!user ? <div className="chat-sign-in"><span><LockKeyhole size={16} /><strong>Sign in to ask LEXRENT</strong><small>Your account gives you access to the research assistant.</small></span><a className="button button-dark" href={`/sign-in?${new URLSearchParams({ next: `/workspace?${new URLSearchParams({ view: "assistant", as_of: asOf, ...(selected ? { address_id: selected.address_id } : {}) })}` })}`}>Sign in<ArrowRight size={15} /></a></div> : !capabilities.ai?.configured ? <div className="chat-sign-in"><span><CircleHelp size={16} /><strong>The AI connection isn’t configured</strong><small>Source and property exploration remain available.</small></span><button className="button button-outline" onClick={() => navigate("sources")}>Browse sources<ArrowRight size={15} /></button></div> : <form className="chat-composer" onSubmit={event => void askLexrent(event)}><textarea value={chatQuestion} onChange={event => setChatQuestion(event.target.value)} placeholder={selected ? `Ask about ${selected.street_address} or its source evidence…` : "Ask a question about housing rules or the captured sources…"} aria-label="Your question for LEXRENT" rows={2} maxLength={2500} disabled={chatLoading} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void askLexrent(); } }} /><div><span><BookOpen size={12} />{selected ? `${selected.address_id} · ${selected.state}` : "Captured source corpus"}<span className="composer-divider">·</span>{asOf}</span><button type="submit" className="chat-send" disabled={chatLoading || !chatQuestion.trim()} aria-label="Send question">{chatLoading ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={18} />}</button></div></form>}<p className="chat-disclaimer">AI research aid. Answers may be incomplete. Read the cited sources. Not legal advice.</p></div></section><aside className="assistant-context"><div className="panel assistant-context-card"><span className="eyebrow">YOUR RESEARCH CONTEXT</span><div className="small-heading"><MapPin size={15} />{selected ? "Selected property" : "Public source library"}</div>{selected ? <><h3>{selected.street_address}</h3><p>{selected.postal_city}, {selected.state} {selected.zip}</p><span className="source-id">{selected.address_id}</span><button className="text-button" onClick={() => navigate("properties")}>Inspect property<ArrowUpRight size={13} /></button></> : <><h3>State & city housing rules</h3><p>California, New Jersey, and Massachusetts. Select a property to add address context to your questions.</p><button className="text-button" onClick={() => navigate("properties")}>Choose a property<ArrowUpRight size={13} /></button></>}<div className="assistant-context-date"><CalendarDays size={14} /><div><span>Query date</span><strong>{formattedDate(asOf)}</strong></div></div></div><div className="assistant-principles"><ShieldCheck size={21} /><h3>A source is the starting point.</h3><p>The assistant uses captured documents. A missing fact, an unclear effective date, or a conflict should stay visible. Changing the property or date starts a new conversation.</p><div><FileText size={14} /><span>Inspect exact quotations</span></div><div><CircleHelp size={14} /><span>Keep unknowns explicit</span></div><div><Clock3 size={14} /><span>Check the applicable date</span></div><button className="text-button" onClick={() => navigate("sources")}>Open source library<ArrowRight size={13} /></button></div></aside></div>}

        {view === "admin" && <>{!isAdmin ? <section className="panel"><Empty icon={LockKeyhole} title="A workspace for verified evidence">Rule imports and AI extraction require a signed-in administrator. Public property and source exploration remains available.<a className="button button-dark" href="/sign-in">{user ? "Manage account" : "Sign in"}<ArrowRight size={16} /></a><span className="helper-text">{authConfigured ? "Admin access is assigned by the workspace administrator." : "Neon Auth is not configured for this environment."}</span></Empty></section> : <div className="admin-grid"><section className="panel admin-panel"><div className="section-heading"><div><span className="eyebrow">AUTOMATED EXTRACTION</span><h2>Read the sources. Build the rules.</h2></div><span className="category-icon color-purple"><Sparkles size={20} /></span></div><p className="muted">Select captured documents for Claude to extract structured, cited rule records. Review the returned evidence before relying on coverage.</p><div className={`capability-state ${capabilities.ai?.configured ? "configured" : ""}`}><span />{capabilities.ai?.configured ? "Claude extraction available" : "Anthropic API key is not configured"}</div><div className="extract-selection"><div><strong>{extractIds.length} selected</strong><button className="text-button" disabled={extractLoading} onClick={() => setExtractIds(extractIds.length ? [] : sources.filter(captured).map(source => source.doc_id))}>{extractIds.length ? "Clear selection" : "Select captured sources"}</button></div><div className="extract-source-list">{sources.filter(captured).map(source => <label key={source.doc_id}><input type="checkbox" checked={extractIds.includes(source.doc_id)} disabled={extractLoading} onChange={event => setExtractIds(event.target.checked ? [...extractIds, source.doc_id] : extractIds.filter(id => id !== source.doc_id))} /><span className="source-id">{source.doc_id}</span><span>{source.jurisdictions}</span><small>{shortSource(source)}</small></label>)}</div></div><button className="button button-dark" disabled={!capabilities.ai?.configured || !extractIds.length || extractLoading} onClick={() => void extractRules()}>{extractLoading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{extractLoading ? "Reading selected sources…" : "Extract rules"}</button><p className="helper-text">{extractLoading ? extractProgress || "Starting source extraction…" : "Credentials are configured on the server. This action creates drafts for human review and uses your configured model provider credits."}</p>{extractWarnings.length > 0 && <details className="outcome-details"><summary>Extraction review notes ({extractWarnings.length})</summary><ul className="extraction-warnings">{extractWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}</section><section className="panel admin-panel"><div className="section-heading"><div><span className="eyebrow">STRUCTURED RULE IMPORT</span><h2>Keep the evidence attached.</h2></div><span className="category-icon color-green"><FileCheck2 size={20} /></span></div><p className="muted">Review each quotation, exemption, date, and coverage condition before publishing records matching the challenge schema. Include optional coverage logic in an object with rules and ruleLogic fields.</p><label className="textarea-label" htmlFor="rule-import">Rules JSON</label><textarea id="rule-import" className="import-textarea" value={importText} onChange={event => setImportText(event.target.value)} placeholder={'{\n  "rules": [],\n  "ruleLogic": {}\n}'} spellCheck={false} /><div className="admin-import-footer"><a href={`/api/exports/rules?as_of=${asOf}`} className="text-button" download><ArrowDownToLine size={15} />Export rules</a><button className="button button-dark" disabled={!importText.trim() || importLoading} onClick={() => void importRules()}>{importLoading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Validate & import</button></div><p className="helper-text">Invalid records, fabricated quotations, and unsupported coverage logic must be rejected by the server.</p></section><section className="panel admin-panel capture-panel"><div className="section-heading"><div><span className="eyebrow">COMPLETE THE SOURCE LIBRARY</span><h2>Add a captured source.</h2></div><span className="category-icon color-blue"><FileText size={20} /></span></div><p className="muted">Store text you retrieved from a source in the manifest. Keep the exact original wording, matching URL, and retrieval time attached to the capture.</p><form className="capture-form" onSubmit={event => void uploadCapture(event)}><div className="capture-metadata"><label>Document<select required value={captureDoc} onChange={event => { setCaptureDoc(event.target.value); setCaptureUrl(sources.find(source => source.doc_id === event.target.value)?.url || ""); }}><option value="">Choose a manifest document</option>{sources.map(source => <option key={source.doc_id} value={source.doc_id}>{source.doc_id} · {source.jurisdictions}{captured(source) ? " · Captured" : " · Link only"}</option>)}</select></label><label>Retrieved at (UTC)<input required type="datetime-local" value={captureDate} onChange={event => setCaptureDate(event.target.value)} /></label><label className="capture-source-url">Source URL<input type="url" required readOnly value={captureUrl} placeholder="Select a document to use its manifest URL" /></label></div><label className="textarea-label" htmlFor="capture-text">Exact captured text</label><textarea id="capture-text" className="import-textarea" required minLength={20} maxLength={1000000} value={captureText} onChange={event => setCaptureText(event.target.value)} placeholder="Paste the source text without paraphrasing or replacing the original wording." /><div className="admin-import-footer"><span className="helper-text">Publishing a capture does not publish rules.</span><button type="submit" className="button button-dark" disabled={captureLoading || !captureDoc || !captureText.trim() || !captureDate}>{captureLoading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Save source capture</button></div></form></section></div>}</>}

        <details className="mb-6 border-2 border-primary bg-card p-4 text-sm"><summary className="cursor-pointer font-semibold">Download challenge research records</summary><p className="mt-2 text-xs text-muted-foreground">Exports retain incomplete coverage, source provenance and evaluation status. Read the readiness report before submitting.</p><div className="mt-3 flex flex-wrap gap-4">{(["readiness", "rules", "lookups", "changes"] as const).map(kind => <a key={kind} href={`/api/exports/${kind}?as_of=${asOf}`} download className="inline-flex items-center gap-2 underline"><ArrowDownToLine size={14} />{kind === "readiness" ? "Readiness report" : kind === "rules" ? "Reviewed rules" : kind === "lookups" ? "Property evaluations" : "Law-change outcomes"}</a>)}</div></details>
        <footer className="workspace-footer"><div><ShieldCheck size={14} /><span>Not legal advice. A research prototype using public source material.</span></div><span>AS OF {asOf}<span className="footer-dot">·</span>LEXRENT</span></footer>
      </div>
    </main>

    {sourceDetail && <Drawer title={`${sourceDetail.doc_id} · ${sourceDetail.jurisdictions}`} subtitle="ORIGINAL SOURCE" onClose={closeSource}><div className="source-detail-meta"><Status value={captured(sourceDetail) ? "captured" : "link-only"} /><span>{sourceDetail.source_type}</span></div><h3 className="drawer-document-title">{sourceName(sourceDetail)}</h3><a href={sourceDetail.url} className="source-external-link" target="_blank" rel="noreferrer">Read on original website<ExternalLink size={15} /></a><div className="evidence-meta"><div><span>Retrieved</span><strong>{formattedDate(sourceDetail.retrieved_at)}</strong></div><div><span>Capture status</span><strong>{sourceDetail.status || (captured(sourceDetail) ? "Captured" : "Link only")}</strong></div></div>{sourceDetail.sha256 && <details className="outcome-details source-provenance"><summary>Source capture fingerprint</summary><code>{sourceDetail.sha256}</code><p className="helper-text">Use this fingerprint to compare the exact captured text used as evidence.</p></details>}{sourceLoading ? <div className="inline-loading"><LoaderCircle className="spin" size={18} />Loading source text…</div> : sourceDetail.text ? <><div className="source-text-heading"><h3>Captured source text</h3><button className="text-button" onClick={() => void navigator.clipboard.writeText(sourceDetail.text || "").then(() => setNotice("Source text copied.")).catch(() => setNotice("Copy is unavailable in this browser."))}><Copy size={14} />Copy</button></div><pre className="source-text">{sourceDetail.text}</pre></> : <div className="information-banner"><CircleHelp size={17} /><p>No captured text is supplied for this source. Its URL alone does not support an extracted quotation.</p></div>}</Drawer>}
    {chatCitation && <Drawer title={`Source ${chatCitation.doc_id}`} subtitle="AI ANSWER · SOURCE EVIDENCE" onClose={() => setChatCitation(null)}><div className="evidence-meta"><div><span>Document</span><strong>{chatCitation.doc_id}</strong></div><div><span>Retrieved</span><strong>{formattedDate(chatCitation.retrieved_at)}</strong></div></div><h3 className="drawer-subheading">Supporting quotation</h3><blockquote className="evidence-quote">{chatCitation.quoted_span}</blockquote><p className="helper-text">Read this quotation in context. It supports research, and does not alone establish that a rule applies to a particular property.</p><div className="citation-drawer-actions">{sources.some(source => source.doc_id === chatCitation.doc_id) && <button className="button button-dark" onClick={() => { const source = sources.find(item => item.doc_id === chatCitation.doc_id); setChatCitation(null); if (source) void openSource(source); }}>Read captured document<BookOpen size={15} /></button>}{(chatCitation.source_url || chatCitation.url) && <a className="button button-outline" href={chatCitation.source_url || chatCitation.url} target="_blank" rel="noreferrer">Original website<ExternalLink size={15} /></a>}</div></Drawer>}

  </div>;
}
