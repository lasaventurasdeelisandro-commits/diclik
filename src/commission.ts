export const commissionBasisPoints = 2542;

export function commissionInCents(totalCents: number) {
  return Math.round(totalCents * commissionBasisPoints / 10_000);
}
