import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { getCurrentLocation } from "../services/geolocation";

const RadarMap = lazy(() => import("./RadarMap").then(module => ({ default: module.RadarMap })));
const initialCenter = { lat: 18.4861, lng: -69.9312 };
const noSelection = () => {};

export type ServicePoint = { lat: number; lng: number };

export function ServiceLocation({ point, onChange }: {
  point: ServicePoint | null;
  onChange: (point: ServicePoint) => void;
}) {
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");

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
      {message || (point ? "Ubicación vinculada. Revisa que el punto coincida con la dirección." : "Marca el lugar del servicio para vincularlo con la dirección.")}
    </p>
    {showMap && <Suspense fallback={<p>Cargando mapa…</p>}>
      <RadarMap center={point ?? initialCenter}
        points={points}
        selected={point ? "service" : null} onSelect={noSelection}
        onMapClick={selectPoint}
        label="Mapa para marcar el lugar del servicio" />
    </Suspense>}
  </div>;
}
