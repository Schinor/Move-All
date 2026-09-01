/** Formata número como moeda BRL compacta (ex.: R$ 1,2M). */
export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export const STAGE_LABEL: Record<string, string> = {
  emerging: 'Emergente',
  rising: 'Em ascensão',
  peaking: 'Em pico',
  mainstream: 'Mainstream',
};
