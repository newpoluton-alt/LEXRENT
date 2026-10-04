import type { Metadata } from "next";
import { AboutPage } from "@/components/lovable/info-pages";

export const metadata: Metadata = {
  title: "About LexRent — Rental housing research with evidence",
  description: "How LexRent researches a supplied sample of 500 California, New Jersey, and Massachusetts properties using dates, reviewed rules, and source evidence.",
};

export default function Page() {
  return <AboutPage />;
}
