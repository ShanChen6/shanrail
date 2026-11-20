import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode,
  Injectable, Post, Req, SetMetadata, UnauthorizedException, UseGuards,
  type CanActivate, type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Database } from './database.js';
import { verifyPassword } from './password.js';

export type Role = 'CUSTOMER' | 'ADMIN' | 'INSPECTOR';
type Account = { id: string; email: string; displayName: string; role: Role };
type AuthRequest = { headers: { authorization?: string }; account?: Account; tokenHash?: string };

const rolesKey = Symbol('roles');
export const Roles = (...roles: Role[]) => SetMetadata(rolesKey, roles);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const invalidPasswordHash = '0'.repeat(32) + ':' + '0'.repeat(128);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly database: Database) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException();

    const tokenHash = hashToken(match[1]);
    const { rows } = await this.database.query<Account>(`
      SELECT u.id, u.email, u.display_name AS "displayName", u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
    `, [tokenHash]);
    if (!rows[0]) throw new UnauthorizedException();
    request.account = rows[0];
    request.tokenHash = tokenHash;
    return true;
  }
}

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>(rolesKey, [
      context.getHandler(), context.getClass(),
    ]);
    const { account } = context.switchToHttp().getRequest<AuthRequest>();
    if (!account) throw new UnauthorizedException();
    if (!roles?.includes(account.role)) throw new ForbiddenException();
    return true;
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly database: Database) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const input = body as { email?: unknown; password?: unknown } | null;
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = input?.password;
    if (!email || email.length > 254 || typeof password !== 'string' || !password || password.length > 128) {
      throw new BadRequestException('Valid email and password are required');
    }

    const { rows } = await this.database.query<Account & { passwordHash: string }>(`
      SELECT id, email, display_name AS "displayName", role, password_hash AS "passwordHash"
      FROM users WHERE email = $1
    `, [email]);
    const account = rows[0];
    const valid = await verifyPassword(password, account?.passwordHash ?? invalidPasswordHash);
    if (!account || !valid) throw new UnauthorizedException('Invalid credentials');

    const token = randomBytes(32).toString('hex');
    const session = await this.database.query<{ expiresAt: Date }>(`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, now() + interval '8 hours')
      RETURNING expires_at AS "expiresAt"
    `, [hashToken(token), account.id]);
    const { id, role, displayName } = account;
    return { token, account: { id, email, role, displayName }, expiresAt: session.rows[0].expiresAt };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: AuthRequest) {
    return request.account;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() request: AuthRequest) {
    await this.database.query('DELETE FROM sessions WHERE token_hash = $1', [request.tokenHash]);
  }
}

@Controller('access')
@UseGuards(SessionGuard, RoleGuard)
export class AuthorizationController {
  @Get('admin')
  @Roles('ADMIN')
  admin() { return { role: 'ADMIN' }; }

  @Get('inspection')
  @Roles('INSPECTOR')
  inspection() { return { role: 'INSPECTOR' }; }
}
