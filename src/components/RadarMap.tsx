import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface RadarPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export function RadarMap({ center, points, selected, onSelect, connect = false, label = "Mapa de servicios cercanos" }: {
  center: { lat: number; lng: number };
  points: RadarPoint[];
  selected: string | null;
  onSelect: (id: string) => void;
  connect?: boolean;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(instance);
    map.current = instance;
    markers.current = L.layerGroup().addTo(instance);
    return () => {
      instance.remove();
      map.current = null;
      markers.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const location: L.LatLngTuple = [center.lat, center.lng];
    if (!points.length) {
      instance.setView(location, 12);
      return;
    }
    instance.fitBounds(L.latLngBounds([location, ...points.map(point => L.latLng(point.lat, point.lng))]), {
      maxZoom: connect ? 16 : 13,
      padding: [24, 24],
    });
  }, [center.lat, center.lng, points, connect]);

  useEffect(() => {
    const layer = markers.current;
    if (!layer) return;
    layer.clearLayers();
    if (connect && points.length === 2) {
      L.polyline(points.map(point => [point.lat, point.lng]), {
        color: "#2563eb", weight: 5, dashArray: "8 8",
      }).addTo(layer);
    }
    points.forEach((point, index) => {
      const active = point.id === selected;
      const icon = L.divIcon({
        className: "",
        html: `<span class="grid size-7 place-items-center rounded-full border-2 border-slate-950 font-bold shadow ${active ? "bg-amber-300" : "bg-emerald-300"} text-slate-950">${index + 1}</span>`,
        iconSize: [28, 28],
      });
      L.marker([point.lat, point.lng], { icon, title: point.label })
        .on("click", () => onSelect(point.id))
        .addTo(layer);
    });
  }, [points, selected, onSelect, connect]);

  return <div ref={container} aria-label={label} className="relative z-0 h-64 w-full rounded-xl border border-slate-700" />;
}
