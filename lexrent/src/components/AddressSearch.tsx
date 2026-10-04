import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchAddresses, type Place } from "@/lib/geo";
import { useLang } from "@/lib/i18n";

export function AddressSearch({ value, onSelect }: { value: Place | null; onSelect: (p: Place | null) => void }) {
  const { t } = useLang();
  const [q, setQ] = useState(value?.label ?? "");
  const [items, setItems] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef(false);

  useEffect(() => setQ(value?.label ?? ""), [value]);

  useEffect(() => {
    if (!typed.current || q.trim().length < 3) { setItems([]); return; }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchAddresses(q, ctrl.signal);
        setItems(r);
        setActive(0);
        setOpen(true);
      } catch { /* aborted */ }
      setLoading(false);
    }, 300);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q]);

  const pick = (p: Place) => { typed.current = false; onSelect(p); setOpen(false); };

  return (
    <div className="relative flex-1">
      <div className="flex items-center border-2 border-primary bg-card">
        <input
          value={q}
          placeholder={t("searchPh")}
          aria-label={t("searchPh")}
          onChange={(e) => { typed.current = true; setQ(e.target.value); if (value) onSelect(null); }}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !items.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); pick(items[active]!); }
          }}
          className="w-full bg-transparent px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <Search className="mr-2 h-5 w-5 shrink-0" />
      </div>
      {open && q.length >= 3 && (
        <ul role="listbox" className="absolute z-[900] mt-1 max-h-72 w-full overflow-auto border-2 border-primary bg-popover shadow-lg">
          {loading && !items.length && <li className="px-3 py-2 text-sm text-muted-foreground">{t("searching")}</li>}
          {!loading && !items.length && <li className="px-3 py-2 text-sm text-muted-foreground">{t("noResults")}</li>}
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={() => pick(p)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-primary text-primary-foreground" : ""}`}
            >
              {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
