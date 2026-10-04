import { useEffect, useRef } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";

export function MapView({ lat, lon, polygon }: { lat: number; lon: number; polygon: [number, number][] | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const group = useRef<LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      if (!map.current) {
        map.current = L.map(el.current, { scrollWheelZoom: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map.current);
        group.current = L.layerGroup().addTo(map.current);
      }
      const css = getComputedStyle(document.documentElement);
      const green = css.getPropertyValue("--building-highlight").trim();
      const blue = css.getPropertyValue("--primary").trim();
      group.current!.clearLayers();
      if (polygon) {
        const p = L.polygon(polygon, { color: green, fillColor: green, fillOpacity: 0.8, weight: 4 }).addTo(group.current!);
        map.current.fitBounds(p.getBounds(), { maxZoom: 19, padding: [80, 80] });
      } else {
        map.current.setView([lat, lon], 18);
      }
      L.circleMarker([lat, lon], { radius: 6, color: blue, fillColor: blue, fillOpacity: 1, weight: 2 }).addTo(group.current!);
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lon, polygon]);

  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);

  return <div ref={el} className="h-full min-h-[380px] w-full" />;
}
