import type { Metadata } from "next";
import "@fontsource-variable/lexend";
import "./globals.css";
export const metadata: Metadata = {
  title: "LEXRENT — Rental Housing Law Navigator",
  description: "Property-specific housing protections, source evidence, and law-change impact across California, New Jersey and Massachusetts.",
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
