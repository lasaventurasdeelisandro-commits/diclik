import { Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { isQuickAccessCategory, premiumPublicationDays, quickAccess } from "../quickAccess";
import { api, type PremiumPublication } from "../services/api";

export function PremiumPromotion() {
  const [details, setDetails] = useState<PremiumPublication | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.accreditation.sponsorship(controller.signal).then(setDetails).catch(() => {
      if (!controller.signal.aborted) setMessage("No se pudo cargar la promoción. Vuelve a abrir Cuenta para intentarlo de nuevo.");
    });
    return () => controller.abort();
  }, []);

  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const category = new FormData(event.currentTarget).get("category");
    if (!isQuickAccessCategory(category)) return;
    setBusy(true);
    setMessage("");
    try {
      await api.accreditation.requestSponsorship(category);
      setDetails(previous => previous ? { ...previous, requested: [...new Set([...previous.requested, category])] } : previous);
      setMessage("Solicitud enviada a Administración.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  const available = details?.eligibleCategories.filter(category =>
    !details.requested.includes(category) && !details.active.some(item => item.category === category)) ?? [];

  return <section className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-950 p-3.5 text-sm text-amber-100">
    <h3 className="flex items-center gap-2 text-lg font-bold"><Sparkles aria-hidden="true" className="size-5 shrink-0" />Promoción Premium · Primer Nivel</h3>
    <p>Publica tu perfil en una categoría de Acceso rápido durante {premiumPublicationDays} días y recibe solicitudes de cotización directa.</p>
    {!details && !message && <p role="status">Consultando tu promoción…</p>}
    {details && !details.verified && <p>Tu acreditación debe estar aprobada para solicitar esta promoción.</p>}
    {details?.requested.map(category => <p key={category} className="rounded-lg bg-slate-950/65 p-2">
      {quickAccess[category].label} · Pendiente de confirmación del pago
    </p>)}
    {details?.active.map(item => <p key={item.category} className="rounded-lg bg-emerald-950 p-2 text-emerald-100">
      {quickAccess[item.category].label} · Activa hasta {new Date(item.expires_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}
    </p>)}
    {details?.verified && available.length > 0 && <form onSubmit={request} className="space-y-2">
      <label className="block font-semibold">Categoría para tu promoción
        <select name="category" required className="mt-1 block min-h-11 w-full rounded-lg border border-amber-500/50 bg-slate-950 px-3 text-white">
          {available.map(category => <option key={category} value={category}>{quickAccess[category].label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-amber-300 px-3 py-2 font-bold text-amber-950 disabled:opacity-50">
        {busy ? "Enviando…" : "Solicitar promoción"}
      </button>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
