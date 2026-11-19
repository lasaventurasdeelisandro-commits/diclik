import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { getCurrentLocation } from "../services/geolocation";

const RadarMap = lazy(() => import("./RadarMap").then(module => ({ default: module.RadarMap })));

interface Coordinates {
  lat: number;
  lng: number;
}

interface ContractPositions {
  specialist: (Coordinates & { updated_at: string }) | null;
  destination: Coordinates | null;
}

function noSelection() {}

export function ContractMap({ contractId, isClient, address }: {
  contractId: string;
  isClient: boolean;
  address: string;
}) {
  const [positions, setPositions] = useState<ContractPositions | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await api.services.getContractMap(contractId, controller.signal);
        if (controller.signal.aborted) return;
        setPositions(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        setUnavailable(false);
      } catch {
        if (controller.signal.aborted) return;
        setPositions(null);
        setUnavailable(true);
      }
      timer = setTimeout(refresh, 8000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [contractId, revision]);

  const points = useMemo(() => {
    const entries = [];
    if (positions?.specialist) {
      entries.push({ ...positions.specialist, id: "specialist", label: isClient ? "Especialista" : "Tu ubicación" });
    }
    if (positions?.destination) {
      entries.push({ ...positions.destination, id: "destination", label: "Lugar del servicio" });
    }
    return entries;
  }, [positions, isClient]);

  async function shareLocation() {
    setSharing(true);
    setMessage("");
    try {
      const location = await getCurrentLocation();
      if (isClient) await api.services.shareContractDestination(contractId, location);
      else await api.services.shareContractLocation(contractId, location);
      setRevision(value => value + 1);
      setMessage(isClient ? "Punto del servicio compartido." : "Ubicación compartida con el cliente.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo compartir el GPS.");
    } finally {
      setSharing(false);
    }
  }

  const destination = positions?.destination;
  const directions = new URLSearchParams({ api: "1", destination: destination ? `${destination.lat},${destination.lng}` : address });
  const specialist = positions?.specialist;
  if (specialist) directions.set("origin", `${specialist.lat},${specialist.lng}`);

  return <section aria-label="Seguimiento del contrato" className="space-y-2">
    <h4 className="font-bold text-amber-200">Mapa del servicio</h4>
    {address && <p>{address}</p>}
    {points.length > 0 && <Suspense fallback={<p role="status">Cargando mapa…</p>}>
      <RadarMap center={points[0]} points={points} selected={null} onSelect={noSelection} connect label="Mapa del contrato" />
    </Suspense>}
    {points.length > 0 && <ol className="space-y-1 text-xs text-slate-300">
      {points.map((point, index) => <li key={point.id}>{index + 1}. {point.label}</li>)}
    </ol>}
    {points.length === 2 && <p className="text-xs text-slate-300">La línea une las ubicaciones. Abre la ruta para ver el recorrido por calles.</p>}
    {unavailable ? <p role="status">El mapa del contrato no está disponible.</p> : positions && <>
      {!destination && <p>{isClient ? "Cuando estés en el lugar del servicio, comparte el GPS para fijar el punto." : "El cliente aún no ha fijado el punto del servicio."}</p>}
      {!specialist && isClient && <p>El especialista aún no ha compartido su ubicación.</p>}
    </>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={sharing} onClick={shareLocation}
        className="rounded-lg border border-amber-400/50 px-2.5 py-1.5 font-bold text-amber-200 disabled:opacity-50">
        {isClient ? (destination ? "Actualizar punto del servicio" : "Fijar punto del servicio con GPS") : (specialist ? "Actualizar mi GPS" : "Compartir ubicación")}
      </button>
      {(destination || (!isClient && address)) && <a
        className="rounded-lg border border-slate-500 px-2.5 py-1.5 font-bold text-white"
        target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?${directions}`}>
        Abrir ruta por calles
      </a>}
    </div>
    {specialist && <p className="text-xs text-slate-300">GPS del especialista actualizado a las {new Date(specialist.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
