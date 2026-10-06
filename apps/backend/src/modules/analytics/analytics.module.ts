/**
 * analytics — the `analytics` schema owner (Phase 6 rung 3).
 *
 * Read-only projections fed exclusively by the event stream; no authoritative
 * data, no domain imports, no joins outward. `forModule('analytics', [])`
 * registers an empty schema-scoped DataSource: the tables are projection
 * storage, reached only through raw upserts in this module (rule 2).
 */

import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { AnalyticsConsumer } from './analytics.consumer.ts';

@Module({
  imports: [forModule('analytics', [])],
  providers: [AnalyticsConsumer],
  exports: [AnalyticsConsumer],
})
export class AnalyticsModule {}
