import { Link } from "@tanstack/react-router";
import { useLang } from "@/lib/i18n";

export function SiteHeader() {
  const { lang, setLang, t } = useLang();
  return (
    <>
    <header className="flex items-stretch border-b-2 border-primary bg-background">
      <Link to="/" className="flex items-center bg-primary px-6 py-4 text-2xl font-bold tracking-wide text-primary-foreground">
        LEXRENT
      </Link>
      <nav className="flex items-center gap-6 px-6 text-sm">
        <Link to="/about" className="hover:underline" activeProps={{ className: "underline" }}>{t("about")}</Link>
        <Link to="/rights" className="hover:underline" activeProps={{ className: "underline" }}>{t("rights")}</Link>
      </nav>
      <div className="ml-auto flex items-center gap-1 px-6 text-sm">
        <button onClick={() => setLang("en")} className={lang === "en" ? "font-bold" : "opacity-70 hover:opacity-100"}>EN</button>
        <span>/</span>
        <button onClick={() => setLang("es")} className={lang === "es" ? "font-bold" : "opacity-70 hover:opacity-100"}>ES</button>
      </div>
    </header>
    <div role="note" className="border-b border-primary bg-accent px-6 py-1.5 text-center text-xs text-accent-foreground">
      <strong>⚖</strong> {t("notLegalAdvice")}
    </div>
    </>
  );
}
