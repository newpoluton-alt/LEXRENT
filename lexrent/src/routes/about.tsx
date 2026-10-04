import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { useLang } from "@/lib/i18n";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About LexRent — How we find your tenant laws" },
      { name: "description", content: "How LexRent matches a US address and date to federal, state and city rental laws." },
      { property: "og:title", content: "About LexRent" },
      { property: "og:description", content: "How LexRent matches your address to the rental laws that apply." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: About,
});

function About() {
  const { lang, t } = useLang();
  const es = lang === "es";

  const statuses: { key: Parameters<typeof t>[0]; badge: string; en: string; esEs: string }[] = [
    {
      key: "applicable",
      badge: "bg-primary text-primary-foreground",
      en: "This law is in force where the address is, on the date you chose.",
      esEs: "Esta ley está vigente donde se encuentra la dirección, en la fecha elegida.",
    },
    {
      key: "notYetEffective",
      badge: "border border-primary bg-card",
      en: "The law was passed or signed, but it does not take effect until a future date.",
      esEs: "La ley fue aprobada o firmada, pero no entra en vigor hasta una fecha futura.",
    },
    {
      key: "pending",
      badge: "border border-dashed border-primary bg-card",
      en: "This is a proposal (a bill or motion) that is still being considered. It is not law yet and may never be.",
      esEs: "Es una propuesta (proyecto de ley o moción) que aún se está considerando. Todavía no es ley y puede que nunca lo sea.",
    },
    {
      key: "failed",
      badge: "bg-muted line-through",
      en: "The proposal was rejected, vetoed or withdrawn. It has no legal effect.",
      esEs: "La propuesta fue rechazada, vetada o retirada. No tiene efecto legal.",
    },
    {
      key: "notApplicable",
      badge: "bg-muted text-muted-foreground",
      en: "The law exists, but it does not cover your building or situation (for example, it applies only to new buildings).",
      esEs: "La ley existe, pero no cubre su edificio o situación (por ejemplo, aplica solo a edificios nuevos).",
    },
    {
      key: "unknown",
      badge: "bg-accent text-accent-foreground",
      en: "We could not decide with the information you gave. Answering the missing-information questions can turn this into a clear answer.",
      esEs: "No pudimos decidirlo con la información que dio. Responder las preguntas de información faltante puede convertir esto en una respuesta clara.",
    },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-16">
        <h1 className="section-title text-3xl">{es ? "Acerca de LexRent" : "About LexRent"}</h1>
        <p>{es
          ? "LexRent busca direcciones reales de EE.UU., ubica el edificio exacto en el mapa y compara su ubicación y fecha con leyes federales, estatales y municipales en seis categorías."
          : "LexRent looks up real US addresses, locates the exact building on the map and checks its location and date against federal, state and city laws in six categories."}</p>
        <p>{es
          ? "Datos de direcciones y edificios: OpenStreetMap. Datos de edificios de NYC: HPD, 311 y Departamento de Investigación. LexRent no es asesoría legal."
          : "Address and building data: OpenStreetMap. NYC building data: HPD, 311 and the Department of Investigation. LexRent is not legal advice."}</p>

        <h2 className="pt-4 section-title text-2xl">{es ? "Qué significan las etiquetas de estado" : "What the status labels mean"}</h2>
        <p>{es
          ? "Cada ley en sus resultados lleva una de estas seis etiquetas:"
          : "Every law in your results carries one of these six labels:"}</p>
        <ul className="space-y-3">
          {statuses.map(({ key, badge, en, esEs }) => (
            <li key={key} className="flex items-start gap-3">
              <span className={`shrink-0 px-2 py-1 text-xs font-semibold ${badge}`}>{t(key)}</span>
              <span className="text-sm">{es ? esEs : en}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{es
          ? "En la vista de evidencia de cada ley también encontrará la fecha de recuperación, la cita de la fuente y el razonamiento paso a paso."
          : "Each law's evidence view also shows the retrieval date, the source quote and the step-by-step reasoning."}</p>
      </main>
    </div>
  );
}
