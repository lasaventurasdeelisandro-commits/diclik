export const quickAccess = {
  plomeria: { label: "Plomería 24/7", role: "tecnico", query: "Plomería" },
  pediatria: { label: "Médico pediatra", role: "profesional", query: "Médico pediatra" },
  tecnico: { label: "Técnico", role: "tecnico", query: "Técnico general" },
  profesional: { label: "Profesionales", role: "profesional", query: "Servicio profesional" },
} as const;

export type QuickAccessCategory = keyof typeof quickAccess;
export const isQuickAccessCategory = (value: unknown): value is QuickAccessCategory =>
  typeof value === "string" && Object.hasOwn(quickAccess, value);
