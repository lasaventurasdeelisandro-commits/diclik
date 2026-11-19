import { ArrowRight, BriefcaseBusiness, Shuffle, Wrench } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { quickAccess, type QuickAccessCategory, type QuickAccessRole } from "../quickAccess";
import { api, type SponsoredProfile, type SponsoredProfileByRole } from "../services/api";

const roles = ["tecnico", "profesional"] as const;
const display = {
  tecnico: { title: "Técnicos", next: "Otro técnico", Icon: Wrench, color: "border-emerald-400/40 bg-emerald-950 text-emerald-100" },
  profesional: { title: "Profesionales", next: "Otro profesional", Icon: BriefcaseBusiness, color: "border-sky-400/40 bg-sky-950 text-sky-100" },
};
const cardColors = [
  "border-emerald-400/40 bg-emerald-950",
  "border-violet-400/40 bg-violet-950",
  "border-sky-400/40 bg-sky-950",
  "border-amber-400/40 bg-amber-950",
];

type Directory = { profiles: SponsoredProfileByRole[]; error: boolean };

function shuffle(profiles: SponsoredProfileByRole[]) {
  const shuffled = [...profiles];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const next = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[next]] = [shuffled[next], shuffled[index]];
  }
  return shuffled;
}

export function QuickAccess({ currentUserId, onChoose }: {
  currentUserId?: string; onChoose: (category: QuickAccessCategory, profile: SponsoredProfile) => void;
}) {
  const listId = useId();
  const [selected, setSelected] = useState<QuickAccessRole | null>(null);
  const [directories, setDirectories] = useState<Partial<Record<QuickAccessRole, Directory>>>({});
  const [featured, setFeatured] = useState({ tecnico: 0, profesional: 0 });
  const [filter, setFilter] = useState<QuickAccessCategory | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    for (const role of roles) {
      api.radar.sponsoredByRole(role, controller.signal).then(profiles => {
        const ordered = shuffle(profiles);
        if (!controller.signal.aborted) setDirectories(previous => ({ ...previous, [role]: { profiles: ordered, error: false } }));
      }).catch(() => {
        if (!controller.signal.aborted) setDirectories(previous => ({ ...previous, [role]: { profiles: [], error: true } }));
      });
    }
    return () => controller.abort();
  }, [revision]);

  function profilesFor(role: QuickAccessRole): SponsoredProfileByRole[] {
    return directories[role]?.profiles.filter(profile => profile.id !== currentUserId) ?? [];
  }

  const visible = selected ? profilesFor(selected) : [];
  const categories = [...new Set(visible.flatMap(profile => profile.categories))];
  const filtered = filter ? visible.filter(profile => profile.categories.includes(filter)) : visible;

  return <section aria-label="Acceso rápido por especialidad" className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-bold text-white">Acceso rápido por especialidad</h3>
      <span className="text-xs font-semibold text-amber-200">Patrocinado</span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {roles.map(role => {
        const { title, next, Icon, color } = display[role];
        const profiles = profilesFor(role);
        const profile = profiles.length ? profiles[featured[role] % profiles.length] : undefined;
        return <div key={role} className={`flex min-w-0 flex-col rounded-xl border ${color} ${selected === role ? "ring-2 ring-amber-300" : ""}`}>
          <button type="button" aria-expanded={selected === role} aria-controls={listId}
            onClick={() => { setSelected(selected === role ? null : role); setFilter(null); }}
            className="flex min-h-32 flex-1 flex-col gap-2 rounded-xl p-3 text-left">
            <span className="flex items-center gap-2 text-sm font-bold"><Icon className="size-4 shrink-0" aria-hidden="true" />{title}</span>
            {profile ? <span className="flex items-center gap-2">
              {profile.avatar && <img src={profile.avatar} alt="" loading="lazy" className="size-8 shrink-0 rounded-lg object-cover" />}
              <span className="min-w-0"><strong className="block break-words text-sm text-white">{profile.name}</strong>
                <span className="block break-words text-xs">{profile.trade}</span></span>
            </span> : <span className="text-xs">{!directories[role] ? "Cargando perfiles…" : directories[role]?.error ? "Lista no disponible" : "Sin perfiles activos"}</span>}
            <span className="mt-auto flex items-center gap-1 text-xs font-semibold">{selected === role ? "Ocultar lista" : "Ver lista"} <ArrowRight className="size-3" aria-hidden="true" /></span>
          </button>
          {profiles.length > 1 && <button type="button" onClick={() => setFeatured(previous => ({ ...previous, [role]: previous[role] + 1 }))}
            className="flex min-h-10 items-center gap-1.5 border-t border-white/15 px-3 text-left text-xs font-semibold">
            <Shuffle className="size-3.5" aria-hidden="true" />{next}
          </button>}
        </div>;
      })}
    </div>
    <div id={listId} hidden={!selected} className="space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm">
      {selected && <>
        <h4 className="font-bold text-amber-200">{display[selected].title} patrocinados</h4>
        {!directories[selected] && <p role="status">Cargando perfiles…</p>}
        {directories[selected]?.error && <p role="status">No se pudo cargar la lista. <button type="button" className="underline"
          onClick={() => { setDirectories({}); setRevision(value => value + 1); }}>Volver a intentar</button></p>}
        {directories[selected] && !directories[selected]?.error && !visible.length &&
          <p>No hay perfiles patrocinados activos. Puedes publicar una solicitud abierta.</p>}
        {categories.length > 1 && <div aria-label="Filtrar por especialidad" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!filter} onClick={() => setFilter(null)} className="rounded-lg border border-slate-600 px-2 py-1.5 aria-pressed:border-amber-300">Todos</button>
          {categories.map(category => <button type="button" key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}
            className="rounded-lg border border-slate-600 px-2 py-1.5 aria-pressed:border-amber-300">{quickAccess[category].label}</button>)}
        </div>}
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((profile, index) => <article key={profile.id} className={`flex min-w-0 flex-col gap-3 rounded-xl border p-3 ${cardColors[index % cardColors.length]}`}>
            <div className="flex min-w-0 items-center gap-2">
              {profile.avatar && <img src={profile.avatar} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0">
                <h5 className="break-words font-bold text-white">{profile.name}</h5>
                <p className="break-words text-slate-200">{profile.trade}{profile.reviewCount > 0 && ` · ★ ${profile.rating}`}</p>
              </div>
            </div>
            <button type="button" onClick={() => onChoose(filter ?? profile.categories[0], profile)}
              className="mt-auto min-h-10 rounded-lg border border-white/35 px-3 py-2 font-bold text-white">
              Solicitar cotización
            </button>
          </article>)}
        </div>
      </>}
    </div>
  </section>;
}
