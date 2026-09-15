import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AlertsController } from '../alerts/alerts.controller';
import { CopilotController } from '../copilot/copilot.controller';
import { DashboardApiController } from '../dashboard-api/dashboard-api.controller';
import { HealthController } from '../health/health.controller';
import { ProductsController } from '../products/products.controller';
import { AuthController } from './auth.controller';
import { IS_PUBLIC_KEY } from './public.decorator';

describe('Acesso público das rotas (IS_PUBLIC_KEY)', () => {
  const reflector = new Reflector();

  it('os quatro controllers de produto não são públicos', () => {
    // Usa Reflector como o JwtAuthGuard: metadata na classe (sem @Public()).
    for (const controller of [
      ProductsController,
      AlertsController,
      CopilotController,
      DashboardApiController,
    ]) {
      expect(reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [{ getClass: () => controller, getHandler: () => controller } as never, controller as never])).toBeFalsy();
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller)).toBeFalsy();
    }
  });

  it('o health continua público por método', () => {
    const handler = HealthController.prototype.check;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController)).toBeFalsy();
  });
});

describe('AuthController — AUTH_ALLOW_REGISTRATION', () => {
  const ORIGINAL_ENV = process.env.AUTH_ALLOW_REGISTRATION;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.AUTH_ALLOW_REGISTRATION;
    } else {
      process.env.AUTH_ALLOW_REGISTRATION = ORIGINAL_ENV;
    }
  });

  function buildController() {
    const auth = { register: jest.fn() };
    return { controller: new AuthController(auth as never), auth };
  }

  it("com AUTH_ALLOW_REGISTRATION=false, register responde 403 sem chamar o service", async () => {
    process.env.AUTH_ALLOW_REGISTRATION = 'false';
    const { controller, auth } = buildController();

    expect(() =>
      controller.register({ email: 'a@b.com', password: '1234567890', name: 'A' } as never),
    ).toThrow(ForbiddenException);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('com flag ausente (default true), register delega ao service', async () => {
    delete process.env.AUTH_ALLOW_REGISTRATION;
    const { controller, auth } = buildController();
    auth.register.mockResolvedValue({ ok: true });

    await controller.register({ email: 'a@b.com', password: '1234567890', name: 'A' } as never);

    expect(auth.register).toHaveBeenCalled();
  });
});
