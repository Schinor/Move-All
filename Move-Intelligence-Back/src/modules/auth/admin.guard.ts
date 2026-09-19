import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/** Rotas do catálogo que só ADMIN pode usar (fila de revisão, tipos, renomear card). */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (request.user?.role !== 'ADMIN') {
      throw new ForbiddenException('Acesso restrito a administradores.');
    }
    return true;
  }
}
