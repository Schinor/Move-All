import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../shared/database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('E-mail já cadastrado.');
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hash(dto.password, { memoryCost: 19456, timeCost: 2 }),
        name: dto.name.trim(),
        company: dto.company?.trim() || null,
      },
    });
    return this.issueSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!user || !user.active || !(await verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    return this.issueSession(user);
  }

  async refresh(rawToken: string) {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.digest(rawToken) },
      include: { user: true },
    });
    if (!token || token.revokedAt || token.expiresAt <= new Date() || !token.user.active) {
      throw new UnauthorizedException('Refresh token inválido ou expirado.');
    }
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) {
      throw new UnauthorizedException('Refresh token já utilizado.');
    }
    return this.issueSession(token.user);
  }

  async logout(rawToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.digest(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException();
    return this.presentUser(user);
  }

  private async issueSession(user: {
    id: string;
    email: string;
    name: string;
    company: string | null;
    role: string;
  }) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      // Sessão longa (~7 dias): o refresh silencioso (30d deslizantes) renova depois disso.
      { expiresIn: '7d' },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.digest(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return { user: this.presentUser(user), accessToken, refreshToken };
  }

  private presentUser(user: {
    id: string;
    email: string;
    name: string;
    company: string | null;
    role: string;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      company: user.company,
      role: user.role,
    };
  }

  private digest(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
