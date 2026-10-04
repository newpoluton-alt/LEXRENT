"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, Handshake, KeyRound } from "lucide-react";
import { useLang } from "./language";

// These are supplied sample records with recorded Census municipality resolutions.
// Entry points choose a research workflow; they do not supply tenancy or exemption facts.
const DEMOS = [
  { persona: "renter", icon: KeyRound, addressId: "A0001", address: "6238 DE LONGPRE AVE", city: "Los Angeles, CA", label: ["Renters", "Inquilinos"], action: ["Understand a rental requirement", "Comprender un requisito de alquiler"], detail: ["Inspect the requirements, their evidence and any tenancy facts still needed.", "Consulta los requisitos, su evidencia y los datos del alquiler pendientes."], href: "/?address_id=A0001&as_of=2026-10-01&persona=renter&tab=overview" },
  { persona: "advocate", icon: Handshake, addressId: "A0008", address: "1065 SUMMIT AVENUE", city: "Jersey City, NJ", label: ["Advocates & agencies", "Defensores y agencias"], action: ["Compare a change and its evidence", "Comparar un cambio y su evidencia"], detail: ["Review the change cases, affected addresses, jurisdiction gaps and conflicts.", "Revisa los casos de cambio, las direcciones afectadas, la jurisdicción y los conflictos."], href: "/workspace?view=changes&address_id=A0008&as_of=2026-10-01&persona=advocate" },
  { persona: "provider", icon: Building2, addressId: "A0010", address: "134 Oxford St", city: "Cambridge, MA", label: ["Housing providers", "Proveedores de vivienda"], action: ["Review a property checklist", "Revisar los requisitos de una propiedad"], detail: ["Use the summary to check separate obligations, missing facts and exact sources.", "Usa el resumen para comprobar las obligaciones, los datos pendientes y las fuentes exactas."], href: "/?address_id=A0010&as_of=2026-10-01&persona=provider&tab=summary" },
] as const;

export function PersonaDemos({ compact = false }: { compact?: boolean }) {
  const { pick } = useLang();
  return <section className={compact ? "space-y-3" : "mx-auto max-w-5xl px-4 py-8"} aria-labelledby={compact ? "persona-demos-compact-title" : "persona-demos-title"}>
    <h2 id={compact ? "persona-demos-compact-title" : "persona-demos-title"} className="section-title text-xl">{pick("Try a real sample", "Prueba una muestra real")}</h2>
    <p className="text-sm text-muted-foreground">{pick("Three research paths for the challenge's three audiences. These are real sample addresses; their results still depend on the recorded rules and available facts.", "Tres recorridos de investigación para los tres públicos del reto. Son direcciones reales de la muestra; sus resultados dependen de las normas registradas y los datos disponibles.")}</p>
    <div className="grid gap-3 md:grid-cols-3">{DEMOS.map(demo => <Link key={demo.persona} href={demo.href} prefetch={false} className="group block border-2 border-primary bg-card p-4 text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" aria-label={`${pick(demo.label[0], demo.label[1])}: ${pick(demo.action[0], demo.action[1])} · ${demo.address}, ${demo.city}`}>
      <div className="mb-3 flex items-center justify-between gap-2 text-primary"><demo.icon size={22} aria-hidden="true" /><ArrowUpRight size={18} aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></div>
      <h3 className="text-sm font-semibold uppercase text-primary">{pick(demo.label[0], demo.label[1])}</h3>
      <p className="mt-2 text-sm font-medium">{pick(demo.action[0], demo.action[1])}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{pick(demo.detail[0], demo.detail[1])}</p>
      <p className="mt-3 border-t border-primary/20 pt-2 text-xs"><span className="font-semibold">{demo.address}</span><br />{demo.city} · {demo.addressId}</p>
    </Link>)}</div>
  </section>;
}
