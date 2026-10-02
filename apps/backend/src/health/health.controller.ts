/**
 * Liveness and readiness.
 *
 * Liveness must NOT check Postgres: a database blip would otherwise restart every process
 * simultaneously, turning a recoverable degradation into a full outage.
 *
 * Readiness MAY check Postgres. It must NOT check Redis or NATS — the system degrades
 * without both, and refusing traffic turns a rate-limiter problem into an availability one.
 */

import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(@InjectDataSource('system') private readonly dataSource: DataSource) {}

  @Get('healthz')
  @ApiOperation({ summary: 'Liveness — the process is up' })
  healthz(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.trunc(process.uptime()) };
  }

  @Get('readyz')
  @ApiOperation({ summary: 'Readiness — Postgres is reachable' })
  async readyz(): Promise<{ status: 'ready'; database: 'up' }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ready', database: 'up' };
  }
}
