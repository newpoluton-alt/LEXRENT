export type Place = {
  id: string;
  label: string;
  osmType?: string;
  osmId?: number;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  stateCode?: string | undefined;
  postcode?: string;
  lat: number;
  lon: number;
};

export const STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY",
  Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

export async function searchAddresses(q: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&layer=house&bbox=-170,17,-65,72`;
  const r = await fetch(url, { signal: signal ?? null });
  if (!r.ok) throw new Error("Address search failed");
  const j = await r.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (j.features as any[])
    .filter((f) => f.properties.countrycode === "US" && f.properties.housenumber)
    .slice(0, 7)
    .map((f) => {
      const p = f.properties;
      const stateCode = p.state ? STATES[p.state] : undefined;
      const city = p.city || p.locality || p.district;
      const label = `${p.housenumber} ${p.street ?? ""}, ${city ?? ""}${stateCode ? ", " + stateCode : ""} ${p.postcode ?? ""}`
        .replace(/\s+/g, " ")
        .trim();
      return {
        id: `${p.osm_type}${p.osm_id}`,
        label,
        osmType: p.osm_type,
        osmId: p.osm_id,
        housenumber: p.housenumber,
        street: p.street,
        city: p.city,
        district: p.district,
        county: p.county,
        state: p.state,
        stateCode,
        postcode: p.postcode,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      } satisfies Place;
    });
}

export type Building = { polygon: [number, number][]; tags: Record<string, string> };

function inside(pt: [number, number], poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]!;
    const [yj, xj] = poly[j]!;
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export async function fetchBuilding(place: Place): Promise<Building | null> {
  const q =
    place.osmType === "W" && place.osmId
      ? `[out:json][timeout:20];(way(${place.osmId})[building];way(around:30,${place.lat},${place.lon})[building];);out geom tags;`
      : `[out:json][timeout:20];way(around:30,${place.lat},${place.lon})[building];out geom tags;`;
  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(q),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ways = (j.elements as any[]).filter((e) => e.type === "way" && e.geometry);
  if (!ways.length) return null;
  const toPoly = (w: { geometry: { lat: number; lon: number }[] }) =>
    w.geometry.map((g) => [g.lat, g.lon] as [number, number]);
  const exact = ways.find((w) => place.osmType === "W" && w.id === place.osmId);
  const containing = ways.find((w) => inside([place.lat, place.lon], toPoly(w)));
  const pick =
    exact ??
    containing ??
    ways
      .map((w) => {
        const p = toPoly(w);
        const c = p.reduce((a, b) => [a[0] + b[0] / p.length, a[1] + b[1] / p.length], [0, 0]);
        return { w, d: (c[0] - place.lat) ** 2 + (c[1] - place.lon) ** 2 };
      })
      .sort((a, b) => a.d - b.d)[0]!.w;
  return { polygon: toPoly(pick), tags: pick.tags ?? {} };
}

export function isNYC(p: Pick<Place, "stateCode" | "city" | "district" | "county">) {
  if (p.stateCode !== "NY") return false;
  const s = [p.city, p.district, p.county].filter(Boolean).join(" ").toLowerCase();
  return /new york|bronx|brooklyn|queens|staten island|manhattan|kings county|richmond county/.test(s);
}

function nycBoro(p: Place) {
  const s = [p.district, p.county, p.city].filter(Boolean).join(" ").toLowerCase();
  if (s.includes("bronx")) return "BRONX";
  if (s.includes("brooklyn") || s.includes("kings")) return "BROOKLYN";
  if (s.includes("queens")) return "QUEENS";
  if (s.includes("staten") || s.includes("richmond")) return "STATEN ISLAND";
  return "MANHATTAN";
}

export type NYCData = {
  violations?: number | undefined;
  openViolations?: number | undefined;
  complaints?: number;
  topComplaints?: { type: string; n: number }[];
  evictions?: number | undefined;
};

const SODA = "https://data.cityofnewyork.us/resource";
async function soda(path: string) {
  const r = await fetch(`${SODA}/${path}`);
  if (!r.ok) throw new Error("NYC open data error");
  return r.json();
}

export async function fetchNYCData(p: Place): Promise<NYCData> {
  const hn = (p.housenumber ?? "").toUpperCase().replace(/'/g, "");
  const st = (p.street ?? "").toUpperCase().replace(/'/g, "");
  const addr = `${hn} ${st}`;
  const boro = nycBoro(p);
  const since = `${new Date().getFullYear() - 3}-01-01T00:00:00`;
  const [v, vo, c, e] = await Promise.allSettled([
    soda(`wvxf-dwi5.json?$select=count(*) as n&$where=${encodeURIComponent(`housenumber='${hn}' AND streetname='${st}' AND boro='${boro}'`)}`),
    soda(`wvxf-dwi5.json?$select=count(*) as n&$where=${encodeURIComponent(`housenumber='${hn}' AND streetname='${st}' AND boro='${boro}' AND violationstatus='Open'`)}`),
    soda(`erm2-nwe9.json?$select=complaint_type,count(*) as n&$where=${encodeURIComponent(`incident_address='${addr}' AND created_date>'${since}'`)}&$group=complaint_type&$order=n DESC&$limit=50`),
    soda(`6z8x-wfk4.json?$select=count(*) as n&$where=${encodeURIComponent(`upper(eviction_address) like '${addr}%'`)}`),
  ]);
  const num = (x: PromiseSettledResult<{ n: string }[]>) =>
    x.status === "fulfilled" ? Number(x.value[0]?.n ?? 0) : undefined;
  const out: NYCData = { violations: num(v), openViolations: num(vo), evictions: num(e) };
  if (c.status === "fulfilled") {
    const rows = (c.value as { complaint_type: string; n: string }[]).map((r) => ({ type: r.complaint_type, n: Number(r.n) }));
    out.complaints = rows.reduce((a, b) => a + b.n, 0);
    out.topComplaints = rows.slice(0, 3);
  }
  return out;
}
