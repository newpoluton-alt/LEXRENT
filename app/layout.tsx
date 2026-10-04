import type { Metadata } from "next";
import "@fontsource-variable/lexend";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { LanguageProvider } from "@/components/lovable/language";
export const metadata: Metadata = {
  title: "LEXRENT — Rental Housing Law Navigator",
  description: "Property-specific housing protections, source evidence, and law-change impact across California, New Jersey and Massachusetts.",
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body><LanguageProvider>{children}</LanguageProvider></body></html>;
}
