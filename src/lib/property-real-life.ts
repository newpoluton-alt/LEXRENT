import type { PropertyRecord } from "../domain/types";
import { isValidMapPoint, type MapLocation } from "./property-map-location";

export function getStreetViewUrl(location: MapLocation | null | undefined): string | null {
  if (!isValidMapPoint(location) || !location || location.precision === "area") return null;
  const url = new URL("https://www.google.com/maps/@");
  url.search = new URLSearchParams({ api: "1", map_action: "pano", viewpoint: `${location.lat},${location.lon}` }).toString();
  return url.toString();
}

export function getGoogleAddressUrl(property: Pick<PropertyRecord, "street_address" | "postal_city" | "state">): string {
  const url = new URL("https://www.google.com/maps/search/");
  // Some sample ZIP codes conflict with the state. Keep the original street/postal place.
  url.search = new URLSearchParams({ api: "1", query: [property.street_address, property.postal_city, property.state].filter(Boolean).join(", ") }).toString();
  return url.toString();
}
