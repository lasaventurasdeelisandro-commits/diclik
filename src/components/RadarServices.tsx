import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Sparkles, Wrench } from "lucide-react";

export type RadarSpecialist = {
  id: string;
  name: string;
  trade: string;
  distanceKm: number;
  latOffset: number;
  lngOffset: number;
  type?: "tecnico" | "profesional";
  avatar?: string;
  bio?: string;
  basePrice?: number;
  etaMin?: number;
  rating?: number;
  reviewCount?: number;
  verified?: boolean;
};

export type RadarSort = "precio" | "rapido" | "rating";

const money = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 2 });
function price(value?: number) {
  return value != null && value > 0 ? `RD$ ${money.format(value)}` : null;
}

function placeMarkers(specialists: RadarSpecialist[], width: number, height: number) {
  const columnWidth = 78;
  const rowHeight = 65;
  const candidates = Array.from({ length: Math.floor((height - 34) / rowHeight) }, (_, row) =>
    Array.from({ length: Math.floor(width / columnWidth) }, (_, column) => ({
      x: columnWidth * (column + 0.5) + (width % columnWidth) / 2,
      y: rowHeight * (row + 0.5) + 4,
    })),
  ).flat().filter(({ x, y }) => Math.abs(x - width / 2) >= 70 || Math.abs(y - height / 2) >= 52);

  const placed: { specialist: RadarSpecialist; x: number; y: number }[] = [];
  for (const specialist of specialists) {
    if (!Number.isFinite(specialist.latOffset) || !Number.isFinite(specialist.lngOffset)) continue;
    const x = width * specialist.lngOffset / 100;
    const y = height * (100 - specialist.latOffset) / 100;
    const distance = (point: { x: number; y: number }) => Math.hypot(point.x - x, point.y - y);
    if (x >= columnWidth / 2 && x <= width - columnWidth / 2 && y >= rowHeight / 2 &&
        y <= height - rowHeight / 2 - 34 &&
        (Math.abs(x - width / 2) >= 70 || Math.abs(y - height / 2) >= 52) &&
        placed.every(point => Math.abs(point.x - x) >= columnWidth || Math.abs(point.y - y) >= rowHeight)) {
      placed.push({ specialist, x, y });
      continue;
    }
    const closest = candidates.filter(candidate =>
      placed.every(point => Math.abs(point.x - candidate.x) >= columnWidth || Math.abs(point.y - candidate.y) >= rowHeight),
    ).sort((a, b) => distance(a) - distance(b))[0];
    if (closest) placed.push({ specialist, ...closest });
  }
  return placed;
}

export function RadarGrid({ specialists, selected, onSelect, hasLocation }: {
  specialists: RadarSpecialist[];
  selected: string | null;
  onSelect: (id: string) => void;
  hasLocation: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const markers = useMemo(() => {
    const ordered = [...specialists].sort((a, b) => a.id.localeCompare(b.id));
    const placed = placeMarkers(ordered, size.width, size.height);
    const selectedSpecialist = ordered.find(item => item.id === selected);
    if (selectedSpecialist && !placed.some(marker => marker.specialist.id === selected)) {
      return placeMarkers([selectedSpecialist, ...ordered.filter(item => item !== selectedSpecialist)], size.width, size.height);
    }
    return placed;
  }, [specialists, selected, size]);
  const remaining = specialists.length - markers.length;

  return <div ref={container} aria-label="Radar de especialistas" className="relative isolate h-64 overflow-hidden rounded-2xl border-2 border-slate-700 bg-slate-950 sm:h-72"
    style={{ backgroundImage: "linear-gradient(#33415555 1px,transparent 1px),linear-gradient(90deg,#33415555 1px,transparent 1px)", backgroundSize: "30px 30px" }}>
    {[22, 47, 72].map(size => <div key={size} aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/15"
      style={{ width: `${size}%` }} />)}
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="radar-sweep h-full w-full motion-safe:animate-spin"
        style={{
          animationDuration: "4s",
          background: "conic-gradient(from 0deg at 50% 50%, #34d399aa 0deg, #10b98144 1deg, transparent 62deg)",
        }} />
    </div>
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
      <span aria-hidden="true" className="mx-auto grid size-7 place-items-center rounded-full bg-amber-400 text-slate-950 ring-4 ring-amber-400/30">
        <MapPin className="size-4" />
      </span>
      <span className="mt-1 block rounded-full border border-amber-500/25 bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-amber-300">
        {hasLocation ? "Tu zona" : "Santo Domingo"}
      </span>
    </div>
    {markers.map(({ specialist: item, x, y }) => {
      const active = item.id === selected;
      const Icon = item.type === "profesional" ? Sparkles : Wrench;
      return <button key={item.id} type="button" aria-label={`${item.trade} · ${item.name}`} aria-pressed={active}
        onClick={() => onSelect(item.id)}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 focus-visible:z-30 ${active ? "z-20" : "z-10"}`}
        style={{ left: x, top: y }}>
        <span className={`grid size-9 place-items-center rounded-full border-2 shadow-lg ${active ? "border-amber-100 bg-amber-400 text-slate-950 ring-4 ring-amber-400/25" : "border-indigo-300/60 bg-indigo-700 text-white"}`}>
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className={`max-w-[74px] truncate whitespace-nowrap rounded-lg border px-1.5 py-0.5 text-[10px] font-extrabold ${active ? "border-amber-300 bg-amber-400 text-slate-950" : "border-slate-700 bg-slate-900 text-slate-100"}`}>
          {price(item.basePrice) ?? item.trade}{item.etaMin != null && ` · ${item.etaMin} min`}
        </span>
      </button>;
    })}
    <a href="#radar-resultados" className="absolute bottom-2 right-2 z-30 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-bold text-amber-300">
      {remaining > 0 ? `Ver lista (+${remaining}) ↓` : "Ver lista ↓"}
    </a>
  </div>;
}

export function RadarServiceCard({ specialist, selected, onSelect }: {
  specialist: RadarSpecialist;
  selected: boolean;
  onSelect: () => void;
}) {
  const { name, trade, avatar, bio, rating, reviewCount, distanceKm, etaMin, basePrice, verified } = specialist;
  return <button type="button" onClick={onSelect} aria-pressed={selected}
    className={`w-full space-y-3 rounded-2xl border bg-slate-800/90 p-3 text-left ${selected ? "border-amber-400 ring-1 ring-amber-400/35" : "border-emerald-500/35"}`}>
    <div className="flex items-start gap-3">
      {avatar && <img src={avatar} alt="" className="size-11 shrink-0 rounded-xl border border-amber-400/60 object-cover" loading="lazy" />}
      <div className="min-w-0 flex-1">
        <strong className="block text-white">{name}{verified && <span className="ml-1 text-amber-300" aria-label="Verificado">✓</span>}</strong>
        <p className="font-bold text-amber-300">{trade}</p>
        <p className="mt-1 text-xs text-slate-300">
          {rating != null && `★ ${rating} · `}{reviewCount != null && `${reviewCount} reseñas · `}
          {distanceKm} km aprox.{etaMin != null && ` · ${etaMin} min estimados`}
        </p>
      </div>
      {price(basePrice) && <div className="shrink-0 text-right">
        <p className="text-[10px] text-slate-400">Tarifa de referencia</p>
        <strong className="text-emerald-300">{price(basePrice)}</strong>
      </div>}
    </div>
    {bio && <p className="rounded-xl bg-slate-950/55 p-2.5 text-xs text-slate-200">{bio}</p>}
  </button>;
}
