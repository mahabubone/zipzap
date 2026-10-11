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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { HealthzDto, ReadyzDto } from './health.dto.ts';
import { ApiErrors } from '../common/api-errors.decorator.ts';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(@InjectDataSource('system') private readonly dataSource: DataSource) {}

  @Get('healthz')
  @ApiOperation({
    summary: 'Liveness — the process is up',
    description:
      'Deliberately checks nothing: a Postgres blip must not restart every process at once. ' +
      'Use /readyz for dependency health. Never returns an error envelope.',
  })
  @ApiOkResponse({
    type: HealthzDto,
    description:
      'The process is up, and for how long, in whole seconds. Nothing is checked and nothing can ' +
      'fail here, so this route has no error responses at all — use /readyz for dependencies.',
  })
  healthz(): HealthzDto {
    return { status: 'ok', uptimeSeconds: Math.trunc(process.uptime()) };
  }

  @Get('readyz')
  @ApiOperation({ summary: 'Readiness — Postgres is reachable' })
  @ApiOkResponse({
    type: ReadyzDto,
    description:
      '`ready`, once a `SELECT 1` round-trip to Postgres has succeeded. Redis and NATS are ' +
      'deliberately absent from the answer: the system degrades without them, and refusing traffic ' +
      'here would turn a cache or rate-limit outage into an availability one.',
  })
  @ApiErrors()
  async readyz(): Promise<ReadyzDto> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ready', database: 'up' };
  }
}
