export const contractAccounts = {
  escrow_hold: ["Retención", "Saldo de clientes", "Fondos de clientes retenidos"],
  escrow_release: ["Abono al especialista", "Fondos de clientes retenidos", "Saldo de especialistas"],
  fee_deduction: ["Comisión", "Fondos de clientes retenidos", "Ingreso por comisiones"],
  refund: ["Reembolso del contrato", "Fondos de clientes retenidos", "Saldo de clientes"],
  penalty: ["Compensación al especialista", "Fondos de clientes retenidos", "Saldo de especialistas"],
  cancellation_income: ["Ingreso por cancelación", "Fondos de clientes retenidos", "Ingreso por cancelaciones"],
} as const;
