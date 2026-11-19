import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { getCurrentLocation } from "../services/geolocation";

const RadarMap = lazy(() => import("./RadarMap").then(module => ({ default: module.RadarMap })));
const initialCenter = { lat: 18.4861, lng: -69.9312 };
const noSelection = () => {};

export type ServicePoint = { lat: number; lng: number };

export function ServiceLocation({ address, point, confirmed, onChange, onConfirm }: {
  address: string;
  point: ServicePoint | null;
  confirmed: boolean;
  onChange: (point: ServicePoint) => void;
  onConfirm: () => void;
}) {
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");

  const displayAddress = address.trim();
  const points = useMemo(() => point ? [{ ...point, id: "service", label: "Lugar del servicio" }] : [], [point]);
  const selectPoint = useCallback((next: ServicePoint) => {
    setMessage("");
    onChange(next);
  }, [onChange]);

  async function locate() {
    setLocating(true);
    setMessage("");
    try {
      onChange(await getCurrentLocation());
      setShowMap(true);
    } catch {
      setMessage("No se pudo obtener tu ubicación. Puedes marcar el lugar en el mapa.");
      setShowMap(true);
    } finally {
      setLocating(false);
    }
  }

  return <div className="space-y-2 text-xs">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={locating} onClick={locate} className="rounded-lg bg-slate-800 px-3 py-2 text-amber-200">
        {locating ? "Buscando ubicación…" : "Usar mi GPS"}
      </button>
      <button type="button" aria-expanded={showMap} onClick={() => setShowMap(value => !value)} className="rounded-lg bg-slate-800 px-3 py-2">
        {showMap ? "Ocultar mapa" : "Marcar en el mapa"}
      </button>
    </div>
    <p role="status" className="text-slate-300">
      {message || (confirmed ? "Dirección y punto confirmados." : point
        ? "Revisa que el marcador esté en la entrada del lugar y confirma el punto."
        : "Si estás en el lugar del servicio, usa tu GPS. También puedes marcar la entrada en el mapa.")}
    </p>
    {showMap && <div className="space-y-2 rounded-xl border border-slate-700 p-2">
      <p className="break-words text-slate-100"><strong>Dirección del servicio</strong><br />{displayAddress || "Escribe la dirección arriba."}</p>
      <Suspense fallback={<p>Cargando mapa…</p>}>
        <RadarMap center={point ?? initialCenter}
          points={points}
          selected={point ? "service" : null} onSelect={noSelection}
          onMapClick={selectPoint}
          label="Mapa para marcar el lugar del servicio" />
      </Suspense>
      <button type="button" disabled={!displayAddress || !point || confirmed || locating} onClick={onConfirm}
        className="rounded-lg bg-amber-400 px-3 py-2 font-bold text-slate-950 disabled:bg-slate-800 disabled:text-slate-300">
        {confirmed ? "Punto confirmado" : "Confirmar punto del servicio"}
      </button>
    </div>}
  </div>;
}
