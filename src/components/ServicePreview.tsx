import { MapPin, UserRound } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import type { RadarPoint } from "./RadarMap";

const RadarMap = lazy(() => import("./RadarMap").then(module => ({ default: module.RadarMap })));
const noMarkers: RadarPoint[] = [];
const noSelection = () => {};

export type ServiceArea = { lat: number; lng: number };

export function requestPhotos(photos: (string | null | undefined)[] = []) {
  return photos.filter((url): url is string =>
    typeof url === "string" && /^(https:\/\/|data:image\/(jpeg|png|webp|gif);base64,)/.test(url));
}

export function ServiceRequester({ avatar, clientName }: { avatar?: string | null; clientName?: string | null }) {
  const portrait = typeof avatar === "string" && /^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/.test(avatar) ? avatar : null;
  if (!clientName) return null;
  return <div className="flex min-w-0 items-center gap-2.5">
    {portrait
      ? <img src={portrait} alt="Foto de perfil del cliente" loading="lazy" referrerPolicy="no-referrer"
          className="size-12 shrink-0 rounded-2xl border-2 border-amber-400 object-cover" />
      : <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl border border-amber-400/45 bg-slate-800 text-slate-300"><UserRound size={20} /></span>}
    <div className="min-w-0">
      <p className="text-xs text-slate-300">Solicitado por</p>
      <p className="break-words font-bold text-white">{clientName}</p>
    </div>
  </div>;
}

export function ServicePreview({ area }: { area?: ServiceArea | null }) {
  const [mapOpen, setMapOpen] = useState(false);
  return <div className="space-y-2">
    {area ? <>
      <button type="button" aria-expanded={mapOpen} onClick={() => setMapOpen(value => !value)}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-400/40 px-3 py-2 text-sm font-semibold text-emerald-100">
        <MapPin size={16} aria-hidden="true" />{mapOpen ? "Ocultar mapa de la zona" : "Ver zona aproximada en el mapa"}
      </button>
      {mapOpen && <div className="space-y-1">
        <Suspense fallback={<p role="status">Cargando mapa de la zona…</p>}>
          <RadarMap center={area} points={noMarkers} selected={null} onSelect={noSelection} areaRadius={800} label="Mapa de la zona aproximada del servicio" />
        </Suspense>
        <p className="text-xs text-slate-300">El círculo indica la zona aproximada. La dirección exacta aparece en el contrato.</p>
      </div>}
    </> : <p className="text-xs text-slate-300">Zona del servicio no disponible.</p>}
  </div>;
}
