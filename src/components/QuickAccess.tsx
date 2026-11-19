import { HeartPulse, Sparkles, ToolCase, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { quickAccess, type QuickAccessCategory } from "../quickAccess";
import { api, type SponsoredProfile } from "../services/api";

const icons = { plomeria: Wrench, pediatria: HeartPulse, tecnico: ToolCase, profesional: Sparkles };
const colors = {
  plomeria: "bg-amber-400/15 text-amber-300",
  pediatria: "bg-rose-400/15 text-rose-300",
  tecnico: "bg-emerald-400/15 text-emerald-300",
  profesional: "bg-sky-400/15 text-sky-300",
};

export function QuickAccess({ currentUserId, onChoose }: {
  currentUserId?: string; onChoose: (category: QuickAccessCategory, profile: SponsoredProfile) => void;
}) {
  const [category, setCategory] = useState<QuickAccessCategory | null>(null);
  const [result, setResult] = useState<{ category: QuickAccessCategory; profiles: SponsoredProfile[]; error?: string } | null>(null);

  useEffect(() => {
    if (!category) return;
    const controller = new AbortController();
    api.radar.sponsored(category, controller.signal).then(profiles => {
      if (!controller.signal.aborted) setResult({ category, profiles });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ category, profiles: [], error: "No se pudo cargar la lista. Vuelve a pulsar el acceso para intentarlo otra vez." });
    });
    return () => controller.abort();
  }, [category]);

  const visible = result?.category === category ? result : null;
  const profiles = visible?.profiles.filter(profile => profile.id !== currentUserId) ?? [];
  return <section aria-label="Acceso rápido por especialidad" className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-bold text-white">Acceso rápido por especialidad</h3>
      <span className="text-xs text-amber-200">Patrocinado</span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {(Object.keys(quickAccess) as QuickAccessCategory[]).map(id => {
        const Icon = icons[id];
        return <button key={id} type="button" aria-pressed={category === id} onClick={() => {
          if (category === id) { setCategory(null); return; }
          setResult(null);
          setCategory(id);
        }} className={`min-h-20 rounded-xl border bg-slate-800 p-3 text-left text-sm font-bold text-white ${category === id ? "border-amber-400" : "border-slate-700"}`}>
          <span className={`mb-2 grid size-8 place-items-center rounded-lg ${colors[id]}`}><Icon className="size-4" aria-hidden="true" /></span>
          {quickAccess[id].label}
        </button>;
      })}
    </div>
    {category && <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm">
      <h4 className="font-bold text-amber-200">Perfiles patrocinados · {quickAccess[category].label}</h4>
      {!visible && <p role="status">Cargando perfiles…</p>}
      {visible?.error && <p role="status">{visible.error}</p>}
      {visible && !visible.error && !profiles.length && <p>No hay perfiles patrocinados en esta categoría. Puedes publicar una solicitud abierta.</p>}
      {profiles.map(profile => <article key={profile.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-800 p-3">
        <div className="flex min-w-0 items-center gap-2">
          {profile.avatar && <img src={profile.avatar} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" />}
          <div className="min-w-0">
            <h5 className="break-words font-bold text-white">{profile.name}</h5>
            <p className="break-words text-slate-300">{profile.trade}{profile.reviewCount > 0 && ` · ★ ${profile.rating}`}</p>
          </div>
        </div>
        <button type="button" onClick={() => onChoose(category, profile)} className="rounded-lg border border-amber-400/50 px-3 py-2 font-bold text-amber-200">
          Solicitar cotización
        </button>
      </article>)}
    </div>}
  </section>;
}
