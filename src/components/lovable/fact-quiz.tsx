"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { FACT_FIELDS, type FactField, type FactRecord, type Scalar } from "@/domain/types";
import { useLang } from "./language";

export interface FactQuizProps {
  initial: FactRecord;
  missing: string[];
  onApply: (facts: FactRecord) => void;
  onClose: () => void;
}

type EditableField = Exclude<FactField, "certificate_age_years" | "state" | "legal_city">;
type Pair = readonly [string, string];
type Question = { label: Pair; question: Pair; help: Pair; kind: "number" | "boolean" | "date" | "owner"; min?: number; max?: number; integer?: boolean };
const QUESTIONS: Record<EditableField, Question> = {
  year_built: { label: ["Year built", "Año de construcción"], question: ["In what year was the building built?", "¿En qué año se construyó el edificio?"], help: ["Use the building record. This is separate from the certificate of occupancy date.", "Usa el registro del edificio. Este dato es distinto de la fecha del certificado de ocupación."], kind: "number", min: 1000, max: 2300, integer: true },
  units: { label: ["Units in the building", "Unidades del edificio"], question: ["How many residential units are in this building?", "¿Cuántas unidades residenciales tiene este edificio?"], help: ["Enter the building's unit count, not the owner's whole portfolio.", "Introduce las unidades del edificio, no todas las propiedades del dueño."], kind: "number", min: 1, max: 100000, integer: true },
  certificate_of_occupancy_date: { label: ["Certificate of occupancy date", "Fecha del certificado de ocupación"], question: ["What is the certificate of occupancy date?", "¿Cuál es la fecha del certificado de ocupación?"], help: ["Use the date on the certificate. Its age is calculated for your evaluation date; year built does not replace it.", "Usa la fecha del certificado. Su antigüedad se calcula para la fecha de evaluación; el año de construcción no la sustituye."], kind: "date" },
  owner_type: { label: ["Owner type", "Tipo de propietario"], question: ["What type of owner is recorded for this property?", "¿Qué tipo de propietario figura para esta propiedad?"], help: ["Use ownership documents. The app does not infer an owner type from a name.", "Usa los documentos de propiedad. La aplicación no deduce el tipo de propietario por su nombre."], kind: "owner" },
  owner_occupied: { label: ["Owner occupied", "Ocupado por el propietario"], question: ["Does an owner live in this property?", "¿Vive un propietario en esta propiedad?"], help: ["Answer for the date you are evaluating.", "Responde para la fecha que estás evaluando."], kind: "boolean" },
  owner_total_properties: { label: ["Owner's total properties", "Total de propiedades del dueño"], question: ["How many properties does the owner own in total?", "¿Cuántas propiedades tiene el dueño en total?"], help: ["Include the owner's other properties. Skip if this is not known.", "Incluye las otras propiedades del dueño. Omite la pregunta si no lo sabes."], kind: "number", min: 0, max: Number.MAX_SAFE_INTEGER, integer: true },
  owner_total_units: { label: ["Owner's total units", "Total de unidades del dueño"], question: ["How many units does the owner own in total?", "¿Cuántas unidades tiene el dueño en total?"], help: ["This is the total across the owner's properties, not just this building.", "Es el total de las propiedades del dueño, no solo de este edificio."], kind: "number", min: 0, max: Number.MAX_SAFE_INTEGER, integer: true },
  tenancy_months: { label: ["Tenancy length in months", "Duración del alquiler en meses"], question: ["How many months has the tenant occupied the unit?", "¿Cuántos meses lleva el inquilino ocupando la unidad?"], help: ["Use the tenancy length as of the evaluation date. Decimal months are allowed.", "Usa la duración hasta la fecha de evaluación. Se permiten meses decimales."], kind: "number", min: 0, max: 2000 },
  construction_exemption_filed: { label: ["Construction exemption filed", "Exención de construcción presentada"], question: ["Has a construction-related exemption been filed?", "¿Se ha presentado una exención relacionada con la construcción?"], help: ["Confirm the filing from its notice or record. Year built alone does not answer this.", "Confirma la presentación con el aviso o registro. El año de construcción por sí solo no responde esta pregunta."], kind: "boolean" },
  is_subsidized: { label: ["Subsidized housing", "Vivienda subsidiada"], question: ["Is this housing subsidized?", "¿Esta vivienda es subsidiada?"], help: ["Use the tenancy or subsidy documents, or leave this unknown.", "Usa los documentos del alquiler o del subsidio, o deja el dato desconocido."], kind: "boolean" },
  is_single_family: { label: ["Single-family property", "Propiedad unifamiliar"], question: ["Is this a single-family property?", "¿Es una propiedad unifamiliar?"], help: ["Use the property record. Do not infer this from the map preview.", "Usa el registro de la propiedad. No lo deduzcas de la vista del mapa."], kind: "boolean" },
  residential_use: { label: ["Residential use", "Uso residencial"], question: ["Is the property used for residential housing?", "¿La propiedad se usa como vivienda residencial?"], help: ["Use the recorded property use for the evaluation date.", "Usa el uso registrado de la propiedad para la fecha de evaluación."], kind: "boolean" },
};
const OWNER_OPTIONS: { value: string; label: Pair }[] = [
  { value: "individual", label: ["Individual", "Persona física"] },
  { value: "corporation", label: ["Corporation", "Corporación"] },
  { value: "llc", label: ["Limited liability company (LLC)", "Sociedad de responsabilidad limitada (LLC)"] },
  { value: "reit", label: ["Real estate investment trust (REIT)", "Fideicomiso de inversión inmobiliaria (REIT)"] },
  { value: "trust", label: ["Trust", "Fideicomiso"] },
  { value: "partnership", label: ["Partnership", "Sociedad de personas"] },
  { value: "nonprofit", label: ["Nonprofit organization", "Organización sin fines de lucro"] },
  { value: "government", label: ["Government", "Gobierno"] },
];
const EDITABLE = FACT_FIELDS.filter((field): field is EditableField => Object.hasOwn(QUESTIONS, field));
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function FactQuiz({ initial, missing, onApply, onClose }: FactQuizProps) {
  const { pick } = useLang();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<FactRecord>({});
  const [drafts, setDrafts] = useState<Partial<Record<EditableField, string>>>({});
  const [customOwner, setCustomOwner] = useState(initial.owner_type != null && !OWNER_OPTIONS.some(option => option.value === String(initial.owner_type)));
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const questions = useMemo(() => {
    const requested = new Set(missing.map(field => field === "certificate_age_years" ? "certificate_of_occupancy_date" : field));
    const needed = EDITABLE.filter(field => requested.has(field));
    return needed.length ? needed : [...EDITABLE];
  }, [missing]);
  const step = Math.min(index, Math.max(questions.length - 1, 0));
  const field = questions[step];
  const question = field ? QUESTIONS[field] : null;
  const value = field ? drafts[field] ?? (initial[field] == null ? "" : String(initial[field])) : "";
  const known = FACT_FIELDS.filter(field => initial[field] != null);
  const answered = questions.filter(field => answers[field] != null);
  const boundaryMissing = missing.some(field => field === "state" || field === "legal_city" || field === "legal_municipality");
  const translate = (pair: Pair) => pick(pair[0], pair[1]);

  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const targets = () => [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(element => element.getClientRects().length > 0);
    const focusFirst = () => (dialog.current?.querySelector<HTMLElement>("[data-quiz-focus]") ?? targets()[0] ?? dialog.current)?.focus();
    const frame = window.requestAnimationFrame(focusFirst);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const elements = targets(), first = elements[0], last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.current?.focus(); return; }
      const outside = !dialog.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && dialog.current && !dialog.current.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>("[data-quiz-focus]")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step, review]);

  function advance(answer: Scalar | undefined) {
    if (!field) return;
    const next = { ...answers };
    if (answer === undefined) delete next[field];
    else next[field] = answer;
    setAnswers(next);
    setError("");
    if (step === questions.length - 1) setReview(true);
    else setIndex(step + 1);
  }

  function submit() {
    if (!question) return;
    if (question.kind === "number") {
      const number = Number(value);
      if (!value.trim() || !Number.isFinite(number) || (question.integer && !Number.isSafeInteger(number)) || number < question.min! || number > question.max!) {
        setError(question.integer ? pick("Enter a whole number within the displayed range, or skip if unknown.", "Introduce un número entero dentro del rango indicado, u omite si no lo sabes.") : pick("Enter a valid number within the displayed range, or skip if unknown.", "Introduce un número válido dentro del rango indicado, u omite si no lo sabes."));
        return;
      }
      advance(number);
    } else if (question.kind === "date") {
      const date = new Date(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        setError(pick("Enter a valid calendar date, or skip if unknown.", "Introduce una fecha válida, u omite si no la sabes.")); return;
      }
      advance(value);
    } else if (question.kind === "owner") {
      if (!value.trim() || value.trim().length > 100) { setError(pick("Choose or enter an owner type of up to 100 characters.", "Elige o introduce un tipo de propietario de hasta 100 caracteres.")); return; }
      advance(value.trim());
    }
  }

  function display(field: FactField, value: Scalar | null | undefined): string {
    if (typeof value === "boolean") return value ? pick("Yes", "Sí") : pick("No", "No");
    if (field === "owner_type") {
      const option = OWNER_OPTIONS.find(option => option.value === value);
      if (option) return translate(option.label);
    }
    return value == null ? pick("Unknown", "Desconocido") : String(value);
  }

  function fieldLabel(field: FactField): string {
    if (field === "state") return pick("State", "Estado");
    if (field === "legal_city") return pick("Legal municipality", "Municipio legal");
    if (field === "certificate_age_years") return pick("Certificate age (derived)", "Antigüedad del certificado (calculada)");
    return translate(QUESTIONS[field].label);
  }

  const inputClass = "w-full border-2 border-primary bg-background px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-primary/45 p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} tabIndex={-1} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto border-2 border-primary bg-card p-5 text-foreground shadow-xl sm:p-7">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide">
          <span>{questions.length ? (review ? pick("Review answers", "Revisar respuestas") : `${pick("Question", "Pregunta")} ${step + 1} ${pick("of", "de")} ${questions.length}`) : pick("Missing facts", "Datos faltantes")}</span>
          <button type="button" onClick={onClose} aria-label={pick("Close fact quiz", "Cerrar el cuestionario")} className="inline-flex items-center gap-1 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"><X size={16} aria-hidden="true" />{pick("Close", "Cerrar")}</button>
        </div>
        <div role="progressbar" aria-label={pick("Question progress", "Progreso del cuestionario")} aria-valuemin={0} aria-valuemax={Math.max(questions.length, 1)} aria-valuenow={review ? questions.length : questions.length ? step + 1 : 0} className="mb-5 h-2 w-full bg-muted">
          <div className="h-full bg-accent transition-all" style={{ width: `${review ? 100 : questions.length ? ((step + 1) / questions.length) * 100 : 0}%` }} />
        </div>
        <h2 id={`${id}-title`} className="mb-2 text-xl font-semibold uppercase text-primary">{pick("Fill in the missing facts", "Completa los datos faltantes")}</h2>
        <p id={`${id}-description`} className="mb-5 text-sm text-muted-foreground">{pick("Your answers are temporary, user-supplied scenario facts. They do not change the source property record. Skip anything you cannot confirm; existing source facts are retained and other fields stay unknown.", "Tus respuestas son datos temporales de un escenario proporcionados por ti. No cambian el registro original de la propiedad. Omite lo que no puedas confirmar; se conservan los datos originales y los demás campos siguen desconocidos.")}</p>

        {boundaryMissing && <p className="mb-4 border-l-4 border-accent bg-muted p-3 text-sm">{pick("State or legal-city gaps need separate jurisdiction review. This quiz cannot verify a municipal boundary.", "Los datos faltantes del estado o municipio legal requieren otra revisión de jurisdicción. Este cuestionario no verifica límites municipales.")}</p>}
        {!!known.length && <details className="mb-5 border border-primary/30 bg-background px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">{pick("Existing facts for context", "Datos existentes para contexto")} ({known.length})</summary>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">{known.map(field => <div key={field} className="contents"><dt>{fieldLabel(field)}</dt><dd className="max-w-48 break-words text-right font-medium">{display(field, initial[field])}</dd></div>)}</dl>
        </details>}

        {!questions.length ? <div className="space-y-4 border border-primary/30 bg-background p-4">
          <p>{pick("There are no editable missing facts in this lookup. Source and jurisdiction gaps still need review; this does not establish complete legal coverage.", "Esta consulta no tiene datos faltantes que se puedan editar. Las fuentes y la jurisdicción todavía pueden necesitar revisión; esto no establece una cobertura legal completa.")}</p>
          <button type="button" data-quiz-focus className="btn-primary w-full" onClick={onClose}>{pick("Return to results", "Volver a los resultados")}</button>
        </div> : review ? <div className="space-y-4">
          <h3 data-quiz-focus tabIndex={-1} className="text-lg font-medium outline-none">{pick("Review your scenario facts", "Revisa los datos de tu escenario")}</h3>
          <dl className="space-y-2">{questions.map(field => <div key={field} className="flex items-start justify-between gap-4 border-b border-primary/20 py-2 text-sm"><dt>{fieldLabel(field)}</dt><dd className="max-w-52 break-words text-right font-medium">{answers[field] == null && initial[field] != null ? `${pick("Keep current", "Conservar actual")}: ${display(field, initial[field])}` : display(field, answers[field])}</dd></div>)}</dl>
          <p className="text-sm text-muted-foreground">{pick(`${answered.length} answers will be applied to your scenario. Skipped fields retain their current value or stay unknown.`, `Se aplicarán ${answered.length} respuestas a tu escenario. Los campos omitidos conservan su valor actual o siguen desconocidos.`)}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button type="button" onClick={() => { setReview(false); setIndex(questions.length - 1); }} className="inline-flex items-center gap-1 underline underline-offset-4"><ArrowLeft size={15} aria-hidden="true" />{pick("Back", "Atrás")}</button>
            <button type="button" className="btn-accent inline-flex items-center justify-center gap-2 disabled:opacity-50" disabled={!answered.length} onClick={() => onApply({ ...answers })}><Check size={16} aria-hidden="true" />{pick("Apply scenario facts", "Aplicar datos del escenario")}</button>
          </div>
        </div> : question && field && <div>
          <h3 id={`${id}-question`} className="mb-2 text-lg font-medium">{translate(question.question)}</h3>
          <p id={`${id}-help`} className="mb-4 text-sm text-muted-foreground">{translate(question.help)}</p>
          {question.kind === "boolean" ? <div role="group" aria-labelledby={`${id}-question`} className="grid grid-cols-2 gap-3">
            {[true, false].map(answer => <button key={String(answer)} data-quiz-focus={answer ? "" : undefined} type="button" onClick={() => advance(answer)} className="btn-primary py-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">{answer ? pick("Yes", "Sí") : pick("No", "No")}</button>)}
          </div> : <form noValidate onSubmit={event => { event.preventDefault(); submit(); }} className="space-y-3">
            <label htmlFor={`${id}-input`} className="sr-only">{translate(question.label)}</label>
            {question.kind === "owner" ? <>
              <select id={`${id}-input`} data-quiz-focus className={inputClass} value={customOwner ? "__custom" : value} onChange={event => { setCustomOwner(event.target.value === "__custom"); setDrafts({ ...drafts, [field]: event.target.value === "__custom" ? "" : event.target.value }); setError(""); }} aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}>
                <option value="">{pick("Choose an owner type", "Elige un tipo de propietario")}</option>
                {OWNER_OPTIONS.map(option => <option key={option.value} value={option.value}>{translate(option.label)}</option>)}
                <option value="__custom">{pick("Other / exact recorded type", "Otro / tipo exacto registrado")}</option>
              </select>
              {customOwner && <label className="block space-y-1 text-sm">{pick("Recorded owner type", "Tipo de propietario registrado")}<input autoFocus className={inputClass} maxLength={100} value={value} onChange={event => { setDrafts({ ...drafts, [field]: event.target.value }); setError(""); }} aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} /></label>}
            </> : <input id={`${id}-input`} data-quiz-focus className={inputClass} type={question.kind === "date" ? "date" : "number"} min={question.min} max={question.max} step={question.kind === "number" ? question.integer ? 1 : "any" : undefined} value={value} onChange={event => { setDrafts({ ...drafts, [field]: event.target.value }); setError(""); }} aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} />}
            {question.kind === "number" && <p className="text-xs text-muted-foreground">{question.max === Number.MAX_SAFE_INTEGER ? pick("Enter 0 or a positive whole number.", "Introduce 0 o un número entero positivo.") : `${pick("Allowed range", "Rango permitido")}: ${question.min}–${question.max}`}</p>}
            {error && <p id={`${id}-error`} className="text-sm text-destructive" role="alert">{error}</p>}
            <button type="submit" className="btn-accent inline-flex w-full items-center justify-center gap-2">{step === questions.length - 1 ? pick("Review answers", "Revisar respuestas") : pick("Next", "Siguiente")}<ArrowRight size={15} aria-hidden="true" /></button>
          </form>}
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            <button type="button" disabled={step === 0} className="inline-flex items-center gap-1 underline underline-offset-4 disabled:opacity-30" onClick={() => { setIndex(step - 1); setError(""); }}><ArrowLeft size={15} aria-hidden="true" />{pick("Back", "Atrás")}</button>
            <button type="button" className="underline underline-offset-4" onClick={() => advance(undefined)}>{pick("Not sure — skip", "No sé — omitir")}</button>
          </div>
        </div>}
      </div>
    </div>
  );
}
