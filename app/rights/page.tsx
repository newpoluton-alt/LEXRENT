import type { Metadata } from "next";
import { RightsPage } from "@/components/lovable/info-pages";

export const metadata: Metadata = {
  title: "Learn your rights — LexRent",
  description: "Research questions for six rental housing topics, with source checks for the California, New Jersey, and Massachusetts property sample.",
};

export default function Page() {
  return <RightsPage />;
}
