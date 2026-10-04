"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SiteHeader } from "@/components/lovable/site-header";
import { useLang } from "@/components/lovable/language";

const primaryButton = "flex min-h-12 w-full items-center justify-center gap-2 border-2 border-primary bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60";
const outlineButton = "flex min-h-12 w-full items-center justify-center gap-2 border-2 border-primary bg-card px-5 py-3 text-sm font-semibold text-primary transition-colors hover:bg-accent/30 disabled:cursor-wait disabled:opacity-60";
const inputStyle = "mt-2 w-full border-2 border-primary bg-background px-3 py-3 text-base font-normal text-foreground placeholder:text-muted-foreground focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:opacity-60";

function returnPath() {
  const path = new URLSearchParams(window.location.search).get("next") || "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  try { return new URL(path, window.location.origin).origin === window.location.origin ? path : "/"; } catch { return "/"; }
}

export default function SignInPage() {
  const { pick } = useLang();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [account, setAccount] = useState<{ name?: string; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/me", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(response => response.json())
      .then(data => {
        if (controller.signal.aborted) return;
        setConfigured(Boolean(data.auth_configured));
        setAccount(data.user ?? null);
      })
      .catch(() => { if (!controller.signal.aborted) setConfigured(false); });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message || pick("We couldn’t complete that request. Please try again.", "No pudimos completar la solicitud. Inténtelo de nuevo."));
      window.location.assign(returnPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pick("We couldn’t complete that request.", "No pudimos completar la solicitud."));
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setLoading(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || pick("Sign-out could not be completed.", "No se pudo cerrar la sesión."));
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pick("Sign-out could not be completed.", "No se pudo cerrar la sesión."));
      setLoading(false);
    }
  }

  async function googleSignIn() {
    setLoading(true);
    setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: new URL(returnPath(), window.location.origin).href });
      if (result.error) throw new Error(result.error.message || pick("Google sign-in could not be started.", "No se pudo iniciar sesión con Google."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pick("Google sign-in could not be started.", "No se pudo iniciar sesión con Google."));
      setLoading(false);
    }
  }

  return <div className="min-h-screen">
    <SiteHeader />
    <main className="mx-auto max-w-xl px-4 py-12 sm:py-16">
      <Link href="/" className="mb-8 inline-flex min-h-10 items-center gap-2 text-sm underline underline-offset-4"><ArrowLeft size={16} aria-hidden="true" />{pick("Back to property search", "Volver a buscar propiedades")}</Link>
      <section className="border-2 border-primary bg-card" aria-labelledby="account-title">
        <div className="border-b-2 border-primary bg-accent px-5 py-3 sm:px-7">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"><LockKeyhole size={15} aria-hidden="true" />{pick("Your LexRent account", "Su cuenta de LexRent")}</p>
        </div>
        <div className="space-y-6 px-5 py-7 sm:px-7 sm:py-8">
          <div>
            <h1 id="account-title" className="section-title text-2xl">{account ? pick("You’re signed in", "Ha iniciado sesión") : mode === "sign-in" ? pick("Sign in", "Iniciar sesión") : pick("Create an account", "Crear una cuenta")}</h1>
            <p className="mt-3 text-sm leading-relaxed">{account
              ? pick("Your account is ready for saved properties and the AI research assistant.", "Su cuenta está lista para las propiedades guardadas y el asistente de investigación con IA.")
              : pick("Sign in to save properties and use the source-backed AI research assistant. Property search and the source library are available to everyone.", "Inicie sesión para guardar propiedades y usar el asistente de investigación con IA basado en fuentes. La búsqueda de propiedades y la biblioteca de fuentes están disponibles para todos.")}</p>
          </div>

          {error && <div role="alert" className="border-2 border-primary bg-accent/30 p-4 text-sm leading-relaxed">{error}</div>}

          {account ? <div className="space-y-5">
            <dl className="space-y-3 border-l-4 border-accent pl-4 text-sm">
              {account.name && <div><dt className="font-semibold">{pick("Name", "Nombre")}</dt><dd className="mt-1 break-words">{account.name}</dd></div>}
              <div><dt className="font-semibold">{pick("Email address", "Correo electrónico")}</dt><dd className="mt-1 break-all">{account.email}</dd></div>
            </dl>
            <Link href="/workspace" prefetch={false} className={primaryButton}>{pick("Open workspace", "Abrir el espacio de trabajo")}<ArrowRight size={16} aria-hidden="true" /></Link>
            <button type="button" className={outlineButton} disabled={loading} onClick={() => void signOut()}>{loading && <LoaderCircle className="animate-spin motion-reduce:animate-none" size={16} aria-hidden="true" />}{pick("Sign out", "Cerrar sesión")}</button>
          </div> : configured === false ? <div className="space-y-4 border-l-4 border-accent pl-4">
            <h2 className="font-semibold">{pick("Account access is unavailable", "El acceso a cuentas no está disponible")}</h2>
            <p className="text-sm leading-relaxed">{pick("Sign-in is not available in this environment right now. You can still explore the supplied properties, original sources, and law-change cases.", "El inicio de sesión no está disponible en este entorno en este momento. Puede explorar las propiedades de la muestra, las fuentes originales y los casos de cambios de leyes.")}</p>
            <Link href="/workspace" prefetch={false} className={outlineButton}>{pick("Explore the public workspace", "Explorar el espacio público")}<ArrowRight size={16} aria-hidden="true" /></Link>
          </div> : configured === null ? <div role="status" className="flex items-center gap-3 text-sm"><LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{pick("Checking account availability…", "Comprobando la disponibilidad de cuentas…")}</div> : <>
            <button type="button" className={outlineButton} disabled={loading} onClick={() => void googleSignIn()}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.7 2.9-4.3 2.9-7.6Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6a6 6 0 0 1-9-3.1H3v2.7A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.4H3a10 10 0 0 0 0 9.2l3.4-2.7Z" /><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.8A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3 7.4l3.4 2.7A6 6 0 0 1 12 6Z" /></svg>
              {pick("Continue with Google", "Continuar con Google")}
            </button>
            <div className="flex items-center gap-4 text-xs text-muted-foreground"><span className="h-px flex-1 bg-primary/30" /><span>{pick("or use email", "o use el correo electrónico")}</span><span className="h-px flex-1 bg-primary/30" /></div>
            <form className="space-y-5" onSubmit={submit} aria-busy={loading}>
              {mode === "sign-up" && <label className="block text-sm font-semibold">{pick("Full name", "Nombre completo")}<input className={inputStyle} name="name" autoComplete="name" required disabled={loading} value={name} onChange={event => setName(event.target.value)} placeholder={pick("Your name", "Su nombre")} /></label>}
              <label className="block text-sm font-semibold">{pick("Email address", "Correo electrónico")}<input className={inputStyle} name="email" type="email" autoComplete="email" required disabled={loading} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
              <label className="block text-sm font-semibold">{pick("Password", "Contraseña")}<input className={inputStyle} name="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required disabled={loading} value={password} onChange={event => setPassword(event.target.value)} placeholder={pick("At least 8 characters", "Al menos 8 caracteres")} /></label>
              <button className={primaryButton} disabled={loading} type="submit">{loading ? <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}{loading ? pick("Please wait…", "Espere…") : mode === "sign-in" ? pick("Sign in", "Iniciar sesión") : pick("Create account", "Crear cuenta")}</button>
            </form>
            <div className="flex flex-wrap items-center justify-center gap-x-2 text-sm">
              <span>{mode === "sign-in" ? pick("New to LexRent?", "¿Es nuevo en LexRent?") : pick("Already have an account?", "¿Ya tiene una cuenta?")}</span>
              <button type="button" disabled={loading} className="min-h-10 font-semibold underline underline-offset-4 disabled:opacity-60" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); }}>{mode === "sign-in" ? pick("Create an account", "Crear una cuenta") : pick("Sign in", "Iniciar sesión")}</button>
            </div>
          </>}
        </div>
        <div className="flex items-center justify-center gap-2 border-t border-primary px-5 py-3 text-xs text-muted-foreground"><LockKeyhole size={13} aria-hidden="true" />{pick("Account access powered by Neon Auth", "Acceso a cuentas con Neon Auth")}</div>
      </section>
      <p className="mt-6 text-center text-xs text-muted-foreground">LEXRENT · {pick("Rental Housing Law Navigator", "Navegador de leyes de vivienda de alquiler")}</p>
    </main>
  </div>;
}
