import { useEffect, useState, type FormEvent } from "react";
import { api } from "../services/api";

type Settlement = {
  id: string; provider: string; settlement_ref: string; expected_date: string; expected_cents: string;
  bank_account: string | null; bank_ref: string | null; bank_date: string | null; received_cents: string | null;
};
const currency = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const amount = (cents: number | string) => currency.format(Number(cents) / 100);
const button = "rounded-lg border border-slate-600 px-3 py-1.5 text-sm disabled:opacity-40";
const input = "mt-1 block w-full rounded-lg border border-slate-600 bg-slate-950 p-2";

export function BankReconciliation() {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Settlement | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.admin.getBankSettlements(page, controller.signal).then(data => {
      if (!controller.signal.aborted) { setRows(data.records); setTotal(data.total); }
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [page, revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(String(fields.get("amount")).trim());
    const cents = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : 0;
    if (!cents) { setMessage("Indica un importe positivo con hasta dos decimales."); return; }
    const reference = String(fields.get("reference"));
    const date = String(fields.get("date"));
    setBusy(true);
    setMessage("");
    try {
      const detail = selected ? { account: String(fields.get("account")) } : { provider: String(fields.get("provider")) };
      const result = await api.admin.saveBankSettlement(selected?.id ?? null, { reference, date, cents, ...detail });
      setMessage(selected ? (result.matched ? "Abono conciliado." : "Abono registrado con diferencia. Revisa ambos reportes.") : "Liquidación registrada como pendiente.");
      form.reset();
      setSelected(null);
      setPage(1);
      setRevision(value => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el movimiento.");
    } finally { setBusy(false); }
  }

  return <section className="space-y-3 border-t border-slate-700 pt-4" aria-label="Conciliación bancaria">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-bold">Conciliación bancaria</h3>
      <button className={button} onClick={() => void api.admin.downloadFinance("bank-settlements").catch(error => setMessage(error.message))}>Descargar conciliación (CSV)</button>
    </div>
    <p className="text-xs text-slate-300">Registra el neto esperado del reporte de liquidación de la pasarela. Luego coteja la referencia y el importe con tu extracto bancario. Usa un alias para identificar la cuenta.</p>
    <form key={selected?.id ?? "new"} onSubmit={submit} className="rounded-lg border border-slate-700 p-3 space-y-2">
      <h4 className="font-bold">{selected ? `Cotejar abono de ${selected.settlement_ref}` : "Registrar liquidación esperada"}</h4>
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        {selected ? <label>Alias de la cuenta bancaria<input name="account" required maxLength={80} defaultValue={selected.bank_account ?? ""} className={input} /></label>
          : <label>Proveedor<select name="provider" className={input}>{["CardNET", "AZUL", "PORTAL", "Otro"].map(provider => <option key={provider}>{provider}</option>)}</select></label>}
        <label>{selected ? "Referencia del extracto" : "Referencia de la liquidación"}<input name="reference" defaultValue={selected?.bank_ref ?? ""} required maxLength={100} className={input} /></label>
        <label>{selected ? "Fecha del abono" : "Fecha prevista"}<input name="date" defaultValue={selected?.bank_date ?? ""} type="date" required className={input} /></label>
        <label>{selected ? "Abono recibido (RD$)" : "Neto esperado (RD$)"}<input name="amount" defaultValue={selected?.received_cents ? (Number(selected.received_cents) / 100).toFixed(2) : ""} inputMode="decimal" required className={input} /></label>
      </div>
      <button className={button} disabled={busy} type="submit">{selected ? "Guardar cotejo" : "Guardar liquidación"}</button>
      {selected && <button className={button} disabled={busy} type="button" onClick={() => setSelected(null)}>Cancelar edición</button>}
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr>{["Liquidación", "Fecha prevista", "Neto esperado", "Abono recibido", "Diferencia", "Estado", "Acción"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => {
          const difference = row.received_cents === null ? null : Number(row.received_cents) - Number(row.expected_cents);
          return <tr key={row.id} className="border-t border-slate-700">
            <td className="p-2">{row.provider} · {row.settlement_ref}{row.bank_ref && <span className="block text-xs text-slate-400">{row.bank_account} · {row.bank_ref} · {row.bank_date}</span>}</td>
            <td className="p-2">{row.expected_date}</td><td className="p-2">{amount(row.expected_cents)}</td>
            <td className="p-2">{row.received_cents === null ? "—" : amount(row.received_cents)}</td>
            <td className="p-2">{difference === null ? "—" : amount(difference)}</td>
            <td className="p-2">{difference === 0 ? "Conciliado" : difference === null ? "Pendiente" : "Con diferencia"}</td>
            <td className="p-2">{difference !== 0 && <button className={button} disabled={busy} onClick={() => setSelected(row)}>Cotejar abono</button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!rows.length && <p className="text-sm">Aún no se registran liquidaciones en esta página.</p>}
    {total > 25 && <div className="flex items-center gap-2">
      <button className={button} disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
      <span className="text-sm">Página {page}</span>
      <button className={button} disabled={page * 25 >= total} onClick={() => setPage(value => value + 1)}>Siguiente</button>
    </div>}
  </section>;
}
