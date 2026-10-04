"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";
import type { Map as LeafletMap } from "leaflet";
import type { PropertyRecord } from "@/domain/types";
import type { MapLocation } from "@/lib/property-map-location";
import { getGoogleAddressUrl, getStreetViewUrl } from "@/lib/property-real-life";
import { useLang } from "./language";

export function RealLifeView({ property, location }: { property: PropertyRecord; location: MapLocation }) {
  const { pick } = useLang();
  const element = useRef<HTMLDivElement>(null);
  const resetView = useRef<() => void>(() => {});
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; status: "loading" | "ready" | "error"; warning: boolean }>({ key: "", status: "loading", warning: false });
  const key = JSON.stringify([property.address_id, location.lat, location.lon, location.zoom, location.precision, attempt]);
  const current = state.key === key ? state : { key, status: "loading" as const, warning: false };
  const streetViewUrl = getStreetViewUrl(location);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | undefined;
    let resize: ResizeObserver | undefined;
    let timeout: number | undefined;
    let animation = 0;
    let loaded = false;
    setState({ key, status: "loading", warning: false });
    void (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !element.current) return;
        map = L.map(element.current, { scrollWheelZoom: false }).setView([location.lat, location.lon], location.zoom);
        // The public USGS service ends at level 16; Leaflet scales those photos at higher zooms.
        const tiles = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}", {
          minZoom: 1, maxNativeZoom: 16, maxZoom: 19,
          attribution: '<a href="https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer" target="_blank" rel="noopener noreferrer">USDA · USGS The National Map</a>',
        });
        tiles.on("tileload", () => {
          loaded = true;
          if (!cancelled) setState(previous => ({ key, status: "ready", warning: previous.key === key && previous.warning }));
        });
        tiles.on("tileerror", () => {
          if (!cancelled) setState(previous => ({ key, status: previous.key === key ? previous.status : "loading", warning: true }));
        });
        tiles.on("load", () => {
          if (!cancelled && !loaded) setState({ key, status: "error", warning: true });
        });
        tiles.addTo(map);
        if (location.precision === "address") {
          const label = document.createElement("span");
          label.textContent = property.street_address;
          L.circleMarker([location.lat, location.lon], { radius: 8, color: "#173fa0", fillColor: "#edc64a", fillOpacity: 1, weight: 3 }).addTo(map).bindTooltip(label);
        }
        resetView.current = () => map?.setView([location.lat, location.lon], location.zoom);
        animation = window.requestAnimationFrame(() => map?.invalidateSize());
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(() => map?.invalidateSize());
          resize.observe(element.current);
        }
        timeout = window.setTimeout(() => {
          if (!cancelled && !loaded) setState({ key, status: "error", warning: true });
        }, 12_000);
      } catch {
        if (!cancelled) setState({ key, status: "error", warning: true });
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(animation);
      resize?.disconnect();
      resetView.current = () => {};
      map?.remove();
    };
    // Language changes update the labels without downloading the imagery again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const precisionLabel = location.precision === "address" ? pick("Address match", "Dirección coincidente") :
    location.precision === "street" ? pick("Matching street", "Calle coincidente") : pick("Postal area", "Zona postal");

  return <section className="no-print mt-3 border-2 border-primary bg-card" aria-label={pick("See in real life", "Ver en la vida real")}>
    <div className="flex flex-wrap items-center justify-between gap-2 bg-primary px-4 py-3 text-primary-foreground">
      <h3 className="flex items-center gap-2 text-lg font-semibold uppercase"><Camera size={20} aria-hidden="true" />{pick("See in real life", "Ver en la vida real")}</h3>
      <span className="bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground">{pick("Aerial photos", "Fotos aéreas")} · {precisionLabel}</span>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 text-xs"><p className="font-semibold">{property.street_address}</p><p className="mt-1 text-muted-foreground">{pick("Explore real aerial imagery. Zoom or drag to look around.", "Explore imágenes aéreas reales. Acerque o arrastre para explorar.")}</p></div>
      <a href={streetViewUrl ?? getGoogleAddressUrl(property)} target="_blank" rel="noopener noreferrer" className="btn-accent inline-flex items-center gap-2 text-sm">
        <Camera size={16} aria-hidden="true" />{streetViewUrl ? pick("Open nearby Street View", "Abrir Street View cercano") : pick("Find Street View on Google Maps", "Buscar Street View en Google Maps")}<ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
    <div className="isolate relative min-h-[380px] bg-muted">
      {/* Leaflet adds its own classes to this node; keep React's className stable. */}
      <div ref={element} className="absolute inset-0 z-0 min-h-[380px]" aria-label={pick("Interactive aerial photo map", "Mapa interactivo de fotos aéreas")} />
      {current.status !== "ready" && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center" role="status">
        {current.status === "loading" ? <LoaderCircle size={30} className="animate-spin text-primary" aria-hidden="true" /> : <Camera size={30} className="text-primary" aria-hidden="true" />}
        <p className="max-w-md text-sm">{current.status === "loading" ? pick("Loading aerial photos…", "Cargando fotos aéreas…") : pick("Aerial photos could not load. Retry or explore the address on Google Maps.", "No se pudieron cargar las fotos aéreas. Reinténtelo o explore la dirección en Google Maps.")}</p>
        {current.status === "error" && <button type="button" onClick={() => setAttempt(value => value + 1)} className="btn-primary text-sm">{pick("Retry photos", "Reintentar fotos")}</button>}
      </div>}
    </div>
    <div className="space-y-2 border-t-2 border-primary px-4 py-3 text-xs">
      <p>{location.precision === "address" ? pick("The pin uses the same postal-address match as the map above.", "El marcador usa la misma coincidencia de dirección postal que el mapa de arriba.") : location.precision === "street" ? pick("Showing the matching street, without an exact building pin.", "Se muestra la calle coincidente, sin un marcador de edificio exacto.") : pick("Showing the wider postal area. The exact building has not been located.", "Se muestra la zona postal amplia. No se ha localizado el edificio exacto.")}</p>
      <p className="text-muted-foreground">{pick("Historical aerial imagery from USDA / USGS, not a live camera. Photos may predate building changes. Google Street View opens separately where coverage is available.", "Imágenes aéreas históricas de USDA / USGS, no una cámara en vivo. Las fotos pueden ser anteriores a cambios del edificio. Google Street View se abre por separado donde haya cobertura.")}</p>
      {current.warning && current.status === "ready" && <p role="status" className="text-destructive">{pick("Some photos could not load. You can retry the imagery.", "Algunas fotos no se cargaron. Puede reintentar las imágenes.")}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {current.status === "ready" && <button type="button" onClick={() => resetView.current()} className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2"><RotateCcw size={12} aria-hidden="true" />{pick("Reset photo view", "Restablecer fotos")}</button>}
        {current.warning && current.status === "ready" && <button type="button" onClick={() => setAttempt(value => value + 1)} className="underline">{pick("Retry photos", "Reintentar fotos")}</button>}
        <a href={getGoogleAddressUrl(property)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 underline underline-offset-2">{pick("Open this address on Google Maps", "Abrir esta dirección en Google Maps")}<ExternalLink size={12} aria-hidden="true" /></a>
      </div>
    </div>
  </section>;
}
