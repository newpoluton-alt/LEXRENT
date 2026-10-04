import { isNYC, type Place } from "./geo";

export type Lang = "en" | "es";
export type L = { en: string; es: string };
export type Category = "rent" | "eviction" | "deposit" | "fees" | "screening" | "algorithmic";
export const CATEGORIES: Category[] = ["rent", "eviction", "deposit", "fees", "screening", "algorithmic"];
export const CATEGORY_LABEL: Record<Category, L> = {
  rent: { en: "Rent increase limits", es: "Límites al aumento de renta" },
  eviction: { en: "Just-cause eviction", es: "Desalojo con causa justificada" },
  deposit: { en: "Security deposits", es: "Depósitos de garantía" },
  fees: { en: "Application & screening fees", es: "Tarifas de solicitud y evaluación" },
  screening: { en: "Screening restrictions", es: "Restricciones de evaluación" },
  algorithmic: { en: "Algorithmic rent-setting", es: "Fijación algorítmica de renta" },
};

export type Facts = {
  yearBuilt?: number;
  units?: number;
  ownerOccupied?: boolean;
  corporateOwner?: boolean;
  subsidized?: boolean;
  rentStabilized?: boolean;
  smallLandlord?: boolean;
};
export type FactKey = keyof Facts;
export const NUMERIC_FACTS: FactKey[] = ["yearBuilt", "units"];

type Loc = Pick<Place, "stateCode" | "city" | "district" | "county">;
type Applies = (f: Facts, year: number) => boolean | undefined;

export type Law = {
  id: string;
  category: Category;
  level: 0 | 1 | 2;
  jurisdiction: string;
  match: (l: Loc) => boolean;
  lawNo: string;
  title: L;
  desc: L;
  source: { name: string; url: string };
  effective: string;
  sunset?: string;
  needs?: FactKey[];
  applies?: Applies;
  stage?: "enacted" | "pending" | "failed";
};

const fed = () => true;
const st = (code: string) => (l: Loc) => l.stateCode === code;
const city = (code: string, re: RegExp) => (l: Loc) =>
  l.stateCode === code && re.test([l.city, l.district, l.county].filter(Boolean).join(" "));
const nyc = (l: Loc) => isNYC(l);
const t = (en: string, es: string): L => ({ en, es });

const ageAtLeast = (n: number): Applies => (f, y) => (f.yearBuilt === undefined ? undefined : y - f.yearBuilt >= n);

const caTPA: Applies = (f, y) => {
  if (f.yearBuilt !== undefined && y - f.yearBuilt < 15) return false;
  if (f.units === 1) {
    if (f.corporateOwner === undefined) return undefined;
    if (!f.corporateOwner) return false;
  }
  if (f.yearBuilt === undefined || f.units === undefined) return undefined;
  return true;
};
const nyGCE: Applies = (f) => {
  if (f.rentStabilized || f.subsidized) return false;
  if (f.yearBuilt !== undefined && f.yearBuilt >= 2009) return false;
  if (f.smallLandlord) return false;
  if ([f.rentStabilized, f.subsidized, f.yearBuilt, f.smallLandlord].some((x) => x === undefined)) return undefined;
  return true;
};

export const LAWS: Law[] = [
  // ---------- Federal ----------
  { id: "fha", category: "screening", level: 0, jurisdiction: "Federal", match: fed, lawNo: "42 U.S.C. §3601",
    title: t("Fair Housing Act", "Ley de Vivienda Justa"),
    desc: t("Bans discrimination in tenant screening based on race, color, religion, sex, national origin, familial status or disability.", "Prohíbe la discriminación en la evaluación de inquilinos por raza, color, religión, sexo, origen nacional, situación familiar o discapacidad."),
    source: { name: "HUD", url: "https://www.hud.gov/program_offices/fair_housing_equal_opp/fair_housing_act_overview" }, effective: "1968-04-11" },
  { id: "fcra", category: "screening", level: 0, jurisdiction: "Federal", match: fed, lawNo: "15 U.S.C. §1681",
    title: t("Fair Credit Reporting Act", "Ley de Informe Justo de Crédito"),
    desc: t("If a screening report is used to deny you, the landlord must give an adverse-action notice; you can dispute errors for free.", "Si un informe de evaluación se usa para rechazarle, el arrendador debe notificarle; puede disputar errores gratis."),
    source: { name: "CFPB", url: "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/" }, effective: "1970-10-26" },
  { id: "cares", category: "eviction", level: 0, jurisdiction: "Federal", match: fed, lawNo: "15 U.S.C. §9058(c)",
    title: t("CARES Act 30-day notice", "Aviso de 30 días de la Ley CARES"),
    desc: t("Covered properties (federally subsidized or with federally backed mortgages) must give 30 days' notice before filing for nonpayment.", "Las propiedades cubiertas (subsidiadas o con hipoteca respaldada federalmente) deben dar 30 días de aviso antes de demandar por falta de pago."),
    source: { name: "Congress.gov", url: "https://www.law.cornell.edu/uscode/text/15/9058" }, effective: "2020-03-27",
    needs: ["subsidized"], applies: (f) => f.subsidized },
  { id: "sherman", category: "algorithmic", level: 0, jurisdiction: "Federal", match: fed, lawNo: "15 U.S.C. §1",
    title: t("Sherman Act — U.S. v. RealPage", "Ley Sherman — EE.UU. v. RealPage"),
    desc: t("Landlords sharing nonpublic rent data through common pricing software may be unlawful collusion; DOJ sued RealPage in 2024.", "Compartir datos de renta no públicos mediante software de precios común puede ser colusión ilegal; el DOJ demandó a RealPage en 2024."),
    source: { name: "U.S. DOJ", url: "https://www.justice.gov/opa/pr/justice-department-sues-realpage-algorithmic-pricing-scheme-harms-millions-american-renters" }, effective: "1890-07-02" },

  // ---------- California ----------
  { id: "ca-1947.12", category: "rent", level: 1, jurisdiction: "California", match: st("CA"), lawNo: "Civ. Code §1947.12 (AB 1482)",
    title: t("Tenant Protection Act rent cap", "Tope de renta de la Ley de Protección al Inquilino"),
    desc: t("Annual increases capped at 5% + local CPI, max 10%, for buildings over 15 years old.", "Aumentos anuales limitados a 5% + IPC local, máximo 10%, en edificios con más de 15 años."),
    source: { name: "CA Legislature", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1947.12&lawCode=CIV" },
    effective: "2020-01-01", sunset: "2030-01-01", needs: ["yearBuilt", "units", "corporateOwner"], applies: caTPA },
  { id: "ca-1946.2", category: "eviction", level: 1, jurisdiction: "California", match: st("CA"), lawNo: "Civ. Code §1946.2",
    title: t("Just cause after 12 months", "Causa justificada tras 12 meses"),
    desc: t("After 12 months, a landlord needs a listed just cause to terminate; no-fault evictions require one month's rent in relocation aid.", "Tras 12 meses, el arrendador necesita una causa justificada; los desalojos sin culpa requieren un mes de renta como ayuda de reubicación."),
    source: { name: "CA Legislature", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1946.2&lawCode=CIV" },
    effective: "2020-01-01", sunset: "2030-01-01", needs: ["yearBuilt", "units", "corporateOwner"], applies: caTPA },
  { id: "ca-1950.5", category: "deposit", level: 1, jurisdiction: "California", match: st("CA"), lawNo: "Civ. Code §1950.5 (AB 12)",
    title: t("Deposit cap of one month", "Depósito máximo de un mes"),
    desc: t("Deposits limited to one month's rent; qualifying small landlords may charge up to two months.", "Depósitos limitados a un mes de renta; pequeños arrendadores calificados pueden cobrar hasta dos meses."),
    source: { name: "CA Legislature", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1950.5&lawCode=CIV" }, effective: "2024-07-01" },
  { id: "ca-1950.6", category: "fees", level: 1, jurisdiction: "California", match: st("CA"), lawNo: "Civ. Code §1950.6 (AB 2493)",
    title: t("Screening fee cap", "Tope a la tarifa de evaluación"),
    desc: t("Screening fees are capped (CPI-adjusted) with a receipt and copy of the report; no fee if no unit is available.", "Las tarifas de evaluación tienen tope (ajustado al IPC), con recibo y copia del informe; no se cobra si no hay unidad disponible."),
    source: { name: "CA Legislature", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1950.6&lawCode=CIV" }, effective: "2025-01-01" },
  { id: "ca-sb267", category: "screening", level: 1, jurisdiction: "California", match: st("CA"), lawNo: "Gov. Code §12955 (SB 267)",
    title: t("Source-of-income & credit protections", "Protección por fuente de ingresos y crédito"),
    desc: t("Landlords may not reject voucher holders on credit history alone if they offer other proof of ability to pay.", "No se puede rechazar a portadores de vales solo por historial crediticio si ofrecen otra prueba de capacidad de pago."),
    source: { name: "CA Legislature", url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240SB267" }, effective: "2024-01-01" },
  { id: "ca-ab325", category: "algorithmic", level: 1, jurisdiction: "California", match: st("CA"), lawNo: "Bus. & Prof. Code §16729 (AB 325)",
    title: t("Common pricing algorithm ban", "Prohibición de algoritmos de precios comunes"),
    desc: t("Prohibits using or distributing a common pricing algorithm to coordinate rents.", "Prohíbe usar o distribuir un algoritmo de precios común para coordinar rentas."),
    source: { name: "CA Legislature", url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB325" }, effective: "2026-01-01" },
  { id: "sf-37", category: "rent", level: 2, jurisdiction: "San Francisco", match: city("CA", /san francisco/i), lawNo: "S.F. Admin. Code Ch. 37",
    title: t("SF Rent Ordinance", "Ordenanza de Renta de SF"),
    desc: t("Increases limited to the Rent Board's annual allowable amount (60% of CPI) for multi-unit buildings first occupied before June 13, 1979.", "Aumentos limitados al monto anual permitido por la Junta de Renta (60% del IPC) en edificios multifamiliares ocupados antes del 13/6/1979."),
    source: { name: "SF Rent Board", url: "https://www.sf.gov/departments/rent-board" }, effective: "1979-06-13",
    needs: ["yearBuilt", "units"], applies: (f) => (f.yearBuilt === undefined || f.units === undefined ? undefined : f.yearBuilt < 1979 && f.units >= 2) },
  { id: "sf-37.9", category: "eviction", level: 2, jurisdiction: "San Francisco", match: city("CA", /san francisco/i), lawNo: "S.F. Admin. Code §37.9",
    title: t("SF just-cause eviction", "Desalojo con causa en SF"),
    desc: t("Landlords need one of the listed just causes to evict, from the first day of tenancy for most units.", "Los arrendadores necesitan una causa justificada para desalojar, desde el primer día para la mayoría de unidades."),
    source: { name: "SF Rent Board", url: "https://www.sf.gov/information/just-cause-evictions" }, effective: "1979-06-13" },
  { id: "sf-algo", category: "algorithmic", level: 2, jurisdiction: "San Francisco", match: city("CA", /san francisco/i), lawNo: "S.F. Admin. Code Ch. 37 (2024 amend.)",
    title: t("Algorithmic rent device ban", "Prohibición de dispositivos algorítmicos de renta"),
    desc: t("Bans selling or using algorithmic devices that set rents from nonpublic competitor data.", "Prohíbe vender o usar algoritmos que fijen rentas con datos no públicos de competidores."),
    source: { name: "SF Rent Board", url: "https://www.sf.gov/departments/rent-board" }, effective: "2024-10-01" },
  { id: "la-rso", category: "rent", level: 2, jurisdiction: "Los Angeles", match: city("CA", /los angeles/i), lawNo: "L.A.M.C. §151.00 (RSO)",
    title: t("LA Rent Stabilization Ordinance", "Ordenanza de Estabilización de Renta de LA"),
    desc: t("Annual increases set by the city (3–8%) for buildings with 2+ units built before Oct 1, 1978.", "Aumentos anuales fijados por la ciudad (3–8%) en edificios de 2+ unidades construidos antes del 1/10/1978."),
    source: { name: "LA Housing Dept.", url: "https://housing.lacity.gov/residents/rent-stabilization-ordinance-rso-overview" }, effective: "1979-05-01",
    needs: ["yearBuilt", "units"], applies: (f) => (f.yearBuilt === undefined || f.units === undefined ? undefined : f.yearBuilt <= 1978 && f.units >= 2) },
  { id: "la-jco", category: "eviction", level: 2, jurisdiction: "Los Angeles", match: city("CA", /los angeles/i), lawNo: "L.A.M.C. §165.00 (JCO)",
    title: t("LA Just Cause Ordinance", "Ordenanza de Causa Justificada de LA"),
    desc: t("Most tenants are protected by just-cause rules after 6 months or the first lease expiration.", "La mayoría de inquilinos tienen protección de causa justificada tras 6 meses o el primer vencimiento."),
    source: { name: "LA Housing Dept.", url: "https://housing.lacity.gov/residents/just-cause-ordinance" }, effective: "2023-01-27" },
  { id: "la-fch", category: "screening", level: 2, jurisdiction: "Los Angeles", match: city("CA", /los angeles/i), lawNo: "L.A.M.C. §189.00",
    title: t("LA Fair Chance Housing", "Vivienda de Oportunidad Justa de LA"),
    desc: t("Restricts criminal-history inquiries until after a conditional offer.", "Restringe preguntas sobre antecedentes penales hasta después de una oferta condicional."),
    source: { name: "LA Civil Rights", url: "https://civilandhumanrights.lacity.gov/" }, effective: "2023-01-01" },

  // ---------- New York ----------
  { id: "ny-gce-rent", category: "rent", level: 1, jurisdiction: "New York State", match: nyc, lawNo: "N.Y. Real Prop. Law Art. 6-A",
    title: t("Good Cause Eviction — rent test", "Ley de Desalojo con Causa — prueba de renta"),
    desc: t("Increases above 5% + CPI (max 10%) are presumptively unreasonable and can be contested.", "Aumentos superiores a 5% + IPC (máx. 10%) se presumen irrazonables y pueden impugnarse."),
    source: { name: "NY HCR", url: "https://hcr.ny.gov/good-cause-eviction" }, effective: "2024-04-20",
    needs: ["yearBuilt", "rentStabilized", "subsidized", "smallLandlord"], applies: nyGCE },
  { id: "ny-gce-evict", category: "eviction", level: 1, jurisdiction: "New York State", match: nyc, lawNo: "N.Y. Real Prop. Law §216",
    title: t("Good Cause Eviction", "Desalojo con Causa Justificada"),
    desc: t("Landlords must show good cause to evict or refuse to renew a lease.", "El arrendador debe demostrar causa justificada para desalojar o no renovar."),
    source: { name: "NY HCR", url: "https://hcr.ny.gov/good-cause-eviction" }, effective: "2024-04-20",
    needs: ["yearBuilt", "rentStabilized", "subsidized", "smallLandlord"], applies: nyGCE },
  { id: "ny-7-108", category: "deposit", level: 1, jurisdiction: "New York State", match: st("NY"), lawNo: "N.Y. Gen. Oblig. Law §7-108",
    title: t("One-month deposit cap (HSTPA)", "Depósito máximo de un mes (HSTPA)"),
    desc: t("Deposits capped at one month's rent and returned within 14 days with an itemized statement.", "Depósito máximo de un mes, devuelto en 14 días con estado detallado."),
    source: { name: "NY Senate", url: "https://www.nysenate.gov/legislation/laws/GOB/7-108" }, effective: "2019-07-14" },
  { id: "ny-238a", category: "fees", level: 1, jurisdiction: "New York State", match: st("NY"), lawNo: "N.Y. Real Prop. Law §238-a",
    title: t("$20 screening fee cap", "Tope de $20 por evaluación"),
    desc: t("Only actual background/credit check cost up to $20 may be charged; no other application fees.", "Solo se puede cobrar el costo real de verificación hasta $20; ninguna otra tarifa de solicitud."),
    source: { name: "NY Senate", url: "https://www.nysenate.gov/legislation/laws/RPP/238-A" }, effective: "2019-07-14" },
  { id: "ny-227f", category: "screening", level: 1, jurisdiction: "New York State", match: st("NY"), lawNo: "N.Y. Real Prop. Law §227-f; Exec. Law §296(5)",
    title: t("Tenant blacklist & source-of-income ban", "Prohibición de listas negras y fuente de ingresos"),
    desc: t("Landlords may not deny you for past housing court cases or for using vouchers or other lawful income.", "No pueden rechazarle por casos previos en la corte de vivienda ni por usar vales u otros ingresos legales."),
    source: { name: "NY Senate", url: "https://www.nysenate.gov/legislation/laws/RPP/227-F" }, effective: "2019-06-14" },
  { id: "ny-algo", category: "algorithmic", level: 1, jurisdiction: "New York State", match: st("NY"), lawNo: "N.Y. Gen. Bus. Law §340-b (S7882)",
    title: t("Algorithmic rent-setting ban", "Prohibición de fijación algorítmica de renta"),
    desc: t("Prohibits landlords from using software that coordinates rents among competitors.", "Prohíbe a los arrendadores usar software que coordine rentas entre competidores."),
    source: { name: "NY Senate", url: "https://www.nysenate.gov/legislation/bills/2025/S7882" }, effective: "2025-12-15" },
  { id: "nyc-rsl", category: "rent", level: 2, jurisdiction: "New York City", match: nyc, lawNo: "N.Y.C. Admin. Code §26-501",
    title: t("Rent Stabilization", "Estabilización de Renta"),
    desc: t("The Rent Guidelines Board sets yearly increases for buildings with 6+ units built before 1974.", "La Junta de Pautas de Renta fija los aumentos anuales en edificios de 6+ unidades construidos antes de 1974."),
    source: { name: "NYC RGB", url: "https://rentguidelinesboard.cityofnewyork.us/" }, effective: "1969-05-06",
    needs: ["rentStabilized", "yearBuilt", "units"],
    applies: (f) => (f.rentStabilized ? true : f.yearBuilt === undefined || f.units === undefined ? undefined : f.yearBuilt < 1974 && f.units >= 6) },
  { id: "nyc-fare", category: "fees", level: 2, jurisdiction: "New York City", match: nyc, lawNo: "Local Law 119 of 2024 (FARE Act)",
    title: t("FARE Act broker fees", "Ley FARE sobre comisiones"),
    desc: t("Whoever hires the broker pays the fee; tenants cannot be charged the landlord's broker fee.", "Quien contrata al corredor paga la comisión; no se puede cobrar al inquilino la del arrendador."),
    source: { name: "NYC DCWP", url: "https://www.nyc.gov/site/dca/about/fare-act.page" }, effective: "2025-06-11" },
  { id: "nyc-fch", category: "screening", level: 2, jurisdiction: "New York City", match: nyc, lawNo: "Local Law 24 of 2024",
    title: t("Fair Chance for Housing Act", "Ley de Oportunidad Justa en Vivienda"),
    desc: t("Criminal history can only be reviewed after a conditional offer, with a limited lookback.", "Los antecedentes penales solo pueden revisarse tras una oferta condicional y con límite de años."),
    source: { name: "NYC CCHR", url: "https://www.nyc.gov/site/cchr/law/fair-chance-housing.page" }, effective: "2025-01-01" },

  // ---------- New Jersey ----------
  { id: "nj-aea", category: "eviction", level: 1, jurisdiction: "New Jersey", match: st("NJ"), lawNo: "N.J.S.A. 2A:18-61.1",
    title: t("Anti-Eviction Act", "Ley Anti-Desalojo"),
    desc: t("Evictions require a listed good cause; owner-occupied buildings with 2 or fewer units are exempt.", "Los desalojos requieren causa justificada; edificios de 2 o menos unidades ocupados por el dueño están exentos."),
    source: { name: "NJ DCA", url: "https://www.nj.gov/dca/codes/publications/pdf_lti/t_to_t.pdf" }, effective: "1974-06-25",
    needs: ["ownerOccupied", "units"], applies: (f) => (f.ownerOccupied === false ? true : f.units !== undefined && f.units > 2 ? true : f.ownerOccupied === undefined || f.units === undefined ? undefined : false) },
  { id: "nj-deposit", category: "deposit", level: 1, jurisdiction: "New Jersey", match: st("NJ"), lawNo: "N.J.S.A. 46:8-21.2",
    title: t("1.5-month deposit cap", "Depósito máximo de 1.5 meses"),
    desc: t("Deposits capped at 1.5 months' rent and held in an interest-bearing account.", "Depósito máximo de 1.5 meses de renta, en cuenta que genera intereses."),
    source: { name: "NJ DCA", url: "https://www.nj.gov/dca/codes/publications/pdf_lti/security_deposits.pdf" }, effective: "1971-01-01" },
  { id: "nj-fch", category: "screening", level: 1, jurisdiction: "New Jersey", match: st("NJ"), lawNo: "N.J.S.A. 46:8-52 et seq.",
    title: t("Fair Chance in Housing Act", "Ley de Oportunidad Justa en Vivienda"),
    desc: t("No criminal-history questions until a conditional offer; many records cannot be considered.", "Sin preguntas de antecedentes hasta una oferta condicional; muchos registros no pueden considerarse."),
    source: { name: "NJ DCR", url: "https://www.njoag.gov/fairchancehousing/" }, effective: "2022-01-01" },

  // ---------- Oregon ----------
  { id: "or-rent", category: "rent", level: 1, jurisdiction: "Oregon", match: st("OR"), lawNo: "ORS 90.323 (SB 611)",
    title: t("Statewide rent cap", "Tope estatal de renta"),
    desc: t("Increases capped at 7% + CPI, max 10%, for buildings 15+ years old.", "Aumentos limitados a 7% + IPC, máx. 10%, en edificios de 15+ años."),
    source: { name: "Oregon Legislature", url: "https://oregon.public.law/statutes/ors_90.323" }, effective: "2023-07-06",
    needs: ["yearBuilt"], applies: ageAtLeast(15) },
  { id: "or-evict", category: "eviction", level: 1, jurisdiction: "Oregon", match: st("OR"), lawNo: "ORS 90.427",
    title: t("Just cause after first year", "Causa justificada tras el primer año"),
    desc: t("After the first year, terminations require tenant cause or qualifying landlord reasons with relocation payment.", "Tras el primer año, la terminación requiere causa o razones calificadas con pago de reubicación."),
    source: { name: "Oregon Legislature", url: "https://oregon.public.law/statutes/ors_90.427" }, effective: "2019-02-28" },
  { id: "or-fee", category: "fees", level: 1, jurisdiction: "Oregon", match: st("OR"), lawNo: "ORS 90.295",
    title: t("Screening charge limits", "Límites al cargo de evaluación"),
    desc: t("Screening charges limited to actual cost and must be refunded if no screening is done.", "Cargos limitados al costo real y reembolsables si no se realiza la evaluación."),
    source: { name: "Oregon Legislature", url: "https://oregon.public.law/statutes/ors_90.295" }, effective: "2019-07-01" },

  // ---------- Washington ----------
  { id: "wa-rent", category: "rent", level: 1, jurisdiction: "Washington", match: st("WA"), lawNo: "RCW 59.18.700 (HB 1217)",
    title: t("Statewide rent stabilization", "Estabilización estatal de renta"),
    desc: t("Increases capped at 7% + CPI, max 10%, for buildings 12+ years old.", "Aumentos limitados a 7% + IPC, máx. 10%, en edificios de 12+ años."),
    source: { name: "WA Legislature", url: "https://app.leg.wa.gov/billsummary?BillNumber=1217&Year=2025" }, effective: "2025-05-07",
    needs: ["yearBuilt"], applies: ageAtLeast(12) },
  { id: "wa-evict", category: "eviction", level: 1, jurisdiction: "Washington", match: st("WA"), lawNo: "RCW 59.18.650",
    title: t("Statewide just cause", "Causa justificada estatal"),
    desc: t("Landlords may only end or refuse to renew a tenancy for listed causes.", "Solo se puede terminar o no renovar por causas enumeradas."),
    source: { name: "WA Legislature", url: "https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.650" }, effective: "2021-05-10" },
  { id: "wa-fee", category: "fees", level: 1, jurisdiction: "Washington", match: st("WA"), lawNo: "RCW 59.18.257",
    title: t("Screening fee rules", "Reglas de tarifas de evaluación"),
    desc: t("Fees limited to actual screening cost, with written screening criteria provided upfront.", "Tarifas limitadas al costo real, con criterios escritos entregados de antemano."),
    source: { name: "WA Legislature", url: "https://app.leg.wa.gov/RCW/default.aspx?cite=59.18.257" }, effective: "2016-06-09" },
  { id: "sea-dep", category: "deposit", level: 2, jurisdiction: "Seattle", match: city("WA", /seattle/i), lawNo: "S.M.C. 7.24.035",
    title: t("Deposit + fees cap", "Tope de depósito y tarifas"),
    desc: t("Deposit plus non-refundable fees cannot exceed one month's rent; payable in installments.", "Depósito más tarifas no reembolsables no puede superar un mes de renta; pagadero a plazos."),
    source: { name: "Seattle.gov", url: "https://www.seattle.gov/rentinginseattle" }, effective: "2017-01-15" },
  { id: "sea-fch", category: "screening", level: 2, jurisdiction: "Seattle", match: city("WA", /seattle/i), lawNo: "S.M.C. 14.09",
    title: t("Fair Chance Housing Ordinance", "Ordenanza de Vivienda de Oportunidad Justa"),
    desc: t("Landlords may not ask about or use most criminal history to deny housing.", "No se puede preguntar ni usar la mayoría de antecedentes penales para negar vivienda."),
    source: { name: "Seattle OCR", url: "https://www.seattle.gov/civilrights/civil-rights/fair-housing/fair-chance-housing" }, effective: "2018-02-19" },

  // ---------- Massachusetts ----------
  { id: "ma-rent", category: "rent", level: 1, jurisdiction: "Massachusetts", match: st("MA"), lawNo: "M.G.L. c.40P",
    title: t("Rent control prohibition", "Prohibición de control de renta"),
    desc: t("Statewide ban on local rent control since 1994; no general cap on increases.", "Prohibición estatal del control de renta local desde 1994; no hay tope general."),
    source: { name: "MA Legislature", url: "https://malegislature.gov/Laws/GeneralLaws/PartI/TitleVII/Chapter40P" }, effective: "1994-11-08" },
  { id: "ma-dep", category: "deposit", level: 1, jurisdiction: "Massachusetts", match: st("MA"), lawNo: "M.G.L. c.186 §15B",
    title: t("One-month deposit cap", "Depósito máximo de un mes"),
    desc: t("Deposit max one month's rent, held in a separate interest-bearing account.", "Depósito máximo de un mes, en cuenta separada con intereses."),
    source: { name: "Mass.gov", url: "https://www.mass.gov/info-details/security-deposits" }, effective: "1978-01-01" },
  { id: "ma-fee", category: "fees", level: 1, jurisdiction: "Massachusetts", match: st("MA"), lawNo: "M.G.L. c.186 §15B(1)(b)",
    title: t("No application fees", "Sin tarifas de solicitud"),
    desc: t("Only first month, last month, deposit and lock cost may be collected — no application fees.", "Solo se puede cobrar primer mes, último mes, depósito y cerradura — sin tarifas de solicitud."),
    source: { name: "MA Legislature", url: "https://malegislature.gov/Laws/GeneralLaws/PartII/TitleI/Chapter186/Section15B" }, effective: "1978-01-01" },

  // ---------- Illinois ----------
  { id: "il-rent", category: "rent", level: 1, jurisdiction: "Illinois", match: st("IL"), lawNo: "50 ILCS 825",
    title: t("Rent Control Preemption Act", "Ley de Preferencia sobre Control de Renta"),
    desc: t("Local governments may not enact rent control.", "Los gobiernos locales no pueden establecer control de renta."),
    source: { name: "ILGA", url: "https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=723" }, effective: "1997-01-01" },
  { id: "il-dep", category: "deposit", level: 1, jurisdiction: "Illinois", match: st("IL"), lawNo: "765 ILCS 710",
    title: t("Security Deposit Return Act", "Ley de Devolución de Depósitos"),
    desc: t("Deposits must be returned within 30–45 days with itemized deductions.", "Los depósitos deben devolverse en 30–45 días con deducciones detalladas."),
    source: { name: "ILGA", url: "https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=2196" }, effective: "1974-01-01" },
  { id: "chi-rlto", category: "deposit", level: 2, jurisdiction: "Chicago", match: city("IL", /chicago/i), lawNo: "Chicago Mun. Code 5-12-080",
    title: t("RLTO deposit rules", "Reglas de depósito RLTO"),
    desc: t("Receipts, annual interest and return within 45 days; violations can cost the landlord 2x the deposit.", "Recibos, intereses anuales y devolución en 45 días; las violaciones pueden costar 2x el depósito."),
    source: { name: "City of Chicago", url: "https://www.chicago.gov/city/en/depts/doh/provdrs/landlords/svcs/rents-right.html" }, effective: "1986-09-08" },
  { id: "cook-jha", category: "screening", level: 2, jurisdiction: "Cook County", match: (l) => l.stateCode === "IL" && /cook|chicago/i.test(`${l.county} ${l.city}`), lawNo: "Cook County Just Housing Amendment",
    title: t("Just Housing Amendment", "Enmienda de Vivienda Justa"),
    desc: t("Criminal background checks only after other screening, using an individualized assessment.", "Verificación penal solo después de otras evaluaciones, con evaluación individualizada."),
    source: { name: "Cook County CHR", url: "https://www.cookcountyil.gov/content/just-housing-amendment-human-rights-ordinance" }, effective: "2019-12-31" },

  // ---------- Colorado ----------
  { id: "co-rent", category: "rent", level: 1, jurisdiction: "Colorado", match: st("CO"), lawNo: "C.R.S. 38-12-301",
    title: t("Rent control preemption", "Preferencia sobre control de renta"),
    desc: t("Local rent control on private housing is prohibited.", "Se prohíbe el control de renta local en vivienda privada."),
    source: { name: "Colorado Legislature", url: "https://leg.colorado.gov/" }, effective: "1981-01-01" },
  { id: "co-evict", category: "eviction", level: 1, jurisdiction: "Colorado", match: st("CO"), lawNo: "C.R.S. 38-12-1301 (HB24-1098)",
    title: t("For-cause eviction", "Desalojo por causa"),
    desc: t("After 12 months, non-renewal requires for-cause or qualifying no-fault grounds.", "Tras 12 meses, la no renovación requiere causa o razones sin culpa calificadas."),
    source: { name: "Colorado Legislature", url: "https://leg.colorado.gov/bills/hb24-1098" }, effective: "2024-04-19" },
  { id: "co-fee", category: "fees", level: 1, jurisdiction: "Colorado", match: st("CO"), lawNo: "C.R.S. 38-12-903 (HB23-1099)",
    title: t("Fee limits & portable reports", "Límites de tarifas e informes portátiles"),
    desc: t("Fees limited to actual cost; landlords must accept recent portable screening reports.", "Tarifas limitadas al costo real; deben aceptarse informes portátiles recientes."),
    source: { name: "Colorado Legislature", url: "https://leg.colorado.gov/bills/hb23-1099" }, effective: "2023-08-07" },

  // ---------- Texas ----------
  { id: "tx-rent", category: "rent", level: 1, jurisdiction: "Texas", match: st("TX"), lawNo: "Tex. Loc. Gov't Code §214.902",
    title: t("Rent control prohibited", "Control de renta prohibido"),
    desc: t("Cities may not enact rent control except in a declared housing emergency.", "Las ciudades no pueden controlar la renta salvo emergencia declarada."),
    source: { name: "Texas Statutes", url: "https://statutes.capitol.texas.gov/Docs/LG/htm/LG.214.htm" }, effective: "1985-09-01" },
  { id: "tx-dep", category: "deposit", level: 1, jurisdiction: "Texas", match: st("TX"), lawNo: "Tex. Prop. Code §92.103",
    title: t("30-day deposit return", "Devolución del depósito en 30 días"),
    desc: t("No cap on amount; must be returned within 30 days after move-out.", "Sin tope de monto; debe devolverse en 30 días tras la mudanza."),
    source: { name: "Texas Statutes", url: "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm" }, effective: "1984-01-01" },
  { id: "tx-fee", category: "fees", level: 1, jurisdiction: "Texas", match: st("TX"), lawNo: "Tex. Prop. Code §92.3515",
    title: t("Written selection criteria", "Criterios de selección por escrito"),
    desc: t("Landlords must give written selection criteria or refund the application fee.", "Deben entregar criterios por escrito o reembolsar la tarifa de solicitud."),
    source: { name: "Texas Statutes", url: "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.92.htm" }, effective: "2000-01-01" },

  // ---------- Florida ----------
  { id: "fl-rent", category: "rent", level: 1, jurisdiction: "Florida", match: st("FL"), lawNo: "Fla. Stat. §125.0103 (HB 1417)",
    title: t("Rent control preemption", "Preferencia sobre control de renta"),
    desc: t("Local rent control and tenant ordinances are preempted by the state.", "El estado anula el control de renta y ordenanzas locales de inquilinos."),
    source: { name: "Florida Senate", url: "https://www.flsenate.gov/Session/Bill/2023/1417" }, effective: "2023-07-01" },
  { id: "fl-dep", category: "deposit", level: 1, jurisdiction: "Florida", match: st("FL"), lawNo: "Fla. Stat. §83.49",
    title: t("Deposit handling", "Manejo del depósito"),
    desc: t("No cap; returned within 15 days, or 30 days' notice of claim.", "Sin tope; devolución en 15 días o aviso de reclamo en 30 días."),
    source: { name: "Florida Senate", url: "https://www.flsenate.gov/Laws/Statutes/2024/83.49" }, effective: "1973-01-01" },

  // ---------- DC ----------
  { id: "dc-rent", category: "rent", level: 1, jurisdiction: "Washington, D.C.", match: st("DC"), lawNo: "D.C. Code §42-3502.08",
    title: t("Rent Stabilization Program", "Programa de Estabilización de Renta"),
    desc: t("Annual increases limited to CPI + 2% with a statutory cap for buildings built before 1976.", "Aumentos anuales limitados a IPC + 2% con tope legal, en edificios anteriores a 1976."),
    source: { name: "DC DHCD", url: "https://dhcd.dc.gov/service/rent-control" }, effective: "1985-07-17",
    needs: ["yearBuilt"], applies: (f) => (f.yearBuilt === undefined ? undefined : f.yearBuilt < 1976) },
  { id: "dc-evict", category: "eviction", level: 1, jurisdiction: "Washington, D.C.", match: st("DC"), lawNo: "D.C. Code §42-3505.01",
    title: t("Just-cause eviction", "Desalojo con causa justificada"),
    desc: t("Tenants may only be evicted for listed reasons, with required notice.", "Solo se puede desalojar por razones enumeradas, con aviso requerido."),
    source: { name: "DC Code", url: "https://code.dccouncil.gov/us/dc/council/code/sections/42-3505.01" }, effective: "1985-07-17" },
  { id: "dc-dep", category: "deposit", level: 1, jurisdiction: "Washington, D.C.", match: st("DC"), lawNo: "D.C. Code §42-3502.17",
    title: t("One-month deposit cap", "Depósito máximo de un mes"),
    desc: t("Deposit may not exceed one month's rent.", "El depósito no puede exceder un mes de renta."),
    source: { name: "DC Code", url: "https://code.dccouncil.gov/us/dc/council/code/sections/42-3502.17" }, effective: "1985-07-17" },
  { id: "dc-fee", category: "fees", level: 1, jurisdiction: "Washington, D.C.", match: st("DC"), lawNo: "D.C. Code §42-3505.10",
    title: t("Application fee cap", "Tope a la tarifa de solicitud"),
    desc: t("Application fees capped at $50 and must be disclosed upfront.", "Tarifas de solicitud limitadas a $50 e informadas de antemano."),
    source: { name: "DC Code", url: "https://code.dccouncil.gov/us/dc/council/code/sections/42-3505.10" }, effective: "2018-05-01" },
  { id: "dc-screen", category: "screening", level: 1, jurisdiction: "Washington, D.C.", match: st("DC"), lawNo: "D.C. Code §42-3541.01",
    title: t("Fair Criminal Record Screening", "Evaluación Justa de Antecedentes Penales"),
    desc: t("No criminal-history inquiry before a conditional offer; limited lookback.", "Sin preguntas de antecedentes antes de una oferta condicional; período limitado."),
    source: { name: "DC OHR", url: "https://ohr.dc.gov/" }, effective: "2017-12-20" },
  // ---------- Pending / failed ----------
  { id: "fed-paca", category: "algorithmic", level: 0, jurisdiction: "Federal", match: fed, lawNo: "Preventing Algorithmic Collusion Act (S. 232, 119th Cong.)", stage: "pending",
    title: t("Preventing Algorithmic Collusion Act", "Ley para Prevenir la Colusión Algorítmica"),
    desc: t("Would presume price-fixing when competitors share nonpublic data through pricing algorithms.", "Presumiría fijación de precios cuando competidores comparten datos no públicos mediante algoritmos."),
    source: { name: "Congress.gov", url: "https://www.congress.gov/bill/119th-congress/senate-bill/232" }, effective: "9999-12-31" },
  { id: "co-hb25-1004", category: "algorithmic", level: 1, jurisdiction: "Colorado", match: st("CO"), lawNo: "HB25-1004", stage: "failed",
    title: t("Algorithmic rent-setting ban (vetoed)", "Prohibición de fijación algorítmica (vetada)"),
    desc: t("Passed the legislature in 2025 but was vetoed by the Governor; it is not law.", "Aprobada por la legislatura en 2025 pero vetada por el Gobernador; no es ley."),
    source: { name: "Colorado Legislature", url: "https://leg.colorado.gov/bills/hb25-1004" }, effective: "9999-12-31" },
  { id: "ca-ab1157", category: "rent", level: 1, jurisdiction: "California", match: st("CA"), lawNo: "AB 1157 (2025–26)", stage: "pending",
    title: t("Lower statewide rent cap proposal", "Propuesta de tope estatal más bajo"),
    desc: t("Would lower the AB 1482 cap and remove its 2030 sunset; not enacted.", "Reduciría el tope de AB 1482 y eliminaría su vencimiento en 2030; no promulgada."),
    source: { name: "CA Legislature", url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1157" }, effective: "9999-12-31" },

  // ---------- NJ state vs. local (conflict case) ----------
  { id: "jc-rent", category: "rent", level: 2, jurisdiction: "Jersey City", match: city("NJ", /jersey city/i), lawNo: "Jersey City Mun. Code Ch. 260",
    title: t("Jersey City Rent Control", "Control de Renta de Jersey City"),
    desc: t("Limits annual increases for covered buildings (generally 5+ units) to a CPI-based percentage.", "Limita los aumentos anuales en edificios cubiertos (generalmente 5+ unidades) a un porcentaje según el IPC."),
    source: { name: "Jersey City Office of Rent Control", url: "https://www.jerseycitynj.gov/cityhall/housing/rentcontrol" }, effective: "1973-01-01",
    needs: ["units"], applies: (f) => (f.units === undefined ? undefined : f.units >= 5) },
  { id: "nj-newconst", category: "rent", level: 1, jurisdiction: "New Jersey", match: st("NJ"), lawNo: "N.J.S.A. 2A:42-84.1 et seq.",
    title: t("New-construction exemption from local rent control", "Exención de construcción nueva del control local"),
    desc: t("State law exempts newly constructed multiple dwellings from municipal rent control for 30 years after completion.", "La ley estatal exime a los edificios nuevos del control municipal de renta por 30 años tras su terminación."),
    source: { name: "NJ Legislature", url: "https://lis.njleg.state.nj.us/" }, effective: "1987-01-01",
    needs: ["yearBuilt"], applies: (f, y) => (f.yearBuilt === undefined ? undefined : y - f.yearBuilt < 30) },
];

export type SourceType = "statute" | "ordinance" | "bill" | "motion" | "lawsuit" | "agency" | "secondary";
type Extra = { quote?: string; sourceType?: SourceType; coverage?: L; conflictsWith?: { id: string; note: L }[] };

export const EXTRAS: Record<string, Extra> = {
  fha: { quote: "To refuse to sell or rent after the making of a bona fide offer, or to refuse to negotiate for the sale or rental of, or otherwise make unavailable or deny, a dwelling to any person because of race, color, religion, sex, familial status, or national origin. (42 U.S.C. §3604(a))" },
  fcra: { quote: "If any person takes any adverse action with respect to any consumer that is based in whole or in part on any information contained in a consumer report, the person shall— (1) provide oral, written, or electronic notice of the adverse action to the consumer… (15 U.S.C. §1681m(a))" },
  cares: { quote: "The lessor of a covered dwelling unit… may not require the tenant to vacate the covered dwelling unit before the date that is 30 days after the date on which the lessor provides the tenant with a notice to vacate. (15 U.S.C. §9058(c))",
    coverage: t("Covers only 'covered dwellings': federally subsidized housing or properties with a federally backed mortgage.", "Cubre solo 'viviendas cubiertas': subsidiadas o con hipoteca respaldada federalmente.") },
  sherman: { quote: "Every contract, combination in the form of trust or otherwise, or conspiracy, in restraint of trade or commerce among the several States, or with foreign nations, is declared to be illegal. (15 U.S.C. §1)" },
  "ca-1947.12": { quote: "…an owner of residential real property shall not, over the course of any 12-month period, increase the gross rental rate for a dwelling or a unit more than 5 percent plus the percentage change in the cost of living, or 10 percent, whichever is lower… (Civ. Code §1947.12(a)(1))",
    coverage: t("Excludes housing first occupied within the last 15 years, and single-family homes not owned by a corporation/REIT (with required notice).", "Excluye vivienda ocupada por primera vez en los últimos 15 años y casas unifamiliares que no sean de una corporación/REIT (con aviso).") },
  "ca-1946.2": { quote: "…after a tenant has continuously and lawfully occupied a residential real property for 12 months, the owner of the residential real property shall not terminate the tenancy without just cause, which shall be stated in the written notice to terminate tenancy. (Civ. Code §1946.2(a))",
    coverage: t("Same exemptions as the AB 1482 rent cap.", "Mismas exenciones que el tope de AB 1482.") },
  "ca-1950.5": { quote: "A landlord may not demand or receive security, however denominated, in an amount or value in excess of an amount equal to one month's rent, in addition to any rent for the first month… (Civ. Code §1950.5(c)(1))" },
  "sf-37": { coverage: t("Covers multi-unit buildings with a first certificate of occupancy before June 13, 1979.", "Cubre edificios multifamiliares con certificado de ocupación anterior al 13/6/1979.") },
  "sf-algo": { sourceType: "secondary" },
  "sea-algo": { sourceType: "secondary" },
  "la-rso": { coverage: t("Covers buildings with 2+ units and a certificate of occupancy on or before Oct 1, 1978.", "Cubre edificios de 2+ unidades con certificado de ocupación hasta el 1/10/1978.") },
  "ny-gce-rent": { coverage: t("Exempt: buildings with a C of O after 2009, rent-regulated or subsidized units, and landlords owning 10 or fewer units.", "Exentos: edificios con certificado posterior a 2009, unidades reguladas o subsidiadas y arrendadores con 10 unidades o menos.") },
  "ny-gce-evict": { coverage: t("Same exemptions as the Good Cause rent test.", "Mismas exenciones que la prueba de renta de Good Cause.") },
  "ny-7-108": { quote: "No deposit or advance shall exceed the amount of one month's rent under such contract. (Gen. Oblig. Law §7-108(1-a)(a))" },
  "ny-238a": { quote: "…the landlord… may charge a fee or fees to reimburse costs associated with conducting a background check and credit check… provided the fee or fees shall not exceed the actual cost of the background check and credit check or twenty dollars, whichever is less… (RPL §238-a(1)(b))" },
  "ny-algo": { sourceType: "bill" },
  "nyc-rsl": { coverage: t("Generally buildings with 6+ units built before 1974, or units registered as rent-stabilized.", "Generalmente edificios de 6+ unidades anteriores a 1974, o unidades registradas como estabilizadas.") },
  "nj-aea": { coverage: t("Exempts owner-occupied buildings with two or fewer rental units.", "Exime edificios ocupados por el dueño con dos o menos unidades.") },
  "nj-deposit": { quote: "No person… shall… demand… a security deposit… in an amount in excess of one and one-half times one month's rent… (N.J.S.A. 46:8-21.2)" },
  "wa-evict": { quote: "A landlord may not evict a tenant, refuse to continue a tenancy, or end a periodic tenancy except for the causes enumerated in subsection (2) of this section and as otherwise provided in this subsection. (RCW 59.18.650(1)(a))" },
  "ma-dep": { quote: "At or prior to the commencement of any tenancy, no lessor may require a tenant or prospective tenant to pay any amount in excess of the following: (i) rent for the first full month of occupancy; and, (ii) rent for the last full month of occupancy…; (iii) a security deposit equal to the first month's rent…; and (iv) the purchase and installation cost for a key and lock. (M.G.L. c.186 §15B(1)(b))" },
  "ma-fee": { quote: "At or prior to the commencement of any tenancy, no lessor may require a tenant or prospective tenant to pay any amount in excess of the following: (i) rent for the first full month…; (ii) rent for the last full month…; (iii) a security deposit…; and (iv) the purchase and installation cost for a key and lock. (M.G.L. c.186 §15B(1)(b))" },
  "il-rent": { quote: "A unit of local government… shall not enact, maintain, or enforce an ordinance or resolution that would have the effect of controlling the amount of rent charged for leasing private residential or commercial property. (50 ILCS 825/5)" },
  "tx-dep": { quote: "…a landlord shall refund a security deposit to the tenant on or before the 30th day after the date the tenant surrenders the premises. (Tex. Prop. Code §92.103(a))" },
  "dc-rent": { coverage: t("Generally covers buildings built before 1976; small-landlord and other exemptions exist.", "Generalmente edificios anteriores a 1976; existen exenciones para pequeños arrendadores.") },
  "fed-paca": { sourceType: "bill" },
  "co-hb25-1004": { sourceType: "bill" },
  "ca-ab1157": { sourceType: "bill" },
  "jc-rent": { coverage: t("Generally covers buildings with 5+ units; newer buildings may be exempt under state law.", "Generalmente cubre edificios de 5+ unidades; los nuevos pueden estar exentos por ley estatal."),
    conflictsWith: [{ id: "nj-newconst", note: t("State law exempts new construction from municipal rent control for 30 years, while the city ordinance claims coverage. Which rule controls depends on the building's completion date and exemption filing.", "La ley estatal exime la construcción nueva del control municipal por 30 años, mientras la ordenanza local reclama cobertura. Cuál rige depende de la fecha de terminación y la solicitud de exención.") }] },
  "nj-newconst": { coverage: t("Applies to multiple dwellings completed within the last 30 years whose owner filed for the exemption.", "Aplica a edificios terminados en los últimos 30 años cuyo dueño solicitó la exención.") },
};

export const sourceTypeOf = (l: Law): SourceType => EXTRAS[l.id]?.sourceType ?? (l.level === 2 ? "ordinance" : "statute");
export const WEAK_SOURCE: Partial<Record<SourceType, L>> = {
  bill: t("This source is a bill, not operative codified text.", "Esta fuente es un proyecto de ley, no texto legal vigente codificado."),
  motion: t("This source is a motion, not operative text.", "Esta fuente es una moción, no texto vigente."),
  lawsuit: t("This source is litigation, not operative law.", "Esta fuente es un litigio, no ley vigente."),
  agency: t("This source is agency guidance, not binding text.", "Esta fuente es una guía de agencia, no texto vinculante."),
  secondary: t("Citation from a secondary summary; not verified against operative text.", "Cita de un resumen secundario; no verificada contra el texto vigente."),
};

export type Status = "applicable" | "notYetEffective" | "pending" | "failed" | "notApplicable" | "unknown";
export type Confidence = "high" | "medium" | "low";
export type Conflict = { a: Law; b: Law; note: L };
export type Entry = { law: Law; status: Status; confidence: Confidence; score: number; conflict?: Conflict };

const BASE: Record<SourceType, number> = { statute: 0.9, ordinance: 0.85, bill: 0.55, motion: 0.4, lawsuit: 0.5, agency: 0.6, secondary: 0.4 };

export function resolveLaws(loc: Loc, date: string, facts: Facts) {
  const year = Number(date.slice(0, 4));
  const matched = LAWS.filter((l) => l.match(loc));
  const statusOf = (l: Law): Status => {
    if (l.stage === "pending") return "pending";
    if (l.stage === "failed") return "failed";
    if (l.effective > date) return "notYetEffective";
    if (l.sunset && l.sunset <= date) return "notApplicable";
    if (!l.applies) return "applicable";
    const r = l.applies(facts, year);
    return r === undefined ? "unknown" : r ? "applicable" : "notApplicable";
  };
  const all: Entry[] = matched.map((law) => ({ law, status: statusOf(law), confidence: "high", score: 0 }));
  const byId = new Map(all.map((e) => [e.law.id, e]));
  const conflicts: Conflict[] = [];
  for (const e of all) {
    for (const c of EXTRAS[e.law.id]?.conflictsWith ?? []) {
      const o = byId.get(c.id);
      const live = (s: Status) => s === "applicable" || s === "unknown";
      if (o && live(e.status) && live(o.status)) {
        const conf = { a: e.law, b: o.law, note: c.note };
        conflicts.push(conf);
        e.conflict = conf;
        o.conflict = conf;
      }
    }
  }
  for (const e of all) {
    let s = BASE[sourceTypeOf(e.law)];
    if (!EXTRAS[e.law.id]?.quote) s -= 0.1;
    if (e.status === "unknown") s -= 0.25;
    if (e.conflict) s -= 0.25;
    e.score = Math.max(0.05, Math.min(1, s));
    e.confidence = e.score >= 0.75 ? "high" : e.score >= 0.5 ? "medium" : "low";
  }
  const order = (a: Entry, b: Entry) => CATEGORIES.indexOf(a.law.category) - CATEGORIES.indexOf(b.law.category) || b.law.level - a.law.level;
  all.sort(order);
  const active = all.filter((e) => ["applicable", "unknown", "notApplicable"].includes(e.status));
  const future = matched
    .filter((l) => !l.stage || l.stage === "enacted")
    .filter((l) => l.effective > date || (l.sunset && l.sunset > date && l.effective <= date))
    .map((l) => ({ law: l, kind: l.effective > date ? ("starts" as const) : ("ends" as const), on: l.effective > date ? l.effective : l.sunset! }));
  const proposals = all.filter((e) => e.status === "pending" || e.status === "failed");
  const missing = Array.from(
    new Set(
      [...active.filter((e) => e.status === "unknown").map((e) => e.law), ...future.map((f) => f.law).filter((l) => l.applies && l.applies(facts, year) === undefined)]
        .flatMap((l) => l.needs ?? [])
        .filter((k) => facts[k] === undefined),
    ),
  );
  const top = CATEGORIES.map((c) => ({
    category: c,
    entry: active.find((e) => e.law.category === c && e.status !== "notApplicable"),
  }));
  const live = active.filter((e) => e.status !== "notApplicable");
  const overall = live.length ? live.reduce((a, b) => a + b.score, 0) / live.length : 0;
  const jurisdictions = [0, 1, 2].map((lv) => ({ level: lv, names: Array.from(new Set(matched.filter((l) => l.level === lv).map((l) => l.jurisdiction))) }));
  return { all, active, future, proposals, conflicts, missing, top, overall, jurisdictions };
}

const FACT_LABEL: Record<FactKey, L> = {
  yearBuilt: t("year built", "año de construcción"), units: t("units", "unidades"), ownerOccupied: t("owner-occupied", "ocupado por el dueño"),
  corporateOwner: t("corporate owner", "dueño corporativo"), subsidized: t("subsidized", "subsidiado"),
  rentStabilized: t("rent-stabilized", "renta estabilizada"), smallLandlord: t("small landlord (≤10 units)", "pequeño arrendador (≤10 unidades)"),
};

export function reasoning(e: Entry, place: Pick<Place, "label">, date: string, facts: Facts, lang: Lang): string[] {
  const es = lang === "es";
  const l = e.law;
  const out: string[] = [];
  out.push(es ? `Jurisdicción: la dirección "${place.label}" está dentro de ${l.jurisdiction}.` : `Jurisdiction: the address "${place.label}" falls within ${l.jurisdiction}.`);
  if (l.stage === "pending") out.push(es ? "Etapa: proyecto pendiente, no promulgado." : "Stage: pending proposal, not enacted.");
  else if (l.stage === "failed") out.push(es ? "Etapa: fracasó (vetado o no aprobado)." : "Stage: failed (vetoed or not passed).");
  else {
    out.push(es ? `Vigencia: efectiva desde ${l.effective}${l.sunset ? `, vence ${l.sunset}` : ""}; fecha de consulta ${date}.` : `Timing: effective ${l.effective}${l.sunset ? `, sunsets ${l.sunset}` : ""}; as-of date ${date}.`);
  }
  const cov = EXTRAS[l.id]?.coverage;
  if (cov) out.push((es ? "Criterio de cobertura: " : "Coverage rule: ") + cov[lang]);
  if (l.needs?.length) {
    const parts = l.needs.map((k) => `${FACT_LABEL[k][lang]} = ${facts[k] === undefined ? (es ? "desconocido" : "unknown") : String(facts[k])}`);
    out.push((es ? "Datos usados: " : "Facts used: ") + parts.join("; ") + ".");
  } else if (!l.stage) out.push(es ? "Aplica a todas las viviendas en alquiler de esta jurisdicción." : "Applies to all rental housing in this jurisdiction.");
  const verdict: Record<Status, L> = {
    applicable: t("Result: applicable.", "Resultado: aplicable."),
    unknown: t("Result: unknown — required facts are missing.", "Resultado: desconocido — faltan datos."),
    notApplicable: t("Result: not applicable (exempt or expired).", "Resultado: no aplicable (exento o vencido)."),
    notYetEffective: t("Result: enacted but not yet effective on the as-of date.", "Resultado: promulgada pero aún no vigente en la fecha."),
    pending: t("Result: pending — no legal effect.", "Resultado: pendiente — sin efecto legal."),
    failed: t("Result: failed — no legal effect.", "Resultado: fracasó — sin efecto legal."),
  };
  out.push(verdict[e.status][lang]);
  if (e.conflict) out.push((es ? "Conflicto: " : "Conflict: ") + e.conflict.note[lang]);
  return out;
}

export const CORE_FACTS: FactKey[] = ["yearBuilt", "units", "ownerOccupied", "subsidized"];
