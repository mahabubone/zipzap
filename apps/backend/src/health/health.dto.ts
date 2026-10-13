/**
 * Health probe response shapes.
 *
 * Inline object literals in a controller produce no schema — `SwaggerModule` only introspects
 * decorated classes — so both probes answered with an empty 200. See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';

export class HealthzDto {
  @ApiProperty({ example: 'ok', enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({
    example: 4321,
    description: 'Whole seconds this process has been up. Rests on restart, as liveness does.',
  })
  uptimeSeconds!: number;
}

export class ReadyzDto {
  @ApiProperty({ example: 'ready', enum: ['ready'] })
  status!: 'ready';

  @ApiProperty({
    example: 'up',
    enum: ['up'],
    description: 'Postgres only. Redis and NATS are deliberately absent: see the controller.',
  })
  database!: 'up';
}
