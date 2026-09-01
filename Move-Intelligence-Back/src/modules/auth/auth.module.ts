import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const developmentSecret = randomBytes(48).toString('base64url');

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret:
        process.env.JWT_SECRET ??
        (process.env.NODE_ENV === 'production' ? undefined : developmentSecret),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
