import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { google?: any; __lexrentGmapsInit?: () => void }
}

let loader: Promise<any> | null = null;
function loadGoogle(lang: string): Promise<any> {
  if (window.google?.maps?.StreetViewService) return Promise.resolve(window.google);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const env = import.meta.env as Record<string, string | undefined>;
    const key = env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"];
    const channel = env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] ?? "";
    if (!key) return reject(new Error("no key"));
    window.__lexrentGmapsInit = () => resolve(window.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__lexrentGmapsInit&channel=${channel}&language=${lang}`;
    s.async = true;
    s.onerror = () => { loader = null; reject(new Error("load failed")); };
    document.head.appendChild(s);
  });
  return loader;
}

type State = { kind: "loading" } | { kind: "none" } | { kind: "ok"; date: string | null };

export function StreetView({ lat, lon }: { lat: number; lon: number }) {
  const { lang } = useLang();
  const el = useRef<HTMLDivElement>(null);
  const panoRef = useRef<any>(null);
  const [st, setSt] = useState<State>({ kind: "loading" });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (open && panoRef.current && st.kind === "ok") {
      window.google?.maps?.event?.trigger?.(panoRef.current, "resize");
    }
  }, [open, st.kind]);

  useEffect(() => {
    let live = true;
    setSt({ kind: "loading" });
    loadGoogle(lang)
      .then((g) => {
        const target = new g.maps.LatLng(lat, lon);
        new g.maps.StreetViewService().getPanorama(
          { location: target, radius: 60, source: g.maps.StreetViewSource.OUTDOOR },
          (data: any, status: string) => {
            if (!live) return;
            if (status !== "OK" || !data?.location || !el.current) return setSt({ kind: "none" });
            const heading = g.maps.geometry
              ? g.maps.geometry.spherical.computeHeading(data.location.latLng, target)
              : bearing(data.location.latLng.lat(), data.location.latLng.lng(), lat, lon);
            panoRef.current = new g.maps.StreetViewPanorama(el.current, {
              pano: data.location.pano,
              pov: { heading, pitch: 10 },
              zoom: 0.5,
              addressControl: false,
              motionTracking: false,
            });
            setSt({ kind: "ok", date: data.imageDate ?? null });
          },
        );
      })
      .catch(() => live && setSt({ kind: "none" }));
    return () => { live = false; };
  }, [lat, lon, lang]);

  const T = lang === "es"
    ? { title: "Ver en la vida real", taken: "Foto tomada", unknown: "fecha desconocida", loading: "Cargando vista de calle…", none: "No hay fotos de Street View disponibles para esta dirección." }
    : { title: "See in real life", taken: "Photo taken", unknown: "date unknown", loading: "Loading street view…", none: "No Street View photos are available for this address." };

  const fmtDate = (d: string | null) => {
    if (!d) return T.unknown;
    const [y = 0, m] = d.split("-").map(Number);
    return m ? new Date(y, m - 1, 1).toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { month: "long", year: "numeric" }) : String(y);
  };

  return (
    <section id="street-view" className="mt-3 scroll-mt-4 border-2 border-primary bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center justify-between gap-2 bg-primary px-4 py-2 text-left text-primary-foreground">
        <h2 className="text-lg font-semibold uppercase">{T.title}</h2>
        <span className="flex items-center gap-2">
          {st.kind === "ok" && <span className="bg-accent px-2 py-0.5 text-sm text-accent-foreground">{T.taken}: {fmtDate(st.date)}</span>}
          <span className="text-lg font-bold" aria-hidden>{open ? "−" : "+"}</span>
        </span>
      </button>
      {open && st.kind === "loading" && <p className="p-4 text-sm">{T.loading}</p>}
      {open && st.kind === "none" && <p className="p-4 text-sm">{T.none}</p>}
      <div ref={el} className={open && st.kind === "ok" ? "h-[420px] w-full" : "hidden"} />
    </section>
  );
}

function bearing(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = Math.PI / 180;
  const y = Math.sin((bLng - aLng) * r) * Math.cos(bLat * r);
  const x = Math.cos(aLat * r) * Math.sin(bLat * r) - Math.sin(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
