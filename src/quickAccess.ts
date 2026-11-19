export const quickAccess = {
  plomeria: { label: "Plomería 24/7", role: "tecnico", query: "Plomería" },
  pediatria: { label: "Médico pediatra", role: "profesional", query: "Médico pediatra" },
  tecnico: { label: "Técnico", role: "tecnico", query: "Técnico general" },
  profesional: { label: "Profesionales", role: "profesional", query: "Servicio profesional" },
} as const;

export type QuickAccessCategory = keyof typeof quickAccess;
export const isQuickAccessCategory = (value: unknown): value is QuickAccessCategory =>
  typeof value === "string" && Object.hasOwn(quickAccess, value);

export const premiumPublicationDays = 30;

export function eligibleQuickAccessCategories(role: string, trade: string): QuickAccessCategory[] {
  const specialty = trade.toLowerCase();
  return (Object.keys(quickAccess) as QuickAccessCategory[]).filter(category =>
    quickAccess[category].role === role &&
    (category !== "plomeria" || specialty.includes("plomer")) &&
    (category !== "pediatria" || specialty.includes("pediatr")));
}
