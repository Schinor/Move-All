import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from './webhook-safety';

describe('assertSafeWebhookUrl', () => {
  it('aceita um webhook Slack oficial em https', async () => {
    await expect(
      assertSafeWebhookUrl('https://hooks.slack.com/services/T000/B000/xxx', 'slack'),
    ).resolves.toBeUndefined();
  });

  it('rejeita host que não seja hooks.slack.com no canal slack', async () => {
    await expect(
      assertSafeWebhookUrl('https://evil.example.com/hooks.slack.com', 'slack'),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('aceita um webhook Telegram oficial em https', async () => {
    await expect(
      assertSafeWebhookUrl('https://api.telegram.org/botXXX/sendMessage', 'telegram'),
    ).resolves.toBeUndefined();
  });

  it('rejeita host que não seja api.telegram.org no canal telegram', async () => {
    await expect(
      assertSafeWebhookUrl('https://api.telegram.org.evil.com/x', 'telegram'),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('rejeita protocolo não-https mesmo para host permitido', async () => {
    await expect(
      assertSafeWebhookUrl('http://hooks.slack.com/services/T000/B000/xxx', 'slack'),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('rejeita URL malformada', async () => {
    await expect(assertSafeWebhookUrl('not-a-url', 'generic')).rejects.toBeInstanceOf(
      UnsafeWebhookUrlError,
    );
  });

  describe('canal generic (resolução de DNS)', () => {
    it('aceita host cujo IP resolvido é público', async () => {
      const lookupFn = jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(
        assertSafeWebhookUrl('https://meu-endpoint.example.com/hook', 'generic', lookupFn as any),
      ).resolves.toBeUndefined();
      expect(lookupFn).toHaveBeenCalledWith('meu-endpoint.example.com', { all: true });
    });

    it.each([
      ['10.0.0.5', '10/8'],
      ['172.16.5.1', '172.16/12'],
      ['172.31.255.254', '172.16/12'],
      ['192.168.1.1', '192.168/16'],
      ['127.0.0.1', '127/8 (loopback)'],
      ['169.254.169.254', '169.254/16 (link-local / metadata)'],
      ['0.0.0.0', '0/8'],
    ])('rejeita IPv4 privado/loopback/link-local %s (%s)', async (address) => {
      const lookupFn = jest.fn().mockResolvedValue([{ address, family: 4 }]);
      await expect(
        assertSafeWebhookUrl('https://interno.example.com/hook', 'generic', lookupFn as any),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it.each([
      ['::1', 'loopback'],
      ['fc00::1', 'unique local fc00::/7'],
      ['fd12:3456:789a::1', 'unique local fc00::/7'],
      ['fe80::1', 'link-local fe80::/10'],
      ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
      ['::ffff:10.0.0.5', 'IPv4-mapped 10/8'],
    ])('rejeita IPv6 privado/loopback/link-local %s (%s)', async (address) => {
      const lookupFn = jest.fn().mockResolvedValue([{ address, family: 6 }]);
      await expect(
        assertSafeWebhookUrl('https://interno.example.com/hook', 'generic', lookupFn as any),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('rejeita quando qualquer um dos IPs resolvidos for privado (multi-A record)', async () => {
      const lookupFn = jest
        .fn()
        .mockResolvedValue([
          { address: '203.0.113.10', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]);
      await expect(
        assertSafeWebhookUrl('https://misto.example.com/hook', 'generic', lookupFn as any),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('rejeita quando a resolução de DNS falha', async () => {
      const lookupFn = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
      await expect(
        assertSafeWebhookUrl('https://nao-existe.example.com/hook', 'generic', lookupFn as any),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });
  });
});
