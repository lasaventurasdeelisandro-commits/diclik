import ExcelJS from "exceljs";
import { contractAccounts } from "../../services/contractAccounts.ts";

type Movement = { id: string; contract_id: string; created_at: string; type: keyof typeof contractAccounts; amount: number };
type Settlement = {
  provider: string; settlement_ref: string; expected_date: string; expected_cents: string;
  bank_account: string | null; bank_ref: string | null; bank_date: string | null; received_cents: string | null;
};
type QueryReport = { entries: Movement[] };
type Cell = string | number | Date | ExcelJS.CellFormulaValue | null;

const chart = [
  ["1101", "Bancos", "Activo"],
  ["1102", "Liquidaciones por cobrar", "Activo"],
  ["1103", "Otras cuentas por cobrar", "Activo"],
  ["1201", "Activos fijos", "Activo"],
  ["1202", "Depreciación acumulada", "Activo"],
  ["2101", "Saldo de clientes", "Pasivo"],
  ["2102", "Fondos de clientes retenidos", "Pasivo"],
  ["2103", "Saldo de especialistas", "Pasivo"],
  ["2104", "Impuestos por pagar", "Pasivo"],
  ["2105", "Otras cuentas por pagar", "Pasivo"],
  ["3101", "Capital", "Patrimonio"],
  ["3102", "Resultados acumulados", "Patrimonio"],
  ["3103", "Distribuciones a propietarios", "Patrimonio"],
  ["4101", "Ingreso por comisiones", "Ingreso"],
  ["4102", "Ingreso por cancelaciones", "Ingreso"],
  ["4103", "Otros ingresos", "Ingreso"],
  ["5101", "Comisiones bancarias y pasarela", "Gasto"],
  ["5102", "Seguros", "Gasto"],
  ["5103", "Alojamiento y tecnología", "Gasto"],
  ["5104", "Gastos administrativos", "Gasto"],
  ["5105", "Depreciación", "Gasto"],
  ["5106", "Impuesto sobre la renta", "Gasto"],
  ["5107", "Otros gastos", "Gasto"],
] as const;
const mapped = new Map<string, string>(chart.map(([code, name]) => [name, code]));
const numberFormat = '#,##0.00;[Red](#,##0.00);0.00';
const formula = (expression: string): ExcelJS.CellFormulaValue => ({ formula: expression });

function localDate(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
}

export async function buildAccountingWorkbook(report: QueryReport, settlements: Settlement[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DICLIK";
  workbook.calcProperties.fullCalcOnLoad = true;

  function sheet(name: string, headers: string[], widths: number[], rows: Cell[][] = []) {
    const tab = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    tab.columns = widths.map(width => ({ width }));
    tab.addRow(headers);
    tab.addRows(rows);
    const header = tab.getRow(1);
    header.height = 23;
    header.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18283D" } };
      cell.font = { bold: true, color: { argb: "FFFACC55" } };
      cell.alignment = { vertical: "middle" };
    });
    return tab;
  }

  const today = localDate(new Date());
  const control = sheet("Control", ["DICLIK · Ciclo contable (DOP)", "Valor o instrucción"], [38, 112], [
    ["Inicio del período", new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))],
    ["Fin del período", today],
    ["Alcance", "Hoja de trabajo preliminar. DICLIK precarga solo los movimientos internos de contratos."],
    ["Carga manual", "Registra saldos iniciales, depósitos conciliados, gastos e impuestos en Diario general o Ajustes con fecha y referencia."],
    ["Fuente", "La conciliación incluida se exporta como respaldo. Registra en el diario solo los movimientos bancarios confirmados."],
    ["Validación", "Comprueba las diferencias de cada asiento y que el balance ajustado y la ecuación contable estén cuadrados."],
    ["Cierre", "La hoja Cierre propone trasladar los saldos de ingresos y gastos. Revisa antes de registrarlos en la contabilidad oficial."],
    ["Flujo de efectivo", "Clasifica cada movimiento de Bancos como Operación, Inversión o Financiación. Usa Apertura para saldos iniciales."],
    ["Capacidad", "Las fórmulas consideran hasta la fila 50,001 de Diario general y Ajustes."],
    ["Revisión", "Un asiento cuadrado no prueba que los datos estén completos. Valida saldos, declaraciones y políticas con el contador."],
  ]);
  control.getCell("B2").numFmt = control.getCell("B3").numFmt = "dd/mm/yyyy";
  control.getColumn(2).alignment = { wrapText: true, vertical: "middle" };
  for(let row = 4; row <= 11; row++) control.getRow(row).height = 31;
  sheet("Catálogo", ["Código", "Cuenta", "Grupo"], [14, 38, 18], chart.map(row => [...row]));
  const heads = ["Fecha", "Asiento", "Referencia", "Concepto", "Código", "Debe DOP", "Haber DOP", "Flujo efectivo", "Diferencia asiento"];
  const widths = [14, 42, 31, 30, 12, 18, 18, 20, 21];
  const journal = sheet("Diario general", heads, widths);
  const adjustments = sheet("Ajustes", heads, widths);

  for (const entry of [...report.entries].reverse()) {
    const [concept, debit, credit] = contractAccounts[entry.type];
    const base = [localDate(entry.created_at), entry.id, entry.contract_id, concept];
    journal.addRow([...base, mapped.get(debit)!, Number(entry.amount), 0]);
    journal.addRow([...base, mapped.get(credit)!, 0, Number(entry.amount)]);
  }
  for (const source of [journal, adjustments]) {
    source.getColumn(1).numFmt = "dd/mm/yyyy";
    for (const col of [6, 7, 9]) source.getColumn(col).numFmt = numberFormat;
    const last = source.rowCount + 100;
    for (let i = 2; i <= last; i++) {
      source.getCell(`I${i}`).value = formula(`IF(B${i}="","",ROUND(SUMIF(B$2:B$50001,B${i},F$2:F$50001)-SUMIF(B$2:B$50001,B${i},G$2:G$50001),2))`);
    }
    source.autoFilter = `A1:I${last}`;
  }

  // SUMIFS includes dates from the period selector. Dates use real Excel date serials.
  const sum = (source: string, col: string, code: string, mode: "before" | "period", flow?: string) => {
    const tab = `'${source}'!`;
    const range = (c: string) => `${tab}${c}$2:${c}$50001`;
    const conditions = mode === "before" ? `${range("A")},"<"&Control!$B$2` :
      `${range("A")},">="&Control!$B$2,${range("A")},"<="&Control!$B$3`;
    return `SUMIFS(${range(col)},${range("E")},${code},${range("A")},">0",${conditions}${flow ? `,${range("H")},${flow}` : ""})`;
  };
  const movement = (source: string, col: string, row: number, mode: "before" | "period") => sum(source, col, `A${row}`, mode);
  const mayor = sheet("Mayor", ["Código", "Cuenta", "Grupo", "Saldo inicial D−H", "Debe del período", "Haber del período", "Ajustes debe", "Ajustes haber", "Saldo ajustado D−H"], [12, 34, 16, 20, 20, 20, 18, 18, 22]);
  chart.forEach(([code, name, group], index) => {
    const row = index + 2;
    mayor.addRow([code, name, group,
      formula(`${movement("Diario general", "F", row, "before")}-${movement("Diario general", "G", row, "before")}+${movement("Ajustes", "F", row, "before")}-${movement("Ajustes", "G", row, "before")}`),
      formula(movement("Diario general", "F", row, "period")), formula(movement("Diario general", "G", row, "period")),
      formula(movement("Ajustes", "F", row, "period")), formula(movement("Ajustes", "G", row, "period")),
      formula(`ROUND(D${row}+E${row}-F${row}+G${row}-H${row},2)`),
    ]);
  });
  const end = chart.length + 1;
  const closing = sheet("Cierre", ["Código", "Cuenta", "Debe propuesto", "Haber propuesto"], [12, 35, 20, 20]);
  const nominal = chart.map(([, , group], index) => ({ group, row: index + 2 })).filter(({ group }) => group === "Ingreso" || group === "Gasto");
  nominal.forEach(({ row }) => closing.addRow([
    formula(`Mayor!A${row}`), formula(`Mayor!B${row}`),
    formula(`MAX(0,-Mayor!I${row})`), formula(`MAX(0,Mayor!I${row})`),
  ]));
  const closingLast = closing.rowCount;
  closing.addRow(["3102", "Resultados acumulados",
    formula(`MAX(0,SUM(D2:D${closingLast})-SUM(C2:C${closingLast}))`),
    formula(`MAX(0,SUM(C2:C${closingLast})-SUM(D2:D${closingLast}))`),
  ]);
  const closingEquity = closing.rowCount;
  closing.addRow(["", "Comprobación", formula(`ROUND(SUM(C2:C${closingEquity})-SUM(D2:D${closingEquity}),2)`)]);
  closing.getColumn(3).numFmt = closing.getColumn(4).numFmt = numberFormat;
  for (const [name, expression] of [
    ["Balance sin ajustar", (row: number) => `Mayor!D${row}+Mayor!E${row}-Mayor!F${row}`],
    ["Balance ajustado", (row: number) => `Mayor!I${row}`],
    ["Balance poscierre", (row: number) => chart[row - 2][2] === "Ingreso" || chart[row - 2][2] === "Gasto" ? "0" :
      `Mayor!I${row}${chart[row - 2][0] === "3102" ? `+Cierre!C${closingEquity}-Cierre!D${closingEquity}` : ""}`],
  ] as const) {
    const trial = sheet(name, ["Código", "Cuenta", "Debe DOP", "Haber DOP"], [12, 35, 19, 19]);
    chart.forEach(([code, account], i) => {
      const value = expression(i + 2);
      trial.addRow([code, account, formula(`MAX(0,ROUND(${value},2))`), formula(`MAX(0,-ROUND(${value},2))`)]);
    });
    trial.addRow(["", "Total", formula(`SUM(C2:C${end})`), formula(`SUM(D2:D${end})`)]);
    trial.addRow(["", "Diferencia", formula(`ROUND(C${end + 1}-D${end + 1},2)`)]);
    trial.getColumn(3).numFmt = trial.getColumn(4).numFmt = numberFormat;
  }

  const result = sheet("Estado de resultados", ["Resultado ajustado del período", "DOP"], [42, 22]);
  nominal.forEach(({ group, row }) => {
    result.addRow([chart[row - 2][1], formula(group === "Ingreso" ? `Mayor!F${row}+Mayor!H${row}-Mayor!E${row}-Mayor!G${row}` : `Mayor!E${row}+Mayor!G${row}-Mayor!F${row}-Mayor!H${row}`)]);
  });
  const nIncome = nominal.filter(item => item.group === "Ingreso").length;
  const nominalEnd = result.rowCount;
  result.addRow(["Ingresos", formula(`SUM(B2:B${nIncome + 1})`)]);
  result.addRow(["Gastos", formula(`SUM(B${nIncome + 2}:B${nominalEnd})`)]);
  result.addRow(["Resultado neto", formula(`ROUND(B${nominalEnd + 1}-B${nominalEnd + 2},2)`)]);
  const profit = `'Estado de resultados'!B${result.rowCount}`;
  const byGroup = (group: string, col: string) => `SUMIF(Mayor!C2:C${end},"${group}",Mayor!${col}2:${col}${end})`;
  const situation = sheet("Situación financiera", ["Saldos ajustados al fin del período", "DOP"], [50, 23], [
    ["Activos", formula(byGroup("Activo","I"))],
    ["Pasivos", formula(`-${byGroup("Pasivo","I")}`)],
    ["Patrimonio registrado", formula(`-${byGroup("Patrimonio","I")}`)],
    ["Resultados acumulados sin cerrar", formula(`-${byGroup("Ingreso","I")}-${byGroup("Gasto","I")}`)],
    ["Patrimonio total", formula("B4+B5")],
    ["Pasivo y patrimonio", formula("B3+B6")],
    ["Diferencia contable", formula("ROUND(B2-B7,2)")],
  ]);
  const equity = sheet("Cambios en patrimonio", ["Patrimonio del período", "DOP"], [50, 23], [
    ["Patrimonio al inicio", formula(`-${byGroup("Patrimonio","D")}-${byGroup("Ingreso","D")}-${byGroup("Gasto","D")}`)],
    ["Resultado del período", formula(profit)],
    ["Otros movimientos netos de patrimonio", formula(`'Situación financiera'!B6-B2-B3`)],
    ["Patrimonio al cierre", formula("SUM(B2:B4)")],
  ]);
  const cashSource = (classification: string) => ["Diario general", "Ajustes"].map(tab => `${sum(tab, "F", '"1101"', "period", `"${classification}"`)}-${sum(tab, "G", '"1101"', "period", `"${classification}"`)}`).join("+");
  const cash = sheet("Flujo de efectivo", ["Flujo del período", "DOP"], [50, 23], [
    ["Bancos al inicio", formula("Mayor!D2")],
    ["Operación", formula(cashSource("Operación"))],
    ["Inversión", formula(cashSource("Inversión"))],
    ["Financiación", formula(cashSource("Financiación"))],
    ["Saldos de apertura registrados en el período", formula(cashSource("Apertura"))],
    ["Movimientos sin clasificación, revisar", formula("ROUND(Mayor!I2-B2-SUM(B3:B6),2)")],
    ["Bancos al cierre", formula("Mayor!I2")],
  ]);
  for (const tab of [result, situation, equity, cash]) tab.getColumn(2).numFmt = numberFormat;
  for (let col = 4; col <= 9; col++) mayor.getColumn(col).numFmt = numberFormat;

  sheet("Conciliación bancaria", ["Proveedor", "Liquidación", "Fecha prevista", "Esperado DOP", "Cuenta (alias)", "Referencia bancaria", "Fecha banco", "Recibido DOP", "Diferencia DOP", "Estado"], [16, 27, 16, 19, 24, 24, 16, 19, 19, 18],
    settlements.map(row => {
      const expected = Number(row.expected_cents);
      const received = row.received_cents == null ? null : Number(row.received_cents);
      return [row.provider, row.settlement_ref, row.expected_date, expected / 100, row.bank_account, row.bank_ref, row.bank_date,
        received === null ? null : received / 100, received === null ? null : (received - expected) / 100,
        received === null ? "Pendiente" : received === expected ? "Conciliado" : "Con diferencia"];
    }),
  );
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
