"use client";

import Link from "next/link";
import { SiteHeader } from "./site-header";
import { useLang } from "./language";

const topics = [
  {
    en: "Rent increases", es: "Aumentos de renta",
    question: "Does a rent limit cover this building, on this date?",
    pregunta: "¿Un límite de renta cubre este edificio en esta fecha?",
    detail: "Look for the applicable formula, building-age conditions, exemptions, and the notice period in the cited source. A statewide rule and a city rule may interact.",
    detalle: "Busque la fórmula aplicable, las condiciones sobre la edad del edificio, las exenciones y el plazo de aviso en la fuente citada. Una regla estatal y una municipal pueden interactuar.",
  },
  {
    en: "Just-cause eviction", es: "Desalojo por causa justificada",
    question: "What grounds and notices are required to end this tenancy?",
    pregunta: "¿Qué motivos y avisos se requieren para terminar este arrendamiento?",
    detail: "Check whether a reviewed rule covers the tenancy, the permitted grounds, and any notice or relocation conditions. Tenancy length and ownership facts can affect the result.",
    detalle: "Compruebe si una regla revisada cubre el arrendamiento, los motivos permitidos y las condiciones de aviso o reubicación. La duración del arrendamiento y los datos del propietario pueden afectar el resultado.",
  },
  {
    en: "Security deposits", es: "Depósitos de seguridad",
    question: "What deposit and return requirements apply?",
    pregunta: "¿Qué requisitos se aplican al depósito y a su devolución?",
    detail: "Research deposit limits, permitted deductions, return deadlines, and exceptions. The chosen date matters when a requirement changes.",
    detalle: "Investigue los límites del depósito, las deducciones permitidas, los plazos de devolución y las excepciones. La fecha elegida importa cuando cambia un requisito.",
  },
  {
    en: "Application and screening fees", es: "Tarifas de solicitud y evaluación",
    question: "Which charges, limits, and refund conditions need checking?",
    pregunta: "¿Qué cargos, límites y condiciones de reembolso hay que comprobar?",
    detail: "Read the source for the particular fee, who may charge it, the required disclosures, and any refund conditions. Do not assume that every application charge is treated the same way.",
    detalle: "Lea la fuente para conocer la tarifa específica, quién puede cobrarla, las divulgaciones requeridas y las condiciones de reembolso. No suponga que todos los cargos de solicitud reciben el mismo tratamiento.",
  },
  {
    en: "Screening restrictions", es: "Restricciones de evaluación",
    question: "Which information may be considered in a rental application?",
    pregunta: "¿Qué información se puede considerar en una solicitud de alquiler?",
    detail: "Research rules about criminal records, eviction history, income sources, and screening procedures. Check their jurisdiction, exceptions, and effective dates in the evidence.",
    detalle: "Investigue las reglas sobre antecedentes penales, historial de desalojo, fuentes de ingresos y procedimientos de evaluación. Compruebe la jurisdicción, las excepciones y las fechas de vigencia en la evidencia.",
  },
  {
    en: "Algorithmic rent setting", es: "Fijación algorítmica de rentas",
    question: "Is the cited restriction in force, or still a proposal?",
    pregunta: "¿La restricción citada está vigente o sigue siendo una propuesta?",
    detail: "Check the activities and software covered, the jurisdiction, and the legislative stage. A pending or failed proposal does not establish an enforceable requirement.",
    detalle: "Compruebe las actividades y el software cubiertos, la jurisdicción y la etapa legislativa. Una propuesta pendiente o fallida no establece un requisito exigible.",
  },
] as const;

function PageFooter() {
  const { pick } = useLang();
  return <footer className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t-2 border-primary pt-6 text-sm">
    <Link href="/" className="font-semibold underline underline-offset-4">{pick("Search the property sample", "Buscar en la muestra de propiedades")}</Link>
    <Link href="/workspace?view=sources" prefetch={false} className="underline underline-offset-4">{pick("Explore the official source library", "Explorar la biblioteca de fuentes oficiales")}</Link>
  </footer>;
}

export function AboutPage() {
  const { t, pick } = useLang();
  const statuses = [
    { label: t("applicable"), badge: "bg-primary text-primary-foreground", en: "A reviewed rule meets the date and coverage conditions recorded for this scenario. Read its evidence and any conflict notice before relying on it.", es: "Una regla revisada cumple las condiciones de fecha y cobertura registradas para este escenario. Lea la evidencia y cualquier aviso de conflicto antes de basarse en ella." },
    { label: t("unknown"), badge: "bg-accent text-accent-foreground", en: "The available facts or jurisdiction evidence do not support a definite result. Supplying a missing fact may help; it does not guarantee complete coverage.", es: "Los datos disponibles o la evidencia de jurisdicción no permiten un resultado definitivo. Añadir un dato faltante puede ayudar; no garantiza una cobertura completa." },
    { label: t("notYetEffective"), badge: "border border-primary bg-card", en: "The recorded effective date is after the date selected for the search.", es: "La fecha de entrada en vigor registrada es posterior a la fecha seleccionada para la búsqueda." },
    { label: t("pending"), badge: "border border-dashed border-primary bg-card", en: "The source describes a proposal. It is not treated as an in-force requirement.", es: "La fuente describe una propuesta. No se trata como un requisito vigente." },
    { label: pick("Superseded", "Sustituida"), badge: "bg-muted text-muted-foreground", en: "A recorded interaction with another reviewed rule removes this rule from the applicable results for the scenario. Inspect the explanation for the reason.", es: "Una interacción registrada con otra regla revisada excluye esta regla de los resultados aplicables al escenario. Consulte la explicación para conocer el motivo." },
  ];
  return <div className="min-h-screen">
    <SiteHeader />
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-16">
      <h1 className="section-title text-3xl">{pick("About LexRent", "Acerca de LexRent")}</h1>
      <p className="text-lg leading-relaxed">{pick("LexRent helps you research rental housing rules, see the law behind a result, and understand what information is still missing.", "LexRent le ayuda a investigar las reglas de vivienda de alquiler, ver la ley detrás de un resultado y comprender qué información todavía falta.")}</p>
      <p>{pick("This challenge app uses a supplied sample of 500 property records in California, New Jersey, and Massachusetts, together with a source library of state and local materials. Coverage depends on the sources captured and the rules reviewed for the app.", "Esta aplicación del reto utiliza una muestra proporcionada de 500 registros de propiedades de California, Nueva Jersey y Massachusetts, junto con una biblioteca de materiales estatales y locales. La cobertura depende de las fuentes capturadas y las reglas revisadas para la aplicación.")}</p>
      <div className="border-l-4 border-accent bg-card p-5">
        <h2 className="section-title mb-2 text-lg">{pick("Address + date + evidence", "Dirección + fecha + evidencia")}</h2>
        <p className="text-sm leading-relaxed">{pick("Select a supplied property and an as-of date. The app evaluates reviewed rules against the available property facts, dates, and recorded rule interactions. A postal city is a candidate, not proof of a legal city boundary; unresolved jurisdiction is shown explicitly.", "Seleccione una propiedad de la muestra y una fecha de consulta. La aplicación evalúa las reglas revisadas según los datos disponibles de la propiedad, las fechas y las interacciones registradas entre reglas. Una ciudad postal es una candidata, no una prueba del límite municipal legal; una jurisdicción sin resolver se muestra explícitamente.")}</p>
      </div>
      <h2 className="section-title pt-4 text-2xl">{pick("What the result labels mean", "Qué significan las etiquetas de resultado")}</h2>
      <ul className="space-y-4">
        {statuses.map(status => <li key={status.en} className="flex flex-col items-start gap-2 sm:flex-row sm:gap-3">
          <span className={`shrink-0 px-2 py-1 text-xs font-semibold ${status.badge}`}>{status.label}</span>
          <span className="text-sm leading-relaxed">{pick(status.en, status.es)}</span>
        </li>)}
      </ul>
      <p className="text-sm text-muted-foreground">{pick("Failed proposals are retained as source history and do not become in-force protections. A missing result does not establish that no law applies.", "Las propuestas fallidas se conservan como historial de fuentes y no se convierten en protecciones vigentes. La ausencia de un resultado no demuestra que ninguna ley se aplique.")}</p>
      <h2 className="section-title pt-4 text-2xl">{pick("Follow the evidence", "Siga la evidencia")}</h2>
      <p>{pick("A rule’s evidence view shows its source, exact captured quote, retrieval date, and coverage reasoning. The retrieval date records when a source was captured; the effective date records when a rule takes effect. They serve different purposes.", "La vista de evidencia de una regla muestra su fuente, la cita exacta capturada, la fecha de recuperación y el razonamiento de cobertura. La fecha de recuperación registra cuándo se capturó una fuente; la fecha de entrada en vigor registra cuándo empieza a regir una regla. Tienen funciones distintas.")}</p>
      <p>{pick("The AI research assistant searches the captured source library and returns source excerpts for inspection. Its answers are research aids. Review the official text, missing facts, and conflicts before making a decision.", "El asistente de investigación con IA busca en la biblioteca de fuentes capturadas y devuelve extractos para su revisión. Sus respuestas son ayudas de investigación. Revise el texto oficial, los datos faltantes y los conflictos antes de tomar una decisión.")}</p>
      <p className="border-2 border-primary bg-card p-4 text-sm">{t("notLegalAdvice")}</p>
      <PageFooter />
    </main>
  </div>;
}

export function RightsPage() {
  const { t, pick } = useLang();
  return <div className="min-h-screen">
    <SiteHeader />
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="section-title mb-6 text-3xl">{t("rights")}</h1>
      <p className="mb-5 text-lg leading-relaxed">{pick("Start with the right questions. These six topics guide your research; the answer depends on the location, date, building, and tenancy facts.", "Empiece con las preguntas adecuadas. Estos seis temas orientan su investigación; la respuesta depende de la ubicación, la fecha y los datos del edificio y del arrendamiento.")}</p>
      <div className="mb-10 border-2 border-primary bg-card p-4">
        <p className="mb-3 text-sm font-semibold">{pick("The supplied property sample covers:", "La muestra de propiedades proporcionada cubre:")}</p>
        <ul className="flex flex-wrap gap-2" aria-label={pick("Covered sample states", "Estados de la muestra")}>
          {[pick("California", "California"), pick("New Jersey", "Nueva Jersey"), pick("Massachusetts", "Massachusetts")].map(state => <li key={state} className="border border-primary bg-background px-3 py-1 text-xs font-semibold uppercase">{state}</li>)}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{pick("Local rules may add conditions or change the result. Confirm the legal jurisdiction and inspect the cited evidence for your chosen date.", "Las reglas locales pueden añadir condiciones o cambiar el resultado. Confirme la jurisdicción legal y consulte la evidencia citada para la fecha elegida.")}</p>
      </div>
      <div className="space-y-7">
        {topics.map(topic => <section key={topic.en} className="border-l-4 border-accent pl-4">
          <h2 className="text-xl font-semibold">{pick(topic.en, topic.es)}</h2>
          <p className="mt-2 font-medium">{pick(topic.question, topic.pregunta)}</p>
          <p className="mt-2 text-sm leading-relaxed">{pick(topic.detail, topic.detalle)}</p>
        </section>)}
      </div>
      <div className="mt-10 border-2 border-primary bg-card p-5">
        <h2 className="section-title mb-3 text-xl">{pick("Turn a question into a source check", "Convierta una pregunta en una revisión de fuentes")}</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          <li>{pick("Choose a supplied property and the date you want to research.", "Elija una propiedad de la muestra y la fecha que desea investigar.")}</li>
          <li>{pick("Review missing facts, jurisdiction status, and the result for each reviewed rule.", "Revise los datos faltantes, el estado de la jurisdicción y el resultado de cada regla revisada.")}</li>
          <li>{pick("Open the evidence and verify the quoted text against the official source.", "Abra la evidencia y verifique el texto citado con la fuente oficial.")}</li>
        </ol>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">{t("notLegalAdvice")}</p>
      <PageFooter />
    </main>
  </div>;
}
