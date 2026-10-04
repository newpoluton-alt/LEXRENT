"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, MapPin, RotateCcw } from "lucide-react";
import type { Map as LeafletMap } from "leaflet";
import type { PropertyRecord } from "@/domain/types";
import { getAreaMapLocation, isValidMapPoint, selectPhotonLocation, type MapLocation, type MapPoint } from "@/lib/property-map-location";
import { useLang } from "./language";

export interface PropertyMapProps {
  property: PropertyRecord;
  coordinates?: MapPoint;
  onLocationChange?: (addressId: string, location: MapLocation) => void;
}
type MapState = {
  key: string;
  status: "loading" | "ready" | "error";
  location: MapLocation;
  search: "loading" | "matched" | "not-found" | "error";
};

// A small session cache avoids resending the same public sample address on tab switches.
const locationCache = new Map<string, { location: MapLocation | null; at: number }>();
const CACHE_TTL = 5 * 60_000;

export function PropertyMap({ property, coordinates, onLocationChange }: PropertyMapProps) {
  const { pick } = useLang();
  const element = useRef<HTMLDivElement>(null);
  const resetView = useRef<() => void>(() => {});
  const fallback = getAreaMapLocation(property);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MapState>({ key: "", status: "loading", location: fallback, search: "loading" });
  const [tileWarning, setTileWarning] = useState(false);
  const address = [property.street_address, property.postal_city, [property.state, property.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const addressKey = JSON.stringify([property.street_address, property.postal_city, property.state, property.zip]);
  const key = JSON.stringify([addressKey, coordinates?.lat, coordinates?.lon, attempt]);
  const current: MapState = state.key === key ? state : { key, status: "loading", location: fallback, search: "loading" };
  const searchUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

  useEffect(() => {
    onLocationChange?.(property.address_id, current.location);
    // Share the visual location with the photo view; this does not change legal facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLocationChange, property.address_id, current.location.lat, current.location.lon, current.location.zoom, current.location.precision, current.location.source]);

  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    let map: LeafletMap | undefined;
    let resize: ResizeObserver | undefined;
    let animation = 0;
    let timeout: number | undefined;
    const area = getAreaMapLocation(property);
    const supplied: MapLocation | null = isValidMapPoint(coordinates) ? { ...coordinates, precision: "address", source: "provided", zoom: 17 } : null;
    let shownLocation = supplied ?? area;
    setState({ key, status: "loading", location: shownLocation, search: supplied ? "matched" : "loading" });
    setTileWarning(false);

    void (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !element.current) return;
        // Initialize the map before geocoding: missing house data must not hide the city map.
        map = L.map(element.current, { scrollWheelZoom: false }).setView([shownLocation.lat, shownLocation.lon], shownLocation.zoom);
        const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        }).addTo(map);
        tiles.on("tileerror", () => { if (!cancelled) setTileWarning(true); });
        resetView.current = () => map?.setView([shownLocation.lat, shownLocation.lon], shownLocation.zoom);
        const addAddressMarker = (point: MapPoint) => {
          if (!map) return;
          const label = document.createElement("span");
          label.textContent = address;
          L.circleMarker([point.lat, point.lon], {
            radius: 8, color: "#173fa0", fillColor: "#edc64a", fillOpacity: 1, weight: 3,
          }).addTo(map).bindTooltip(label);
        };
        if (supplied) addAddressMarker(supplied);
        animation = window.requestAnimationFrame(() => map?.invalidateSize());
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(() => map?.invalidateSize());
          resize.observe(element.current);
        }
        setState({ key, status: "ready", location: shownLocation, search: supplied ? "matched" : "loading" });
        if (supplied) return;

        // Only the displayed sample address is queried; map tiles use normal browser caching.
        let location: MapLocation | null;
        const cached = locationCache.get(addressKey);
        try {
          if (cached && Date.now() - cached.at < CACHE_TTL && attempt === 0) {
            location = cached.location;
          } else {
            timeout = window.setTimeout(() => abort.abort(), 8_000);
            const url = new URL("https://photon.komoot.io/api/");
            url.search = new URLSearchParams({
              q: `${property.street_address}, ${property.postal_city}, ${property.state}, United States`,
              limit: "10", lang: "en", countrycode: "US",
            }).toString();
            const response = await fetch(url, { signal: abort.signal, referrerPolicy: "no-referrer" });
            if (!response.ok) throw new Error("Map address search unavailable.");
            location = selectPhotonLocation(await response.json(), property);
            if (cancelled) return;
            if (locationCache.size >= 100) locationCache.delete(locationCache.keys().next().value!);
            locationCache.set(addressKey, { location, at: Date.now() });
          }
          if (cancelled) return;
          if (location) {
            shownLocation = location;
            map.setView([location.lat, location.lon], location.zoom);
            if (location.precision === "address") addAddressMarker(location);
          }
          setState({ key, status: "ready", location: shownLocation, search: location ? "matched" : "not-found" });
        } catch {
          // Keep the already rendered area map when the independent geocoder fails.
          if (!cancelled) setState({ key, status: "ready", location: shownLocation, search: "error" });
        }
      } catch {
        if (!cancelled) {
          map?.remove(); map = undefined;
          setState({ key, status: "error", location: area, search: "error" });
        }
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
      resetView.current = () => {};
      map?.remove();
    };
    // Language changes update UI labels without reloading the map or repeating geocoding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const precisionLabel = current.location.precision === "address" ? pick("Address match", "Dirección coincidente") :
    current.location.precision === "street" ? pick("Street map", "Mapa de la calle") : pick("Area map", "Mapa de la zona");

  return (
    <section className="border-2 border-primary bg-card" aria-label={pick("Address map preview", "Vista previa del mapa de la dirección")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-primary px-4 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold"><MapPin size={14} aria-hidden="true" />{property.postal_city}, {property.state}</span>
        <span className="bg-accent px-2 py-1 font-medium" data-map-precision={current.location.precision}>{precisionLabel}</span>
      </div>
      <div className="isolate relative min-h-[360px] bg-muted">
        {/* Keep this className stable: Leaflet adds required classes directly to its container. */}
        <div ref={element} className="absolute inset-0 z-0 min-h-[360px]" aria-label={pick("Interactive OpenStreetMap", "OpenStreetMap interactivo")} />
        {current.status !== "ready" && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted p-7 text-center">
          {current.status === "loading" ? <LoaderCircle size={30} className="animate-spin text-primary" aria-hidden="true" /> : <MapPin size={36} className="text-primary" aria-hidden="true" />}
          <p className="max-w-sm text-lg font-semibold">{property.street_address}</p>
          <p className="text-sm">{property.postal_city}, {property.state} {property.zip}</p>
          <p className="max-w-sm text-sm text-muted-foreground" role="status">{current.status === "loading" ?
            pick("Loading the OpenStreetMap area view…", "Cargando el mapa de la zona en OpenStreetMap…") :
            pick("The map could not load. Try again or open the address on OpenStreetMap below.", "El mapa no se pudo cargar. Inténtalo de nuevo o abre la dirección en OpenStreetMap abajo.")}</p>
        </div>}
        {current.status === "ready" && current.search === "loading" && <div className="pointer-events-none absolute bottom-8 left-3 z-10 flex items-center gap-2 border border-primary bg-card px-3 py-2 text-xs shadow-sm" role="status"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{pick("Locating this address…", "Buscando esta dirección…")}</div>}
      </div>
      <div className="space-y-2 border-t-2 border-primary px-4 py-3 text-xs">
        <p className="font-semibold">{property.street_address}</p>
        <p role="status">{current.location.precision === "address" ? (current.location.source === "provided" ?
          pick("Provided address location shown for orientation.", "Ubicación proporcionada para orientación.") :
          pick("Postal-address match from Photon / OpenStreetMap.", "Coincidencia de la dirección postal de Photon / OpenStreetMap.")) :
          current.location.precision === "street" ? pick("Showing the matching street. The exact building has not been located; no property pin is shown.", "Se muestra la calle coincidente. No se ha localizado el edificio exacto; no se muestra un marcador de la propiedad.") :
          pick("Showing the postal area. The exact address has not been located; no property pin is shown.", "Se muestra la zona postal. No se ha localizado la dirección exacta; no se muestra un marcador de la propiedad.")}</p>
        {current.search === "error" && current.status === "ready" && <p role="status">{pick("Address search is temporarily unavailable. You can still explore the area map.", "La búsqueda de direcciones no está disponible ahora. Puedes explorar el mapa de la zona.")}</p>}
        {tileWarning && current.status === "ready" && <p className="text-destructive" role="status">{pick("Some map tiles could not load. Try reloading the map or open OpenStreetMap below.", "Algunas imágenes del mapa no se cargaron. Recarga el mapa o abre OpenStreetMap abajo.")}</p>}
        <p className="text-muted-foreground">{pick("The map does not verify legal city boundaries or building facts.", "El mapa no verifica los límites legales de la ciudad ni los datos del edificio.")}</p>
        <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-2">
          {current.status === "ready" && <button type="button" onClick={() => resetView.current()} className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2"><RotateCcw size={12} aria-hidden="true" />{pick("Reset view", "Restablecer vista")}</button>}
          {(current.status === "error" || tileWarning || current.search === "error") && <button type="button" onClick={() => setAttempt(value => value + 1)} className="font-medium underline underline-offset-2">{pick("Reload map", "Recargar mapa")}</button>}
          <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            {pick("Open this address on OpenStreetMap", "Abrir esta dirección en OpenStreetMap")}<ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
