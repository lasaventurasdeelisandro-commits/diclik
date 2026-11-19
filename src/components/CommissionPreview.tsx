import { commissionBasisPoints, commissionInCents } from "../commission";
import { useState } from "react";

const currency = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });

export function CommissionPreview() {
  const [price, setPrice] = useState("2500.00");
  const [showTax, setShowTax] = useState(false);
  const normalizedPrice = price.trim().replace(",", ".");
  // Calculate in centavos and round each invoice line independently.
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalizedPrice);
  const total = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
  const fee = total === null ? 0 : commissionInCents(total);
  const tax = showTax ? Math.round(fee * 18 / 100) : 0;
  const format = (centavos: number) => currency.format(centavos / 100);

  return <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
    <h2 className="font-bold text-amber-300">Vista previa de comisión</h2>
    <p className="text-sm text-slate-300">Simulación para República Dominicana. Los importes de esta vista son ejemplos.</p>
    <label className="block text-sm">
      Precio del servicio en RD$
      <input value={price} onChange={event => setPrice(event.target.value)} inputMode="decimal"
        className="mt-1 block w-full max-w-xs rounded-lg border border-slate-600 bg-slate-950 p-2" />
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={showTax} onChange={event => setShowTax(event.target.checked)} />
      Incluir ITBIS del 18 % sobre la comisión en esta simulación
    </label>
    {total === null ? <p role="status" className="text-sm text-amber-200">Escribe un importe con hasta dos decimales.</p> :
      <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm" aria-live="polite">
        <dt>Comisión DICLIK ({commissionBasisPoints / 100} %)</dt><dd>{format(fee)}</dd>
        {showTax && <><dt>ITBIS sobre la comisión</dt><dd>{format(tax)}</dd></>}
        <dt>Descuento total al especialista</dt><dd>{format(fee + tax)}</dd>
        <dt className="font-bold">Neto del especialista</dt><dd className="font-bold text-emerald-300">{format(total - fee - tax)}</dd>
      </dl>}
  </section>;
}
