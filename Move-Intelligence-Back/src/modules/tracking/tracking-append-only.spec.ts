import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Garante que `ListingObservation` é append-only (F1.1): nenhum código pode
 * fazer `update` nela. O teste varre o `src` (exceto specs) procurando
 * `listingObservation.update`.
 */
describe('ListingObservation é append-only', () => {
  it('nenhum código-fonte chama listingObservation.update', () => {
    const srcDir = join(__dirname, '..', '..');
    const offenders: string[] = [];

    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          visit(full);
          continue;
        }
        // O próprio spec cita o padrão proibido; specs nunca rodam em produção.
        if (!full.endsWith('.ts') || full.endsWith('.spec.ts')) {
          continue;
        }
        const content = readFileSync(full, 'utf8');
        if (/listingObservation\s*\.\s*update/.test(content)) {
          offenders.push(full);
        }
      }
    };

    visit(srcDir);

    expect(offenders).toEqual([]);
  });
});
