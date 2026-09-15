import { lookup as dnsLookup } from 'node:dns/promises';

export type WebhookChannel = 'slack' | 'telegram' | 'generic';

/** Hosts confiáveis para cada provedor de webhook conhecido. */
const ALLOWED_HOSTS: Partial<Record<WebhookChannel, string[]>> = {
  slack: ['hooks.slack.com'],
  telegram: ['api.telegram.org'],
};

/**
 * Erro de validação de webhook: URL recusada por não passar nas regras
 * anti-SSRF (protocolo, host permitido ou IP privado/loopback/link-local).
 */
export class UnsafeWebhookUrlError extends Error {}

/**
 * Valida uma URL de webhook antes de qualquer chamada de rede, para evitar
 * SSRF (o servidor sendo usado para bater em endereços internos/privados).
 *
 * Regras:
 * - só aceita `https:`;
 * - para 'slack'/'telegram', o host precisa ser exatamente o domínio oficial
 *   do provedor (hooks.slack.com / api.telegram.org);
 * - para 'generic', qualquer host é aceito desde que NENHUM IP resolvido
 *   (IPv4 ou IPv6) caia em faixa privada, loopback ou link-local.
 *
 * @param lookupFn injeção de dependência para testes (default: node:dns/promises.lookup).
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  channel: WebhookChannel,
  lookupFn: typeof dnsLookup = dnsLookup,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError('URL de webhook inválida.');
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeWebhookUrlError('Webhook precisa usar https:.');
  }

  const hostname = url.hostname.toLowerCase();
  const allowedHosts = ALLOWED_HOSTS[channel];
  if (allowedHosts) {
    if (!allowedHosts.includes(hostname)) {
      throw new UnsafeWebhookUrlError(
        `Para o canal '${channel}', o host precisa ser um dos permitidos: ${allowedHosts.join(', ')}.`,
      );
    }
    return;
  }

  // Canal 'generic': qualquer host, mas nenhum IP resolvido pode ser privado,
  // loopback ou link-local (evita que o servidor bata em rede interna).
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookupFn(hostname, { all: true });
  } catch {
    throw new UnsafeWebhookUrlError(`Não foi possível resolver o host '${hostname}'.`);
  }

  if (addresses.length === 0) {
    throw new UnsafeWebhookUrlError(`Host '${hostname}' não resolveu para nenhum endereço IP.`);
  }

  for (const { address } of addresses) {
    if (isPrivateOrLoopbackOrLinkLocal(address)) {
      throw new UnsafeWebhookUrlError(
        `Host '${hostname}' resolve para um endereço privado/loopback/link-local (${address}), recusado.`,
      );
    }
  }
}

function isPrivateOrLoopbackOrLinkLocal(ip: string): boolean {
  if (ip.includes('.')) {
    return isPrivateOrLoopbackOrLinkLocalV4(ip);
  }
  return isPrivateOrLoopbackOrLinkLocalV6(ip);
}

function isPrivateOrLoopbackOrLinkLocalV4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    // IP malformado: trata como inseguro por padrão.
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateOrLoopbackOrLinkLocalV6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();

  // Endereço IPv4-mapeado em IPv6 (::ffff:a.b.c.d) — valida a parte v4.
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) {
    return isPrivateOrLoopbackOrLinkLocalV4(v4Mapped[1]);
  }

  if (ip === '::1') return true; // loopback
  if (ip === '::') return true; // unspecified

  const firstGroup = ip.split(':')[0];
  // fc00::/7 (unique local): primeiro byte é 0xfc ou 0xfd.
  if (/^f[cd]/.test(firstGroup)) return true;
  // fe80::/10 (link-local): primeiros 10 bits 1111111010.
  if (/^fe[89ab]/.test(firstGroup)) return true;

  return false;
}
