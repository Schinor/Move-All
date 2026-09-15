import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CopilotService } from './copilot.service';
import { CopilotStreamStore } from './copilot-stream.store';

describe('CopilotStreamStore (P0-5)', () => {
  let store: CopilotStreamStore;
  let chatStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chatStream = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotService, useValue: { chatStream } }],
    });
    store = TestBed.inject(CopilotStreamStore);
  });

  it('acumula tokens por conversa e conclui como idle', async () => {
    chatStream.mockImplementation(async (_req: unknown, onToken: (t: string) => void) => {
      onToken('Olá ');
      onToken('mundo');
      return 'Olá mundo';
    });

    await store.run({ key: 'c1', request: { messages: [] } });

    expect(store.stateFor('c1').status).toBe('idle');
    expect(store.isBusy('c1')).toBe(false);
  });

  it('streams de conversas distintas não se misturam', async () => {
    chatStream.mockImplementation(async (_req: unknown, onToken: (t: string) => void) => {
      onToken('A');
      return 'A';
    });

    await store.run({ key: 'cA', request: { messages: [] } });
    expect(store.isBusy('cB')).toBe(false);
    expect(store.stateFor('cB').status).toBe('idle');
  });

  it('erro vira status error com mensagem (timeout/rede)', async () => {
    chatStream.mockRejectedValue(new Error('Não consegui gerar a resposta agora. Tente de novo.'));

    const outcome = await store.run({ key: 'c1', request: { messages: [] } });

    expect(outcome.ok).toBe(false);
    expect(store.stateFor('c1').status).toBe('error');
    expect(store.stateFor('c1').error).toContain('Tente de novo');
  });

  it('rekey migra o stream pendente para o id real', async () => {
    let resolveRun!: (v: string) => void;
    chatStream.mockImplementation(
      (_req: unknown, _onToken: (t: string) => void, onId?: (id: string) => void) =>
        new Promise<string>((resolve) => {
          resolveRun = resolve;
          onId?.('real-1');
        }),
    );

    const promise = store.run({ key: 'pending:1', request: { messages: [] } });
    await Promise.resolve();
    expect(store.isBusy('real-1')).toBe(true);
    resolveRun('ok');
    await promise;
    expect(store.isBusy('real-1')).toBe(false);
  });
});
