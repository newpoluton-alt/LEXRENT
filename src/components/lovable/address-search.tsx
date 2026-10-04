"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { PropertyRecord } from "@/domain/types";
import { useLang } from "./language";

export function AddressSearch({ value, onSelect, disabled = false }: { disabled?: boolean; value: PropertyRecord | null; onSelect: (property: PropertyRecord | null) => void }) {
  const { t, pick } = useLang();
  const id = useId();
  const [query, setQuery] = useState(value ? label(value) : "");
  const [items, setItems] = useState<PropertyRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const changing = useRef(false);
  useEffect(() => { if (!changing.current) setQuery(value ? label(value) : ""); }, [value]);
  useEffect(() => {
    if (!open || value) return;
    const ctrl = new AbortController();
    setLoading(true); setItems([]); setError("");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/properties?${new URLSearchParams({ q: query.trim(), limit: "8" })}`, { signal: ctrl.signal });
        if (!response.ok) throw new Error(pick("Address search is unavailable. Please retry.", "La búsqueda no está disponible. Inténtelo de nuevo."));
        const body = await response.json() as { properties: PropertyRecord[] };
        if (!ctrl.signal.aborted) { setItems(body.properties); setActive(0); }
      } catch (e) { if (!ctrl.signal.aborted) setError((e as Error).message); }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [query, open, value, pick]);
  const select = (property: PropertyRecord) => { changing.current = false; setQuery(label(property)); onSelect(property); setOpen(false); };
  return <div className="relative min-w-0 flex-1">
    <div className="flex items-center border-2 border-primary bg-card">
      <input role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
        disabled={disabled} maxLength={300} aria-label={t("searchPh")} placeholder={t("searchPh")} autoComplete="off" value={query}
        onChange={e => { changing.current = true; setQuery(e.target.value); onSelect(null); setOpen(true); }}
        onFocus={() => { if (!value) setOpen(true); }} onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); select(items[active]); }
        }} className="w-full min-w-0 bg-transparent px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground" />
      {loading && open ? <LoaderCircle size={18} className="mr-2 shrink-0 animate-spin" /> : <Search size={20} className="mr-2 shrink-0" />}
    </div>
    {open && <ul id={id} role="listbox" aria-label={pick("Matching sample properties", "Propiedades de la muestra")} className="absolute z-[900] mt-1 max-h-72 w-full overflow-auto border-2 border-primary bg-popover shadow-lg">
      {loading && <li role="presentation" className="px-3 py-3 text-sm">{t("searching")}</li>}
      {!loading && error && <li role="presentation" className="px-3 py-3 text-sm text-destructive">{error}</li>}
      {!loading && !error && !items.length && <li role="presentation" className="px-3 py-3 text-sm">{t("noResults")}</li>}
      {items.map((property, i) => <li key={property.address_id} id={`${id}-${i}`} role="option" aria-selected={i === active}
        onMouseDown={e => e.preventDefault()} onClick={() => select(property)} onMouseEnter={() => setActive(i)}
        className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
        <div>{property.street_address}</div><div className="mt-0.5 text-xs opacity-80">{property.postal_city}, {property.state} {property.zip} · {property.address_id}</div>
      </li>)}
      <li role="presentation" className="border-t border-primary bg-secondary px-3 py-2 text-xs">{pick("Search the supplied CA, NJ and MA property sample.", "Busque en la muestra de propiedades de CA, NJ y MA.")}</li>
    </ul>}
  </div>;
}
export function label(property: PropertyRecord) { return `${property.street_address}, ${property.postal_city}, ${property.state} ${property.zip}`.trim(); }
