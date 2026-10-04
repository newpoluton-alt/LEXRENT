"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Skyline from "@/components/skyline";
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
type ChatMessage = { role: "user" | "assistant"; content: string; citations?: ChatCitation[]; missing_facts?: string[]; as_of?: string };

const categories = [
  { id: "rent_increase_limits", label: "Rent increases", description: "Caps, formulas & annual adjustments", icon: Home, color: "green" },
  { id: "just_cause_eviction", label: "Eviction protections", description: "Just cause, notice & relocation", icon: ShieldCheck, color: "blue" },
  { id: "security_deposits", label: "Security deposits", description: "Limits, returns & exceptions", icon: LockKeyhole, color: "sand" },
  { id: "application_screening_fees", label: "Application fees", description: "Screening costs & refund requirements", icon: FileCheck2, color: "purple" },
  { id: "screening_restrictions", label: "Fair screening", description: "Access, background checks & discrimination", icon: UsersRound, color: "peach" },
  { id: "algorithmic_rent_setting", label: "Algorithmic pricing", description: "Rent-setting software & restrictions", icon: Code2, color: "mint" },
];

const navigation: { id: View; label: string; icon: typeof Home; section?: string }[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "properties", label: "Property explorer", icon: Building2 },
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
  const labels: Record<string, string> = { applies: "Applies", unknown: "Needs more facts", superseded: "Local rule governs", not_yet_effective: "Not yet effective", not_evaluated: "Not evaluated", needs_review: "Needs review", evaluated: "Evaluated", pending: "Pending", in_force: "In force", failed: "Failed", captured: "Text available", "link-only": "Link only" };
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

export default function LexrentApp() {
  const [view, setView] = useState<View>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [asOf, setAsOf] = useState("2026-10-01");
  const [counts, setCounts] = useState<Counts>({});
  const [properties, setProperties] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Property | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sourceDetail, setSourceDetail] = useState<Source | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [evidence, setEvidence] = useState<Result | null>(null);
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
  const [factsDraft, setFactsDraft] = useState<Record<string, string>>({});
  const [activeFacts, setActiveFacts] = useState<Record<string, string | number | boolean>>({});
  const [resolving, setResolving] = useState(false);
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

  useEffect(() => { const timer = setTimeout(() => { setDebouncedQuery(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    let live = true; setLoading(true);
    const params = new URLSearchParams({ q: debouncedQuery, state, page: String(page), limit: "12" });
    request<{ properties: Property[]; total: number }>(`/api/properties?${params}`).then(data => { if (live) { setProperties(data.properties); setTotal(data.total); } }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [debouncedQuery, state, page]);

  useEffect(() => {
    if (!selected) return;
    let live = true; setLookupLoading(true); setLookup(null);
    request<Lookup>("/api/lookup", post({ address_id: selected.address_id, as_of: asOf, facts: activeFacts })).then(data => { if (live) setLookup(data); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLookupLoading(false); });
    return () => { live = false; };
  }, [selected, asOf, activeFacts]);

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
  useEffect(() => { if (view === "assistant" && chatMessages.length) chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [chatMessages, chatLoading, view]);

  function navigate(next: View) { setView(next); setMobileNav(false); setError(""); }
  function selectProperty(property: Property) { setSelected(property); setActiveFacts({}); setFactsDraft({}); navigate("properties"); }
  async function saveProperty(property: Property) {
    if (!user) { setNotice("Sign in to keep your saved properties across visits."); return; }
    const existing = saved.some(item => item.address_id === property.address_id);
    try { await request("/api/saved", { method: existing ? "DELETE" : "POST", body: JSON.stringify({ address_id: property.address_id }) }); await loadSaved(); setNotice(existing ? "Property removed from saved." : "Property saved to your workspace."); } catch (e) { setError((e as Error).message); }
  }
  async function openSource(source: Source) {
    setSourceDetail(source); setSourceLoading(true);
    try { const data = await request<{ source?: Source; text?: string } & Partial<Source>>(`/api/sources/${source.doc_id}`); setSourceDetail({ ...source, ...(data.source || data), text: data.text || data.source?.text }); } catch (e) { setError((e as Error).message); } finally { setSourceLoading(false); }
  }
  async function evaluateChange() {
    setChangeLoading(true); setChangeResult(null);
    try { const result = await request<Record<string, unknown>>(`/api/changes/${activeTest}`, post({ as_of: asOf })); setChangeResult(result); } catch (e) { setError((e as Error).message); } finally { setChangeLoading(false); }
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
  function applyFacts(event: React.FormEvent) {
    event.preventDefault();
    const numeric = new Set(["year_built", "units", "tenancy_months", "owner_total_properties", "owner_total_units"]);
    const facts: Record<string, string | number | boolean> = {};
    for (const [field, value] of Object.entries(factsDraft)) {
      if (!value.trim()) continue;
      if (field === "owner_occupied") facts[field] = value === "true";
      else facts[field] = numeric.has(field) ? Number(value) : value;
    }
    setActiveFacts(facts);
  }
  async function resolveBoundary() {
    if (!selected) return; setResolving(true);
    try { await request(`/api/admin/jurisdictions/${selected.address_id}`, post({})); const result = await request<Lookup>("/api/lookup", post({ address_id: selected.address_id, as_of: asOf, facts: activeFacts })); setLookup(result); setNotice("Boundary evidence refreshed. The property’s rule evaluation has been updated."); } catch (e) { setError((e as Error).message); } finally { setResolving(false); }
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
    const history = chatMessages.slice(-6).map(message => ({ role: message.role, content: message.content }));
    const generation = chatGeneration.current;
    setChatQuestion(""); setChatError(""); setChatLoading(true);
    setChatMessages(previous => [...previous, { role: "user", content: question, as_of: asOf }]);
    try {
      const result = await request<{ answer: string; citations: ChatCitation[]; missing_facts: string[]; as_of: string }>("/api/ai/chat", post({ question, address_id: selected?.address_id, as_of: asOf, history }));
      if (generation === chatGeneration.current) setChatMessages(previous => [...previous, { role: "assistant", content: result.answer, citations: result.citations, missing_facts: result.missing_facts, as_of: result.as_of }]);
    } catch (e) {
      if (generation !== chatGeneration.current) return;
      setChatError((e as Error).message); setChatQuestion(question);
      setChatMessages(previous => previous[previous.length - 1]?.role === "user" && previous[previous.length - 1]?.content === question ? previous.slice(0, -1) : previous);
    } finally { if (generation === chatGeneration.current) setChatLoading(false); }
  }

  const results = lookup?.rules || lookup?.results || [];
  const visibleSources = sources.filter(source => `${source.doc_id} ${source.jurisdictions} ${source.url} ${source.source_type}`.toLowerCase().includes(sourceQuery.toLowerCase())).filter(source => sourceFilter === "all" || (sourceFilter === "captured" ? captured(source) : !captured(source)));
  const suggestions = properties.filter(property => `${property.address_id} ${property.street_address} ${property.postal_city} ${property.state} ${property.zip}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5);
  const currentTest = tests.find(test => test.test_id === activeTest);
  const pageCount = Math.max(1, Math.ceil(total / 12));
  const title: Record<View, string> = { dashboard: "Your housing law workspace", properties: "Property explorer", changes: "Law changes", sources: "Source library", saved: "Saved properties", assistant: "Ask LEXRENT", admin: "Rule workspace" };
  const missingFacts = [...new Set(lookup?.missing_facts ?? selected?.missing_facts ?? [])];

  return <div className="app-shell">
    <header className="site-header"><button className="site-brand" onClick={() => navigate("dashboard")} aria-label="LEXRENT home">LEXRENT</button><div className="site-links"><button onClick={() => setAboutOpen(true)}>About</button><button onClick={() => navigate("properties")}>Learn your rights</button></div><div className="site-account"><button className="site-ai-link" onClick={() => navigate("assistant")}><Sparkles size={16} />Ask LEXRENT</button><a href="/sign-in">{user?.name || (user ? "Your account" : "Sign in")}<ArrowUpRight size={14} /></a></div></header>
    <div className="legal-strip" role="note"><ShieldCheck size={13} /><span>Not legal advice. LEXRENT provides legal information for research; check the sources and consult a lawyer or tenant organization about your situation.</span></div>
    <main className="main-workspace">
      <header className="workspace-toolbar"><button className="icon-button mobile-menu" aria-label={mobileNav ? "Close navigation" : "Open navigation"} aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={21} /> : <Menu size={21} />}</button><nav className={`workspace-navigation ${mobileNav ? "navigation-open" : ""}`} aria-label="Workspace navigation">{navigation.map(item => <button key={item.id} className={`workspace-nav-item ${view === item.id ? "active" : ""}`} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><item.icon size={16} strokeWidth={1.7} /><span>{item.label}</span>{item.id === "saved" && saved.length > 0 && <span className="nav-count">{saved.length}</span>}</button>)}</nav><label className="date-control"><CalendarDays size={15} /><span>As of</span><input type="date" value={asOf} onChange={event => { if (event.target.value) setAsOf(event.target.value); }} aria-label="Query date" /></label></header>
      <div className={`page-content view-${view}`}>
        {error && <ErrorBanner message={error} onClose={() => setError("")} />}
        {notice && <div className="notice-banner" role="status"><CheckCircle2 size={17} />{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={15} /></button></div>}

        {view === "dashboard" ? <>
          <section className="lovable-landing"><div className="landing-inner"><h1>Search your rental housing rights</h1><p className="landing-highlight">&amp; see the law behind the answer</p><form className="landing-search" onSubmit={event => { event.preventDefault(); navigate("properties"); }}><div className="landing-search-row"><div className="landing-address"><div className="landing-address-input"><input value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 150)} placeholder="Search your address here" aria-label="Search the supplied properties" autoComplete="off" /><Search size={19} /></div>{searchFocused && query.trim().length > 1 && <div className="landing-suggestions">{loading || query !== debouncedQuery ? <span><LoaderCircle size={15} className="spin" />Searching the property sample…</span> : suggestions.length ? suggestions.map(property => <button key={property.address_id} type="button" onMouseDown={event => event.preventDefault()} onClick={() => selectProperty(property)}><strong>{property.street_address}</strong><span>{property.postal_city}, {property.state} {property.zip}</span></button>) : <span>No matching supplied properties. Try another street or city.</span>}</div>}</div><span className="landing-ampersand">&amp;</span><label className="landing-date"><input type="date" value={asOf} required onChange={event => { if (event.target.value) setAsOf(event.target.value); }} aria-label="Research as-of date" /><button type="button" onClick={() => setAsOf(new Date().toISOString().slice(0, 10))}>Today</button></label></div><button className="button button-accent landing-submit" type="submit">Search now</button></form><p className="landing-scope">Explore the supplied property sample in California, New Jersey, and Massachusetts.<br />Every rule needs evidence. Missing facts stay visible.</p><button className="text-button" onClick={() => { setQuery(""); setState(""); navigate("properties"); }}>Browse all {counts.properties ?? "supplied"} properties<ArrowRight size={15} /></button></div><Skyline /></section>
          <div className="dashboard-evidence" id="workspace-overview"><div className="section-heading"><div><span className="eyebrow">THE EVIDENCE BEHIND YOUR SEARCH</span><h2>A housing law workspace you can inspect</h2><p>Source documents, evaluated rules, and explicit unknowns.</p></div></div>
          <div className="stats-grid">{[
            { label: "Properties to explore", value: counts.properties, icon: Building2, note: "Public assessor records" },
            { label: "Source documents", value: counts.sources ?? (sources.length || undefined), icon: BookOpen, note: "State & local evidence" },
            { label: "Captured sources", value: counts.captured_sources ?? (sources.length ? sources.filter(captured).length : undefined), icon: FileText, note: "Available to read & extract" },
            { label: "Imported rules", value: counts.rules, icon: Layers3, note: counts.rules ? "Ready for evaluation" : "Awaiting extraction or import" },
          ].map(stat => <div className="stat-card" key={stat.label}><div><span>{stat.label}</span><stat.icon size={18} strokeWidth={1.6} /></div><strong>{stat.value ?? <span className="stat-skeleton">—</span>}</strong><p><span className="tiny-dot" />{stat.note}</p></div>)}</div>
          <section><div className="section-heading"><div><h2>Six areas. One clear view.</h2><p>The protections and requirements this workspace evaluates.</p></div><span className="subtle-label">STATE + LOCAL</span></div><div className="category-grid">{categories.map((category, index) => <button key={category.id} className="category-card" onClick={() => navigate("properties")}><div className={`category-icon color-${category.color}`}><category.icon size={21} strokeWidth={1.65} /></div><span className="category-number">0{index + 1}</span><h3>{category.label}</h3><p>{category.description}</p><div className="category-bottom"><span>Explore coverage</span><ArrowUpRight size={16} /></div></button>)}</div></section>
          <div className="dashboard-bottom"><section className="panel source-preview"><div className="section-heading"><div><h2>A library you can inspect</h2><p>Original sources, alongside every answer.</p></div><button className="text-button" onClick={() => navigate("sources")}>View library<ArrowRight size={15} /></button></div>{sources.slice(0, 3).map(source => <button className="source-preview-row" key={source.doc_id} onClick={() => void openSource(source)}><span className="document-icon"><FileText size={19} /></span><div><strong>{source.jurisdictions}</strong><span>{shortSource(source)}</span></div><span className="source-id">{source.doc_id}</span><ArrowUpRight size={16} /></button>)}{!sources.length && <p className="muted loading-line">Loading the source manifest…</p>}</section><section className="change-preview"><div className="change-graphic"><GitCompareArrows size={27} /><span>01 OCT</span></div><span className="eyebrow">LAW DOESN’T STAND STILL</span><h2>A change in law.<br />A change in coverage.</h2><p>Explore the five supplied change cases. Compare the expected outcome with evaluated rule evidence.</p><button className="button button-dark" onClick={() => navigate("changes")}>Explore law changes<ArrowRight size={16} /></button></section></div></div>
        </> : <div className="page-title-row"><div><span className="eyebrow">{view === "admin" ? "BUILD THE EVIDENCE" : "YOUR WORKSPACE"}</span><h1>{title[view]}<span className="serif-dot">.</span></h1><p>{({ properties: "Find an address. Resolve its jurisdiction. Inspect the rules and the gaps.", sources: "Read the original documents behind the housing rules.", changes: "Separate a challenge’s expected outcome from the laws your system has evaluated.", saved: "Your short list of properties, ready to revisit.", assistant: "Explore the evidence with an AI research assistant. Every useful answer should have a source.", admin: "Extract and import traceable rules before evaluating legal coverage.", dashboard: "" })[view]}</p></div>{(view === "properties" || view === "changes") && <a className="button button-outline" href={`/api/exports/${view === "changes" ? "changes" : "lookups"}?as_of=${asOf}`} download><ArrowDownToLine size={16} />Export {view === "changes" ? "changes" : "lookups"}</a>}</div>}

        {view === "properties" && <div className={`property-workspace ${selected ? "has-inspector" : ""}`}><section className="panel property-panel"><div className="table-toolbar"><div className="search-field"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search addresses, cities, property IDs…" aria-label="Search property list" />{query && <button className="icon-button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}</div><label className="select-field"><Filter size={15} /><select value={state} onChange={event => { setState(event.target.value); setPage(1); }} aria-label="Filter state"><option value="">All states</option><option value="CA">California</option><option value="NJ">New Jersey</option><option value="MA">Massachusetts</option></select></label></div><div className="table-meta"><span><strong>{total.toLocaleString()}</strong> {total === 1 ? "property" : "properties"}</span><span>Jurisdiction is evaluated separately</span></div><div className="property-table-wrap"><table className="property-table"><thead><tr><th>PROPERTY ADDRESS</th><th>STATE</th><th>YEAR BUILT</th><th>UNITS</th><th aria-label="Open property" /></tr></thead><tbody>{loading ? Array.from({ length: 6 }, (_, index) => <tr key={index}><td colSpan={5}><div className="row-skeleton" /></td></tr>) : properties.map(property => <tr key={property.address_id} className={selected?.address_id === property.address_id ? "selected-row" : ""}><td><button className="address-button" onClick={() => selectProperty(property)}><span className="property-icon"><Building2 size={18} /></span><span><strong>{property.street_address}</strong><small>{property.postal_city}, {property.state} {property.zip}<span className="address-id">{property.address_id}</span></small></span></button></td><td><span className="state-pill">{property.state}</span></td><td>{property.year_built ?? <span className="unknown-text">Not supplied</span>}</td><td>{property.units ?? <span className="unknown-text">—</span>}</td><td><button className="icon-button" aria-label={`Inspect ${property.street_address}`} onClick={() => selectProperty(property)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>{!loading && !properties.length && <Empty icon={Search} title="No matching properties">Try a shorter street name, another city, or a different state filter.</Empty>}<div className="pagination"><span>{total ? `${(page - 1) * 12 + 1}–${Math.min(page * 12, total)} of ${total}` : "No results"}</span><div><button className="icon-button" aria-label="Previous page" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><span>Page {page} of {pageCount}</span><button className="icon-button" aria-label="Next page" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div></div></section>
          {selected && <aside className="panel property-inspector"><div className="inspector-top"><span className="eyebrow">PROPERTY DETAILS</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close property details"><X size={17} /></button></div><span className="inspector-building"><Building2 size={24} strokeWidth={1.5} /></span><h2>{selected.street_address}</h2><p className="inspector-address">{selected.postal_city}, {selected.state} {selected.zip}</p><div className="inspector-actions"><span className="source-id">{selected.address_id}</span><button className={`button button-small ${saved.some(item => item.address_id === selected.address_id) ? "button-saved" : "button-outline"}`} onClick={() => void saveProperty(selected)}><Bookmark size={14} fill={saved.some(item => item.address_id === selected.address_id) ? "currentColor" : "none"} />{saved.some(item => item.address_id === selected.address_id) ? "Saved" : "Save property"}</button></div><button className="button button-outline ask-property-button" onClick={() => navigate("assistant")}><Sparkles size={14} />Ask LEXRENT about this property<ArrowRight size={13} /></button><div className="inspector-section"><div className="small-heading"><MapPin size={15} />Jurisdiction</div><strong>{lookup?.jurisdiction?.city || lookup?.jurisdiction?.candidate_city || selected.legal_city_candidate || "Awaiting resolution"}, {selected.state}</strong><p className="helper-text">{lookup?.jurisdiction?.verified ? `Verified via ${lookup.jurisdiction.method || "jurisdiction evidence"}.` : "The mailing city is not proof of legal city. Coverage stays uncertain until the boundary is verified."}</p>{isAdmin && <button className="button button-outline button-small boundary-button" disabled={resolving} onClick={() => void resolveBoundary()}>{resolving ? <LoaderCircle size={13} className="spin" /> : <MapPin size={13} />}{resolving ? "Resolving boundary…" : "Resolve with Census"}</button>}</div><div className="property-facts"><div><span>Year built</span><strong>{selected.year_built ?? "Not supplied"}</strong></div><div><span>Number of units</span><strong>{selected.units ?? "Not supplied"}</strong></div><div><span>Property use</span><strong>{selected.use_description || "Not supplied"}</strong></div><div><span>Query date</span><strong>{formattedDate(asOf)}</strong></div></div><div className="inspector-section"><div className="small-heading"><ShieldCheck size={15} />Rules & requirements<span className="subtle-label">{results.length}</span></div>{lookupLoading ? <div className="inline-loading"><LoaderCircle size={17} className="spin" />Evaluating imported rules…</div> : !results.length ? <div className="inspector-empty"><Layers3 size={22} /><strong>No verified rules loaded</strong><p>Import source-backed rules to evaluate this address. An empty result is not a finding that no laws apply.</p></div> : categories.map(category => { const matching = results.filter(result => result.rule?.category === category.id); return matching.length > 0 && <div className="rule-group" key={category.id}><h3>{category.label}</h3>{matching.map(result => <button className="rule-result" key={result.team_rule_id} onClick={() => setEvidence(result)}><div><strong>{result.rule?.title || result.team_rule_id}</strong><ArrowUpRight size={14} /></div><Status value={result.result} /><p>{result.explanation}</p><span className="rule-citation">{result.rule?.citation || "Inspect evidence"}</span>{result.conflict_flag && <span className="conflict-note"><CircleHelp size={12} />Conflict flagged for review</span>}</button>)}</div>; })}{results.filter(result => !result.rule?.category).map(result => <button className="rule-result" key={result.team_rule_id} onClick={() => setEvidence(result)}><strong>{result.rule?.title || result.team_rule_id}</strong><Status value={result.result} /><p>{result.explanation}</p></button>)}</div>{missingFacts.length > 0 && <div className="missing-facts"><div><CircleHelp size={16} /><strong>Facts still needed</strong></div><p>These gaps can change the coverage decision.</p><ul>{missingFacts.map(fact => <li key={fact}>{fact.replaceAll("_", " ")}</li>)}</ul></div>}<details className="fact-scenario"><summary><Plus size={14} />Add known facts<span>Scenario only</span></summary><p className="helper-text">Use known facts to test coverage. These inputs are temporary, user supplied, and do not alter the source property record.</p><form onSubmit={applyFacts}><div className="scenario-fact-grid">{[{ id: "year_built", label: "Year built", type: "number" }, { id: "units", label: "Number of units", type: "number" }, { id: "certificate_of_occupancy_date", label: "Certificate of occupancy", type: "date" }, { id: "tenancy_months", label: "Tenancy length (months)", type: "number" }, { id: "owner_type", label: "Owner type", type: "text" }, { id: "owner_total_properties", label: "Owner’s total properties", type: "number" }, { id: "owner_total_units", label: "Owner’s total units", type: "number" }].map(field => <label key={field.id}>{field.label}<input type={field.type} min={field.type === "number" ? 0 : undefined} step={field.type === "number" ? 1 : undefined} value={factsDraft[field.id] || ""} onChange={event => setFactsDraft({ ...factsDraft, [field.id]: event.target.value })} placeholder="Unknown" /></label>)}<label>Owner occupied<select value={factsDraft.owner_occupied || ""} onChange={event => setFactsDraft({ ...factsDraft, owner_occupied: event.target.value })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label></div><div className="scenario-actions"><button className="text-button" type="button" onClick={() => { setFactsDraft({}); setActiveFacts({}); }}>Reset</button><button className="button button-dark button-small" type="submit" disabled={lookupLoading}>Evaluate scenario<ArrowRight size={13} /></button></div></form></details>{Object.keys(activeFacts).length > 0 && <div className="scenario-active"><CircleHelp size={13} /><span>Results include {Object.keys(activeFacts).length} user-supplied scenario facts.</span></div>}{(lookup?.notices || lookup?.notes || []).map((note, index) => <p className="helper-text" key={index}>{readable(note)}</p>)}<div className="inspector-source"><FileText size={14} /><span>{selected.source_dataset || "Supplied public assessor sample"}</span></div></aside>}
        </div>}

        {view === "sources" && <><div className="library-toolbar"><div className="search-field"><Search size={18} /><input value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} placeholder="Search by jurisdiction, document ID, or source…" aria-label="Search sources" /></div><div className="segmented-control">{[{ id: "all", label: "All sources" }, { id: "captured", label: "Text available" }, { id: "links", label: "Link only" }].map(option => <button key={option.id} onClick={() => setSourceFilter(option.id)} className={sourceFilter === option.id ? "active" : ""}>{option.label}</button>)}</div></div><div className="library-summary"><span>{visibleSources.length} sources</span><span>Source quality and legal status are evaluated separately.</span></div><div className="source-grid">{visibleSources.map(source => <button className="source-card" key={source.doc_id} onClick={() => void openSource(source)}><div className="source-card-top"><span className="document-icon"><FileText size={20} /></span><span className="source-id">{source.doc_id}</span><ArrowUpRight size={16} /></div><span className="eyebrow">{source.jurisdictions}</span><h3>{sourceName(source)}</h3><span className="source-domain">{shortSource(source)}</span><div className="source-card-bottom"><Status value={captured(source) ? "captured" : "link-only"} /><span>{source.source_type}</span></div></button>)}</div>{!visibleSources.length && <Empty icon={BookOpen} title="No sources match">Try another jurisdiction or document ID.</Empty>}</>}

        {view === "changes" && <><div className="information-banner"><CircleHelp size={18} /><p><strong>Expectations are test fixtures.</strong> They describe the challenge’s intended behavior. Evaluated outcomes require imported rules, effective dates, and jurisdiction evidence.</p></div><div className="changes-layout"><div className="change-test-list">{tests.map(test => <button key={test.test_id} className={`change-test-card ${activeTest === test.test_id ? "selected" : ""}`} onClick={() => { setActiveTest(test.test_id); setChangeResult(null); }}><span className="test-number">{test.test_id}</span><div><span className="eyebrow">{test.type.replaceAll("_", " ")}</span><h3>{test.title}</h3><span>{test.states?.join(" · ") || "City boundary comparison"}</span></div><ChevronRight size={17} /></button>)}</div><section className="panel change-detail">{currentTest ? <><div className="change-detail-heading"><span className="test-number">{currentTest.test_id}</span><span className="subtle-label">SUPPLIED CHANGE CASE</span></div><h2>{currentTest.title}</h2><div className="fixture-box"><span className="small-heading">Fixture expectation</span><p>{currentTest.expected_behavior}</p></div>{(currentTest.as_of_before || currentTest.as_of_after) && <div className="change-date-comparison"><div><span>Before</span><strong>{formattedDate(currentTest.as_of_before)}</strong></div><ArrowRight size={18} /><div><span>After</span><strong>{formattedDate(currentTest.as_of_after)}</strong></div></div>}<div className="change-rule-ids"><span>Fixture rule IDs</span><div>{currentTest.rule_ids?.map(id => <code key={id}>{id}</code>)}</div></div><button className="button button-dark" disabled={changeLoading} onClick={() => void evaluateChange()}>{changeLoading ? <LoaderCircle className="spin" size={16} /> : <GitCompareArrows size={16} />}Evaluate imported rules</button><p className="helper-text">Evaluation uses the rules actually loaded into this workspace. Each case uses the supplied fixture dates shown here.</p>{changeResult && <ChangeOutcome data={changeResult} />}</> : <Empty icon={GitCompareArrows} title="Loading change cases">The five cases are read from the supplied challenge fixtures.</Empty>}</section></div></>}

        {view === "saved" && <section className="panel">{!user ? <Empty icon={Bookmark} title="Make room for your short list">Sign in to save properties and return to their evidence whenever you need it.<a className="button button-dark" href="/sign-in">Sign in<ArrowRight size={16} /></a>{!authConfigured && <span className="helper-text">Account access requires the workspace’s Neon Auth configuration.</span>}</Empty> : !saved.length ? <Empty icon={Bookmark} title="A clean slate">Save a property from the explorer to keep it here.<button className="button button-dark" onClick={() => navigate("properties")}>Explore properties<ArrowRight size={16} /></button></Empty> : <div className="saved-list">{saved.map(property => <div className="saved-row" key={property.address_id}><span className="property-icon"><Building2 size={21} /></span><button className="saved-address" onClick={() => selectProperty(property)}><strong>{property.street_address}</strong><span>{property.postal_city}, {property.state} {property.zip}</span></button><span className="source-id">{property.address_id}</span><button className="icon-button" aria-label={`Unsave ${property.street_address}`} onClick={() => void saveProperty(property)}><Bookmark size={19} fill="currentColor" /></button><button className="icon-button" aria-label={`Open ${property.street_address}`} onClick={() => selectProperty(property)}><ArrowUpRight size={18} /></button></div>)}</div>}</section>}

        {view === "assistant" && <div className="assistant-workspace"><section className="panel assistant-panel"><div className="assistant-panel-heading"><div><span className="assistant-small-mark"><Sparkles size={16} /></span><strong>LEXRENT Research Assistant</strong><span className="assistant-online"><span />{capabilities.ai?.configured ? "Source-grounded AI" : "AI connection needed"}</span></div>{chatMessages.length > 0 && <button className="text-button" disabled={chatLoading} onClick={() => { chatGeneration.current += 1; setChatMessages([]); setChatError(""); }}>New conversation<Plus size={13} /></button>}</div><div className="chat-messages" aria-live="polite" aria-relevant="additions text">{!chatMessages.length && <div className="assistant-welcome"><span className="assistant-orbit"><Sparkles size={29} strokeWidth={1.3} /></span><span className="eyebrow">LET’S FIND THE EVIDENCE</span><h2>A clearer question.<br />A better starting point.</h2><p>Ask about a requirement, compare source documents, or understand what facts are missing. I’ll work from the captured public corpus and show the supporting text.</p><div className="suggested-questions">{[{ title: "Understand coverage", question: selected ? "What facts are needed to determine which housing protections apply to this property? Cite the supplied sources and explain unknowns." : "What facts are needed to determine which housing protections apply to an apartment? Explain how state and city coverage differ, with sources." }, { title: "Compare the rules", question: "How do local rent increase rules interact with state rules in California? Use captured sources and explain exceptions or uncertain dates." }, { title: "Follow a change", question: "Which sources explain enacted and pending restrictions on algorithmic rent setting? Distinguish proposals, enacted law, and uncertain effective dates." }, { title: "Inspect the evidence", question: "What source-quality gaps could make a housing-law answer unreliable? Identify missing, outdated, or incomplete evidence in this corpus." }].map(suggestion => <button key={suggestion.title} disabled={chatLoading} onClick={() => setChatQuestion(suggestion.question)}><span>{suggestion.title}</span><ArrowUpRight size={14} /></button>)}</div></div>}{chatMessages.map((message, index) => <div key={index} className={`chat-message chat-${message.role}`}><span className="chat-avatar">{message.role === "assistant" ? <Layers3 size={17} /> : user?.name?.[0] || "Y"}</span><div className="chat-message-body"><div className="chat-message-label"><strong>{message.role === "assistant" ? "LEXRENT" : "You"}</strong>{message.as_of && <span>As of {message.as_of}</span>}</div><div className="chat-message-content"><AnswerText text={message.content} /></div>{message.citations && message.citations.length > 0 && <div className="chat-citations"><span className="chat-citations-label"><BookOpen size={12} />Source evidence</span><div>{message.citations.map((citation, citationIndex) => <button key={`${citation.doc_id}-${citationIndex}`} onClick={() => setChatCitation(citation)}><span>{citationIndex + 1}</span>{citation.doc_id}<ArrowUpRight size={12} /></button>)}</div></div>}{message.missing_facts && message.missing_facts.length > 0 && <div className="chat-missing-facts"><div><CircleHelp size={13} /><strong>Facts or evidence still needed</strong></div><ul>{message.missing_facts.map(fact => <li key={fact}>{fact.replaceAll("_", " ")}</li>)}</ul></div>}</div></div>)}{chatLoading && <div className="chat-message chat-assistant"><span className="chat-avatar"><Layers3 size={17} /></span><div className="chat-message-body"><div className="chat-message-label"><strong>LEXRENT</strong></div><div className="chat-thinking"><LoaderCircle size={15} className="spin" />Reading the evidence and preparing an answer…</div></div></div>}<div ref={chatEnd} /></div>{chatError && <div className="chat-error"><ErrorBanner message={chatError} onClose={() => setChatError("")} /></div>}<div className="chat-composer-wrap">{!user ? <div className="chat-sign-in"><span><LockKeyhole size={16} /><strong>Sign in to ask LEXRENT</strong><small>Your account gives you access to the research assistant.</small></span><a className="button button-dark" href="/sign-in">Sign in<ArrowRight size={15} /></a></div> : !capabilities.ai?.configured ? <div className="chat-sign-in"><span><CircleHelp size={16} /><strong>The AI connection isn’t configured</strong><small>Source and property exploration remain available.</small></span><button className="button button-outline" onClick={() => navigate("sources")}>Browse sources<ArrowRight size={15} /></button></div> : <form className="chat-composer" onSubmit={event => void askLexrent(event)}><textarea value={chatQuestion} onChange={event => setChatQuestion(event.target.value)} placeholder={selected ? `Ask about ${selected.street_address} or its source evidence…` : "Ask a question about housing rules or the captured sources…"} aria-label="Your question for LEXRENT" rows={2} maxLength={4000} disabled={chatLoading} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void askLexrent(); } }} /><div><span><BookOpen size={12} />{selected ? `${selected.address_id} · ${selected.state}` : "Captured source corpus"}<span className="composer-divider">·</span>{asOf}</span><button type="submit" className="chat-send" disabled={chatLoading || !chatQuestion.trim()} aria-label="Send question">{chatLoading ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={18} />}</button></div></form>}<p className="chat-disclaimer">AI research aid. Answers may be incomplete. Read the cited sources. Not legal advice.</p></div></section><aside className="assistant-context"><div className="panel assistant-context-card"><span className="eyebrow">YOUR RESEARCH CONTEXT</span><div className="small-heading"><MapPin size={15} />{selected ? "Selected property" : "Public source library"}</div>{selected ? <><h3>{selected.street_address}</h3><p>{selected.postal_city}, {selected.state} {selected.zip}</p><span className="source-id">{selected.address_id}</span><button className="text-button" onClick={() => navigate("properties")}>Inspect property<ArrowUpRight size={13} /></button></> : <><h3>State & city housing rules</h3><p>California, New Jersey, and Massachusetts. Select a property to add address context to your questions.</p><button className="text-button" onClick={() => navigate("properties")}>Choose a property<ArrowUpRight size={13} /></button></>}<div className="assistant-context-date"><CalendarDays size={14} /><div><span>Query date</span><strong>{formattedDate(asOf)}</strong></div></div></div><div className="assistant-principles"><ShieldCheck size={21} /><h3>A source is the starting point.</h3><p>The assistant uses captured documents. A missing fact, an unclear effective date, or a conflict should stay visible. Changing the property or date starts a new conversation.</p><div><FileText size={14} /><span>Inspect exact quotations</span></div><div><CircleHelp size={14} /><span>Keep unknowns explicit</span></div><div><Clock3 size={14} /><span>Check the applicable date</span></div><button className="text-button" onClick={() => navigate("sources")}>Open source library<ArrowRight size={13} /></button></div></aside></div>}

        {view === "admin" && <>{!isAdmin ? <section className="panel"><Empty icon={LockKeyhole} title="A workspace for verified evidence">Rule imports and AI extraction require a signed-in administrator. Public property and source exploration remains available.<a className="button button-dark" href="/sign-in">{user ? "Manage account" : "Sign in"}<ArrowRight size={16} /></a><span className="helper-text">{authConfigured ? "Admin access is assigned by the workspace administrator." : "Neon Auth is not configured for this environment."}</span></Empty></section> : <div className="admin-grid"><section className="panel admin-panel"><div className="section-heading"><div><span className="eyebrow">AUTOMATED EXTRACTION</span><h2>Read the sources. Build the rules.</h2></div><span className="category-icon color-purple"><Sparkles size={20} /></span></div><p className="muted">Select captured documents for Claude to extract structured, cited rule records. Review the returned evidence before relying on coverage.</p><div className={`capability-state ${capabilities.ai?.configured ? "configured" : ""}`}><span />{capabilities.ai?.configured ? "Claude extraction available" : "Anthropic API key is not configured"}</div><div className="extract-selection"><div><strong>{extractIds.length} selected</strong><button className="text-button" disabled={extractLoading} onClick={() => setExtractIds(extractIds.length ? [] : sources.filter(captured).map(source => source.doc_id))}>{extractIds.length ? "Clear selection" : "Select captured sources"}</button></div><div className="extract-source-list">{sources.filter(captured).map(source => <label key={source.doc_id}><input type="checkbox" checked={extractIds.includes(source.doc_id)} disabled={extractLoading} onChange={event => setExtractIds(event.target.checked ? [...extractIds, source.doc_id] : extractIds.filter(id => id !== source.doc_id))} /><span className="source-id">{source.doc_id}</span><span>{source.jurisdictions}</span><small>{shortSource(source)}</small></label>)}</div></div><button className="button button-dark" disabled={!capabilities.ai?.configured || !extractIds.length || extractLoading} onClick={() => void extractRules()}>{extractLoading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{extractLoading ? "Reading selected sources…" : "Extract rules"}</button><p className="helper-text">{extractLoading ? extractProgress || "Starting source extraction…" : "Credentials are configured on the server. This action creates drafts for human review and uses your configured model provider credits."}</p>{extractWarnings.length > 0 && <details className="outcome-details"><summary>Extraction review notes ({extractWarnings.length})</summary><ul className="extraction-warnings">{extractWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}</section><section className="panel admin-panel"><div className="section-heading"><div><span className="eyebrow">STRUCTURED RULE IMPORT</span><h2>Keep the evidence attached.</h2></div><span className="category-icon color-green"><FileCheck2 size={20} /></span></div><p className="muted">Review each quotation, exemption, date, and coverage condition before publishing records matching the challenge schema. Include optional coverage logic in an object with rules and ruleLogic fields.</p><label className="textarea-label" htmlFor="rule-import">Rules JSON</label><textarea id="rule-import" className="import-textarea" value={importText} onChange={event => setImportText(event.target.value)} placeholder={'{\n  "rules": [],\n  "ruleLogic": {}\n}'} spellCheck={false} /><div className="admin-import-footer"><a href={`/api/exports/rules?as_of=${asOf}`} className="text-button" download><ArrowDownToLine size={15} />Export rules</a><button className="button button-dark" disabled={!importText.trim() || importLoading} onClick={() => void importRules()}>{importLoading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Validate & import</button></div><p className="helper-text">Invalid records, fabricated quotations, and unsupported coverage logic must be rejected by the server.</p></section><section className="panel admin-panel capture-panel"><div className="section-heading"><div><span className="eyebrow">COMPLETE THE SOURCE LIBRARY</span><h2>Add a captured source.</h2></div><span className="category-icon color-blue"><FileText size={20} /></span></div><p className="muted">Store text you retrieved from a source in the manifest. Keep the exact original wording, matching URL, and retrieval time attached to the capture.</p><form className="capture-form" onSubmit={event => void uploadCapture(event)}><div className="capture-metadata"><label>Document<select required value={captureDoc} onChange={event => { setCaptureDoc(event.target.value); setCaptureUrl(sources.find(source => source.doc_id === event.target.value)?.url || ""); }}><option value="">Choose a manifest document</option>{sources.map(source => <option key={source.doc_id} value={source.doc_id}>{source.doc_id} · {source.jurisdictions}{captured(source) ? " · Captured" : " · Link only"}</option>)}</select></label><label>Retrieved at (UTC)<input required type="datetime-local" value={captureDate} onChange={event => setCaptureDate(event.target.value)} /></label><label className="capture-source-url">Source URL<input type="url" required readOnly value={captureUrl} placeholder="Select a document to use its manifest URL" /></label></div><label className="textarea-label" htmlFor="capture-text">Exact captured text</label><textarea id="capture-text" className="import-textarea" required minLength={20} maxLength={1000000} value={captureText} onChange={event => setCaptureText(event.target.value)} placeholder="Paste the source text without paraphrasing or replacing the original wording." /><div className="admin-import-footer"><span className="helper-text">Publishing a capture does not publish rules.</span><button type="submit" className="button button-dark" disabled={captureLoading || !captureDoc || !captureText.trim() || !captureDate}>{captureLoading ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Save source capture</button></div></form></section></div>}</>}

        <footer className="workspace-footer"><div><ShieldCheck size={14} /><span>Not legal advice. A research prototype using public source material.</span></div><span>AS OF {asOf}<span className="footer-dot">·</span>LEXRENT</span></footer>
      </div>
    </main>

    {aboutOpen && <Drawer title="The law behind the answer" subtitle="ABOUT LEXRENT" onClose={() => setAboutOpen(false)}><p className="drawer-requirement">LEXRENT is a research prototype for the Rental Housing Law Navigator challenge.</p><p className="muted">Search the supplied property sample, choose a date, and inspect state and local housing rules across six categories. Every imported rule must retain its source URL and exact supporting quotation. A mailing city alone does not establish legal jurisdiction.</p><h3 className="drawer-subheading">Evidence before certainty</h3><p className="muted">The workspace begins with captured public documents and property records. Verified rules are added through reviewed extraction and import. Missing facts, conflicting sources, pending proposals, and incomplete coverage stay visible.</p><h3 className="drawer-subheading">Ask with context</h3><p className="muted">Signed-in users can ask the research assistant about captured sources or a selected property. Read the citations and check the applicable date before relying on any answer.</p><div className="information-banner"><ShieldCheck size={17} /><p>Not legal advice. Consult a lawyer or tenant organization about your situation.</p></div><button className="button button-accent" onClick={() => { setAboutOpen(false); navigate("properties"); }}>Explore properties<ArrowRight size={16} /></button></Drawer>}
    {sourceDetail && <Drawer title={`${sourceDetail.doc_id} · ${sourceDetail.jurisdictions}`} subtitle="ORIGINAL SOURCE" onClose={() => setSourceDetail(null)}><div className="source-detail-meta"><Status value={captured(sourceDetail) ? "captured" : "link-only"} /><span>{sourceDetail.source_type}</span></div><h3 className="drawer-document-title">{sourceName(sourceDetail)}</h3><a href={sourceDetail.url} className="source-external-link" target="_blank" rel="noreferrer">Read on original website<ExternalLink size={15} /></a><div className="evidence-meta"><div><span>Retrieved</span><strong>{formattedDate(sourceDetail.retrieved_at)}</strong></div><div><span>Capture status</span><strong>{sourceDetail.status || (captured(sourceDetail) ? "Captured" : "Link only")}</strong></div></div>{sourceDetail.sha256 && <details className="outcome-details source-provenance"><summary>Source capture fingerprint</summary><code>{sourceDetail.sha256}</code><p className="helper-text">Use this fingerprint to compare the exact captured text used as evidence.</p></details>}{sourceLoading ? <div className="inline-loading"><LoaderCircle className="spin" size={18} />Loading source text…</div> : sourceDetail.text ? <><div className="source-text-heading"><h3>Captured source text</h3><button className="text-button" onClick={() => void navigator.clipboard.writeText(sourceDetail.text || "").then(() => setNotice("Source text copied.")).catch(() => setNotice("Copy is unavailable in this browser."))}><Copy size={14} />Copy</button></div><pre className="source-text">{sourceDetail.text}</pre></> : <div className="information-banner"><CircleHelp size={17} /><p>No captured text is supplied for this source. Its URL alone does not support an extracted quotation.</p></div>}</Drawer>}
    {chatCitation && <Drawer title={`Source ${chatCitation.doc_id}`} subtitle="AI ANSWER · SOURCE EVIDENCE" onClose={() => setChatCitation(null)}><div className="evidence-meta"><div><span>Document</span><strong>{chatCitation.doc_id}</strong></div><div><span>Retrieved</span><strong>{formattedDate(chatCitation.retrieved_at)}</strong></div></div><h3 className="drawer-subheading">Supporting quotation</h3><blockquote className="evidence-quote">{chatCitation.quoted_span}</blockquote><p className="helper-text">Read this quotation in context. It supports research, and does not alone establish that a rule applies to a particular property.</p><div className="citation-drawer-actions">{sources.some(source => source.doc_id === chatCitation.doc_id) && <button className="button button-dark" onClick={() => { const source = sources.find(item => item.doc_id === chatCitation.doc_id); setChatCitation(null); if (source) void openSource(source); }}>Read captured document<BookOpen size={15} /></button>}{(chatCitation.source_url || chatCitation.url) && <a className="button button-outline" href={chatCitation.source_url || chatCitation.url} target="_blank" rel="noreferrer">Original website<ExternalLink size={15} /></a>}</div></Drawer>}
    {evidence && <Drawer title={evidence.rule?.title || evidence.team_rule_id} subtitle="RULE & EVIDENCE" onClose={() => setEvidence(null)}><div className="rule-evidence-statuses"><Status value={evidence.result} />{evidence.rule?.status && <Status value={evidence.rule.status} />}</div><p className="drawer-requirement">{evidence.rule?.requirement || evidence.explanation}</p><div className="evidence-meta"><div><span>Jurisdiction</span><strong>{evidence.rule?.jurisdiction || "Not supplied"}</strong></div><div><span>Query date</span><strong>{formattedDate(asOf)}</strong></div><div><span>Declared effective date</span><strong>{evidence.rule?.effective_date ? formattedDate(evidence.rule.effective_date) : "Not recorded"}</strong></div><div><span>Source retrieved</span><strong>{formattedDate(evidence.evidence?.retrieved_at)}</strong></div><div><span>Citation</span><strong>{evidence.rule?.citation || "Not supplied"}</strong></div><div><span>Source document</span><strong>{evidence.rule?.source_doc_id || evidence.evidence?.doc_id || evidence.evidence?.source_doc_id || "Not supplied"}</strong></div></div>{evidence.rule?.key_value && <div className="information-banner"><FileCheck2 size={17} /><p><strong>Key value:</strong> {evidence.rule.key_value}</p></div>}<h3 className="drawer-subheading">Why this result</h3><p className="muted">{evidence.explanation}</p><h3 className="drawer-subheading">Exact supporting text</h3>{evidence.rule?.quoted_span || evidence.evidence?.quoted_span ? <blockquote className="evidence-quote">{evidence.rule?.quoted_span || evidence.evidence?.quoted_span}</blockquote> : <p className="helper-text">No supporting quotation was returned. This result requires evidence review.</p>}{evidence.missing_facts && evidence.missing_facts.length > 0 && <div className="missing-facts"><div><CircleHelp size={15} /><strong>Facts needed for this rule</strong></div><ul>{evidence.missing_facts.map(fact => <li key={fact}>{fact.replaceAll("_", " ")}</li>)}</ul></div>}{evidence.rule?.exemptions && <><h3 className="drawer-subheading">Exemptions</h3><p className="muted">{evidence.rule.exemptions}</p></>}{evidence.conflict_flag && <div className="information-banner"><CircleHelp size={18} /><p>{evidence.rule?.conflict_note || "A possible source or rule conflict requires human review."}</p></div>}{(evidence.rule?.source_url || evidence.evidence?.source_url) && <a className="button button-outline" href={evidence.rule?.source_url || evidence.evidence?.source_url} target="_blank" rel="noreferrer">Open original source<ExternalLink size={16} /></a>}{evidence.evidence?.sha256 && <details className="outcome-details source-provenance"><summary>Evidence provenance</summary><code>{evidence.evidence.sha256}</code>{typeof evidence.evidence.start_offset === "number" && <p className="helper-text">Source character offsets {evidence.evidence.start_offset}–{evidence.evidence.end_offset}.</p>}</details>}<p className="helper-text">Not legal advice. Coverage depends on both source evidence and known property facts.</p></Drawer>}
  </div>;
}
