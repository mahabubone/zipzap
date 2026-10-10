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
import { IdentityModule } from '../identity/identity.module.ts';
import { AnalyticsConsumer } from './analytics.consumer.ts';
import { MerchantAnalyticsController } from './merchant-analytics.controller.ts';
import { ProjectionQueriesService } from './projection-queries.service.ts';

@Module({
  // IdentityModule is what makes `@UseGuards(ApiKeyGuard)` on the analytics controller
  // resolvable: the guard injects AuthenticateApiKeyService, which identity exports.
  // Without it the whole app fails to boot — a DI error the unit specs cannot see,
  // because none of them build the module graph.
  imports: [forModule('analytics', []), IdentityModule],
  controllers: [MerchantAnalyticsController],
  providers: [AnalyticsConsumer, ProjectionQueriesService],
  exports: [AnalyticsConsumer, ProjectionQueriesService],
})
export class AnalyticsModule {}
