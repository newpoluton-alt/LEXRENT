"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { accountDisplayName, useAccount } from "@/lib/account-state";
import { useLang } from "./language";

export function SiteHeader() {
  const { lang, setLang, t, pick } = useLang();
  const pathname = usePathname();
  const account = useAccount(pathname);
  const links = [{ href: "/about", label: t("about") }, { href: "/rights", label: t("rights") }, { href: "/workspace", label: t("workspace") }];
  return <>
    <header className="flex flex-wrap items-stretch border-b-2 border-primary bg-background">
      <Link href="/" className="flex items-center bg-primary px-4 py-3 text-xl font-bold tracking-wide text-primary-foreground sm:px-6 sm:py-4 sm:text-2xl">LEXRENT</Link>
      <nav aria-label={pick("Main navigation", "Navegación principal")} className="order-3 flex w-full flex-wrap items-center gap-x-5 gap-y-2 border-t border-primary px-4 py-3 text-xs sm:order-none sm:w-auto sm:border-0 sm:px-6 sm:py-0 sm:text-sm">
        {links.map(link => <Link key={link.href} href={link.href} prefetch={link.href === "/workspace" ? false : undefined} aria-current={pathname === link.href ? "page" : undefined} className={`hover:underline ${pathname === link.href ? "underline" : ""}`}>{link.label}</Link>)}
      </nav>
      <div className="ml-auto flex items-center gap-4 px-4 text-xs sm:px-6 sm:text-sm">
        <Link href="/sign-in" prefetch={false} aria-label={account.user ? `${t("account")}: ${accountDisplayName(account.user)}` : t("signIn")} title={account.user ? accountDisplayName(account.user) : undefined} className="max-w-28 truncate hover:underline sm:max-w-48">{account.user ? accountDisplayName(account.user) : account.pending ? pick("Checking…", "Comprobando…") : t("signIn")}</Link>
        <div className="flex items-center gap-1" role="group" aria-label={pick("Language", "Idioma")}>
          <button type="button" onClick={() => setLang("en")} aria-pressed={lang === "en"} aria-label="English" className={`min-h-10 px-1 ${lang === "en" ? "font-bold" : "opacity-70 hover:opacity-100"}`}>EN</button>
          <span aria-hidden="true">/</span>
          <button type="button" onClick={() => setLang("es")} aria-pressed={lang === "es"} aria-label="Español" className={`min-h-10 px-1 ${lang === "es" ? "font-bold" : "opacity-70 hover:opacity-100"}`}>ES</button>
        </div>
      </div>
    </header>
    <div role="note" className="border-b border-primary bg-accent px-4 py-1.5 text-center text-xs leading-relaxed text-accent-foreground sm:px-6"><strong aria-hidden="true">⚖</strong> {t("notLegalAdvice")}</div>
  </>;
}

export default SiteHeader;
