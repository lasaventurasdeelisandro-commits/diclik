import { useEffect, useState } from "react";
import { api } from "../services/api";

type Amount = number | string;
type Dashboard = {
  requests: Amount; contracts: Amount; operating: Amount; active: Amount; completed: Amount;
  completed_value: Amount; recorded_commission: Amount; cancellation_income: Amount; platform_income: Amount; held: Amount;
  specialist_count: Amount; updated_at: string;
  services: { id: string; title: string; client: string; specialist: string; specialist_role: string;
    status: string; agreed_price: Amount; commission_rate: Amount; agreed_commission: Amount; recorded_commission: Amount }[];
  specialists: { specialist_id: string; specialist: string; specialist_role: string; services: Amount;
    active: Amount; recorded_commission: Amount }[];
};

const money = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const count = new Intl.NumberFormat("es-DO");
const percent = new Intl.NumberFormat("es-DO", { style: "percent", maximumFractionDigits: 2 });
const statusLabels: Record<string, string> = {
  held_in_escrow: "Fondos retenidos", active_in_transit: "En camino", in_progress: "En servicio",
  completed: "Completado", cancelled: "Cancelado", disputed: "En disputa",
};
const roleLabel = (role: string) => role === "profesional" ? "Profesional" : "Técnico";
const button = "rounded-lg border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40";

export function AdminDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        const current = await api.admin.getOperations(page, controller.signal);
        if (controller.signal.aborted) return;
        setData(current);
        setError("");
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "No se pudieron actualizar las operaciones.");
      }
      timer = setTimeout(update, 15000);
    }
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [page, refresh]);

  return <section className="space-y-4" aria-label="Operaciones y comisiones">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-amber-300">Operaciones y comisiones</h2>
        {data && <p className="text-xs text-slate-400">Última actualización {new Date(data.updated_at).toLocaleTimeString("es-DO")}. Consulta automática cada 15 segundos.</p>}
      </div>
      <button className={button} onClick={() => setRefresh(value => value + 1)}>Actualizar panel</button>
    </div>
    {error && <p role="status" className="text-amber-300">{error}</p>}
    {!data && !error && <p role="status">Cargando operaciones…</p>}
    {data && <>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ["Solicitudes registradas", count.format(Number(data.requests))],
          ["Contratos activos", count.format(Number(data.active))],
          ["Especialistas en camino o en servicio", count.format(Number(data.operating))],
          ["Servicios completados", count.format(Number(data.completed))],
          ["Valor de servicios completados", money.format(Number(data.completed_value))],
          ["Comisiones registradas", money.format(Number(data.recorded_commission))],
          ["Ingresos por cancelación", money.format(Number(data.cancellation_income))],
          ["Ingreso total registrado de DICLIK", money.format(Number(data.platform_income))],
          ["Fondos retenidos", money.format(Number(data.held))],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <dt className="text-xs text-slate-300">{label}</dt><dd className="mt-1 font-bold">{value}</dd>
        </div>)}
      </dl>
      <p className="text-xs text-slate-300">Los montos se basan en los movimientos registrados en DICLIK. La conciliación bancaria y el cálculo fiscal están pendientes de configuración.</p>
      <h3 className="font-bold">Servicios contratados</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900"><tr>{["Servicio", "Cliente", "Especialista", "Estado", "Precio", "Comisión prevista", "Comisión registrada"].map(title =>
            <th key={title} className="p-2 font-semibold">{title}</th>
          )}</tr></thead>
          <tbody>{data.services.map(row => <tr key={row.id} className="border-t border-slate-800">
            <td className="p-2">{row.title}</td><td className="p-2">{row.client}</td>
            <td className="p-2">{row.specialist}<span className="block text-xs text-slate-400">{roleLabel(row.specialist_role)}</span></td>
            <td className="p-2">{statusLabels[row.status] ?? row.status}</td>
            <td className="p-2 whitespace-nowrap">{money.format(Number(row.agreed_price))}</td>
            <td className="p-2 whitespace-nowrap">{money.format(Number(row.agreed_commission))} ({percent.format(Number(row.commission_rate))})</td>
            <td className="p-2 whitespace-nowrap">{money.format(Number(row.recorded_commission))}</td>
          </tr>)}</tbody>
        </table>
        {!data.services.length && <p className="p-3 text-sm">No hay contratos en esta página.</p>}
      </div>
      <h3 className="font-bold">Comisión por especialista</h3>
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900"><tr><th className="p-2">Especialista</th><th className="p-2">Contratos</th><th className="p-2">Activos</th><th className="p-2">Comisión registrada</th></tr></thead>
          <tbody>{data.specialists.map(row => <tr key={row.specialist_id} className="border-t border-slate-800">
            <td className="p-2">{row.specialist} · {roleLabel(row.specialist_role)}</td>
            <td className="p-2">{row.services}</td><td className="p-2">{row.active}</td>
            <td className="p-2">{money.format(Number(row.recorded_commission))}</td>
          </tr>)}</tbody>
        </table>
        {!data.specialists.length && <p className="p-3 text-sm">No hay especialistas con contrato en esta página.</p>}
      </div>
      <div className="flex items-center gap-3">
        <button className={button} disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
        <span>Página {page}</span>
        <button className={button} disabled={page * 25 >= Math.max(Number(data.contracts), Number(data.specialist_count))} onClick={() => setPage(value => value + 1)}>Siguiente</button>
      </div>
    </>}
  </section>;
}
