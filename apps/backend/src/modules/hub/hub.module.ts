import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';

/**
 * hub — the `hub` schema owner. Rung 2b ships the `hubs` table (migration 0025,
 * seeded) and nothing else: staff, capacity, schedules and the scan workflow
 * arrive with their first consumer. Nobody may read `hub.*` but this module —
 * route legs reference hubs by bare identifier, per ADR-0002.
 */
@Module({
  imports: [forModule('hub', [])],
  providers: [],
  exports: [],
})
export class HubModule {}
