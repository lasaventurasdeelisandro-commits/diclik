import { useEffect, useState, type FormEvent } from "react";
import { isQuickAccessCategory, premiumPublicationDays, quickAccess, type QuickAccessCategory } from "../quickAccess";
import { api, type SponsoredAdministration as SponsoredData } from "../services/api";

const field = "block min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2";
const button = "rounded-lg border border-amber-400/50 px-3 py-2 font-bold text-amber-200 disabled:opacity-50";

function defaultExpiry() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + premiumPublicationDays);
  return new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function SponsoredAdministration() {
  const [data, setData] = useState<SponsoredData | null>(null);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<QuickAccessCategory>("plomeria");
  const [expiryInput, setExpiryInput] = useState(defaultExpiry);

  const [message, setMessage] = useState("");
  useEffect(() => {
    api.admin.listSponsored().then(setData).catch(() => setMessage("No se pudo cargar la lista patrocinada."));
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setData(await api.admin.listSponsored());
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el cambio.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const category = fields.get("category");
    const expiry = new Date(String(fields.get("expiry")));
    if (!isQuickAccessCategory(category) || !Number.isFinite(expiry.getTime())) return;
    void run(async () => {
      await api.admin.publishSponsored({
        userId: String(fields.get("userId")), category, expiresAt: expiry.toISOString(), reference: String(fields.get("reference")),
      });
      form.reset();
      setUserId("");
      setExpiryInput(defaultExpiry());
    }, "Perfil publicado en Acceso rápido.");
  }

  return <section className="space-y-4">
    <h2 className="text-lg font-bold text-amber-300">Acceso rápido patrocinado</h2>
    <p className="text-sm text-slate-300">Registra un perfil después de confirmar el pago recibido fuera de Diclik. La publicación se retira automáticamente al vencer.</p>
    {data && <div className="space-y-2">
      <h3 className="font-bold text-amber-200">Solicitudes Premium pendientes</h3>
      {!data.requests.length && <p className="text-sm text-slate-300">No hay solicitudes pendientes.</p>}
      {data.requests.map(item => <article key={`${item.user_id}:${item.category}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 p-3">
        <p>{item.full_name} · {quickAccess[item.category].label}</p>
        <button type="button" className={button} onClick={() => {
          setUserId(item.user_id);
          setSelectedCategory(item.category);
          setExpiryInput(defaultExpiry());
        }}>Preparar publicación</button>
      </article>)}
    </div>}
    {data && <form onSubmit={submit} className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4 sm:grid-cols-2">
      <label>Especialista acreditado
        <select name="userId" value={userId} onChange={event => setUserId(event.target.value)} required className={field}>
          <option value="">Selecciona un especialista</option>
          {data.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name} · {profile.trade}</option>)}
        </select>
      </label>
      <label>Categoría
        <select name="category" value={selectedCategory} onChange={event => {
          if (isQuickAccessCategory(event.target.value)) setSelectedCategory(event.target.value);
        }} required className={field}>
          {Object.entries(quickAccess).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
        </select>
      </label>
      <label>Vence el
        <input name="expiry" type="datetime-local" value={expiryInput} onChange={event => setExpiryInput(event.target.value)} required className={field} />
      </label>
      <label>Referencia del pago recibido
        <input name="reference" required maxLength={120} className={field} />
      </label>
      <div><button type="submit" disabled={busy} className={button}>Registrar pago y publicar</button></div>
    </form>}
    {message && <p role="status">{message}</p>}
    {data?.listings.length === 0 && <p className="text-sm text-slate-300">Aún no hay publicaciones registradas.</p>}
    {data?.listings.map(item => <article key={`${item.user_id}:${item.category}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 p-3">
      <div>
        <h3 className="font-bold">{item.full_name} · {quickAccess[item.category].label}</h3>
        <p className="text-sm text-slate-300">Vence {new Date(item.expires_at).toLocaleString("es-DO")} · Pago {item.payment_reference}</p>
      </div>
      <button type="button" className={button} disabled={busy}
        onClick={() => void run(() => api.admin.removeSponsored(item.user_id, item.category), "Publicación retirada.")}>Retirar</button>
    </article>)}
  </section>;
}
