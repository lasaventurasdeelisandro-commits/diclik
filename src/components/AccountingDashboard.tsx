import { useEffect, useState } from "react";
import { api } from "../services/api";

const accounts = {
  escrow_hold: ["Retención", "Saldo de clientes", "Fondos de clientes retenidos"],
  escrow_release: ["Abono al especialista", "Fondos de clientes retenidos", "Saldo de especialistas"],
  fee_deduction: ["Comisión", "Fondos de clientes retenidos", "Ingreso por comisiones"],
  refund: ["Reembolso del contrato", "Fondos de clientes retenidos", "Saldo de clientes"],
  penalty: ["Compensación al especialista", "Fondos de clientes retenidos", "Saldo de especialistas"],
  cancellation_income: ["Ingreso por cancelación", "Fondos de clientes retenidos", "Ingreso por cancelaciones"],
} as const;
type Amount = number | string;
type Summary = {
  entry_count: Amount; commission: Amount; held: Amount; credited_to_specialists: Amount; refunded: Amount;
  completed_volume: Amount; completed_count: Amount; cancellation_income: Amount;
  bank_pending: Amount | null; bank_confirmed: Amount | null; updated_at: string;
  entries: { id: string; contract_id: string; created_at: string; type: keyof typeof accounts; amount: Amount }[];
};
const formatter = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const date = new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo" });
const money = (amount: Amount | null) => amount === null ? "Sin conciliación" : formatter.format(Number(amount));
const button = "rounded-lg border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40";

export function AccountingDashboard() {
  const [data, setData] = useState<Summary | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.admin.getAccounting(page, controller.signal);
        if (controller.signal.aborted) return;
        setData(next);
        setError("");
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Error al actualizar los movimientos.");
      }
      timer = setTimeout(poll, 15000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [page]);

  return <section className="space-y-3 rounded-xl border border-slate-700 p-4" aria-label="Control financiero">
    <h2 className="text-lg font-bold text-amber-300">Control financiero</h2>
    {error && <p role="status" className="text-amber-300">{error}</p>}
    {!data && !error && <p role="status">Cargando movimientos…</p>}
    {data && <>
      <p className="text-xs text-slate-300">Actualizado {date.format(new Date(data.updated_at))}. Consulta automática cada 15 segundos.</p>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ["Fondos de clientes retenidos", money(data.held)],
          ["Comisión registrada", money(data.commission)],
          ["Ingresos por cancelación", money(data.cancellation_income)],
          ["Abonos a especialistas en DICLIK", money(data.credited_to_specialists)],
          ["Reembolsos de contratos", money(data.refunded)],
          ["Ticket promedio de servicios cerrados", Number(data.completed_count) > 0 ? money(Number(data.completed_volume) / Number(data.completed_count)) : "Sin servicios cerrados"],
          ["Depósito a DICLIK pendiente", money(data.bank_pending)],
          ["Depósito bancario confirmado", money(data.bank_confirmed)],
        ].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-900 p-3">
          <dt className="text-xs text-slate-300">{label}</dt><dd className="font-bold">{value}</dd>
        </div>)}
      </dl>
      <p className="text-xs text-slate-300">Los depósitos requieren confirmación de la pasarela y conciliación bancaria.</p>
      <h3 className="font-bold">Diario operativo de contratos</h3>
      <p className="text-xs text-slate-300">Vista auxiliar de partida doble generada a partir de los movimientos internos del contrato.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr>{["Fecha", "Contrato", "Movimiento", "Debe", "Haber", "Importe por partida"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{data.entries.map(row => {
            const [label, debit, credit] = accounts[row.type];
            return <tr key={row.id} className="border-t border-slate-700">
              <td className="p-2">{date.format(new Date(row.created_at))}</td><td className="p-2">{row.contract_id}</td>
              <td className="p-2">{label}</td><td className="p-2">{debit}</td><td className="p-2">{credit}</td>
              <td className="p-2 whitespace-nowrap">{money(row.amount)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!data.entries.length && <p className="text-sm">No hay movimientos en esta página.</p>}
      <div className="flex items-center gap-2">
        <button className={button} disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
        <span className="text-sm">Página {page}</span>
        <button className={button} disabled={page * 25 >= Number(data.entry_count)} onClick={() => setPage(value => value + 1)}>Siguiente</button>
      </div>
    </>}
  </section>;
}
