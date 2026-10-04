"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, MapPin } from "lucide-react";
import type { Map as LeafletMap } from "leaflet";
import type { PropertyRecord } from "@/domain/types";
import { useLang } from "./language";

export interface PropertyMapProps {
  property: PropertyRecord;
  coordinates?: { lat: number; lon: number };
}

type MapState = { key: string; status: "loading" | "ready" | "unavailable" | "error"; provided?: boolean };
type Point = { lat: number; lon: number };
const STATES: Record<string, string> = { California: "CA", Massachusetts: "MA", "New Jersey": "NJ" };
const STREET_WORDS: Record<string, string> = {
  st: "street", ave: "avenue", av: "avenue", rd: "road", blvd: "boulevard", dr: "drive",
  ln: "lane", ct: "court", pl: "place", pkwy: "parkway", ter: "terrace", hwy: "highway",
  n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}

function streetName(value: string): string {
  return normalized(value).split(/\s+/).map(word => STREET_WORDS[word] ?? word).join(" ");
}

function validPoint(point: Point | undefined): point is Point {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
}

/** A conservative postal-address match for display only; never a municipality resolution. */
function photonPoint(data: unknown, property: PropertyRecord): Point | null {
  const features = record(data)?.features;
  const address = /^(\d+(?:-\d+)?[a-z]?)\s+(.+)$/i.exec(property.street_address.trim());
  if (!Array.isArray(features) || !address) return null;
  const wantedStreet = streetName(address[2].replace(/\s+(?:apt|unit|suite|#)\s*\S+.*$/i, ""));
  for (const feature of features.slice(0, 10)) {
    const item = record(feature), fields = record(item?.properties), geometry = record(item?.geometry);
    const coordinate = geometry?.coordinates;
    if (!fields || geometry?.type !== "Point" || !Array.isArray(coordinate) || coordinate.length < 2) continue;
    const state = typeof fields.state === "string" ? STATES[fields.state] ?? fields.state : "";
    const cities = [fields.city, fields.locality, fields.district].map(normalized);
    if (String(fields.countrycode).toUpperCase() !== "US" || state !== property.state ||
      normalized(fields.housenumber) !== normalized(address[1]) || streetName(String(fields.street ?? "")) !== wantedStreet ||
      !cities.includes(normalized(property.postal_city))) continue;
    const point = { lat: Number(coordinate[1]), lon: Number(coordinate[0]) };
    if (typeof coordinate[0] === "number" && typeof coordinate[1] === "number" && validPoint(point)) return point;
  }
  return null;
}

export function PropertyMap({ property, coordinates }: PropertyMapProps) {
  const { pick } = useLang();
  const element = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MapState>({ key: "", status: "loading" });
  const [tileWarning, setTileWarning] = useState(false);
  const address = [property.street_address, property.postal_city, [property.state, property.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const key = JSON.stringify([property.address_id, property.street_address, property.postal_city, property.state, property.zip, coordinates?.lat, coordinates?.lon]);
  const status = state.key === key ? state.status : "loading";
  const searchUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    let map: LeafletMap | undefined;
    let resize: ResizeObserver | undefined;
    let animation = 0;
    const timeout = window.setTimeout(() => abort.abort(), 12_000);
    setState({ key, status: "loading" });
    setTileWarning(false);

    void (async () => {
      try {
        let point: Point | null = validPoint(coordinates) ? coordinates : null;
        const provided = !!point;
        if (!point) {
          const url = new URL("https://photon.komoot.io/api/");
          url.search = new URLSearchParams({
            q: `${property.street_address}, ${property.postal_city}, ${property.state}, United States`,
            limit: "10", lang: "en", layer: "house", bbox: "-170,17,-65,72",
          }).toString();
          const response = await fetch(url, { signal: abort.signal, referrerPolicy: "no-referrer" });
          if (!response.ok) throw new Error("Map address search unavailable.");
          point = photonPoint(await response.json(), property);
        }
        window.clearTimeout(timeout);
        if (cancelled) return;
        if (!point) { setState({ key, status: "unavailable" }); return; }
        const L = (await import("leaflet")).default;
        if (cancelled || !element.current) return;
        map = L.map(element.current, { scrollWheelZoom: false }).setView([point.lat, point.lon], 17);
        const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        }).addTo(map);
        tiles.on("tileerror", () => { if (!cancelled) setTileWarning(true); });
        const label = document.createElement("span");
        label.textContent = address;
        L.circleMarker([point.lat, point.lon], {
          radius: 8, color: "#173fa0", fillColor: "#edc64a", fillOpacity: 1, weight: 3,
        }).addTo(map).bindTooltip(label);
        animation = window.requestAnimationFrame(() => map?.invalidateSize());
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(() => map?.invalidateSize());
          resize.observe(element.current);
        }
        setState({ key, status: "ready", provided });
      } catch {
        if (!cancelled) { map?.remove(); map = undefined; setState({ key, status: "error" }); }
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(animation);
      resize?.disconnect();
      map?.remove();
    };
    // Language changes update labels without sending the same address again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <section className="border-2 border-primary bg-card" aria-label={pick("Address map preview", "Vista previa del mapa de la dirección")}>
      <div className="isolate relative min-h-[320px] bg-muted">
        <div ref={element} className={`absolute inset-0 z-0 min-h-[320px] ${status === "ready" ? "opacity-100" : "opacity-0"}`} aria-label={pick("Approximate address location", "Ubicación aproximada de la dirección")} />
        {status !== "ready" && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-7 text-center">
          {status === "loading" ? <LoaderCircle size={30} className="animate-spin text-primary" aria-hidden="true" /> : <MapPin size={36} className="text-primary" aria-hidden="true" />}
          <p className="max-w-sm text-lg font-semibold">{property.street_address}</p>
          <p className="text-sm">{property.postal_city}, {property.state} {property.zip}</p>
          <p className="max-w-sm text-sm text-muted-foreground" role="status">
            {status === "loading" ? pick("Finding a map preview for this postal address…", "Buscando una vista del mapa de esta dirección postal…") :
              status === "unavailable" ? pick("No sufficiently matching map location was found. You can search the supplied address on OpenStreetMap.", "No se encontró una ubicación que coincida suficientemente. Puedes buscar la dirección proporcionada en OpenStreetMap.") :
              pick("The map preview is unavailable right now. The address and research results remain available.", "La vista del mapa no está disponible ahora. La dirección y los resultados de investigación siguen disponibles.")}
          </p>
        </div>}
      </div>
      <div className="space-y-2 border-t-2 border-primary px-4 py-3 text-xs">
        <p role="status">{status === "ready" ? (state.provided ? pick("Provided location shown for orientation.", "Ubicación proporcionada para orientación.") : pick("Approximate postal-address match from Photon / OpenStreetMap.", "Coincidencia aproximada de la dirección postal de Photon / OpenStreetMap.")) : pick("Map preview only.", "Solo vista previa del mapa.")} {pick("The map does not verify legal city boundaries or building facts.", "El mapa no verifica los límites legales de la ciudad ni los datos del edificio.")}</p>
        {tileWarning && status === "ready" && <p className="text-destructive" role="status">{pick("Some map tiles could not load. OpenStreetMap search is available below.", "Algunas imágenes del mapa no se cargaron. Puedes buscar en OpenStreetMap abajo.")}</p>}
        <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          {pick("Search this address on OpenStreetMap", "Buscar esta dirección en OpenStreetMap")}<ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
