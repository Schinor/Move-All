import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function ctx(user?: { role: string }): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('libera ADMIN', () => expect(guard.canActivate(ctx({ role: 'ADMIN' }))).toBe(true));
  it('bloqueia USER', () => expect(() => guard.canActivate(ctx({ role: 'USER' }))).toThrow(ForbiddenException));
  it('bloqueia sem usuário', () => expect(() => guard.canActivate(ctx())).toThrow(ForbiddenException));
});
