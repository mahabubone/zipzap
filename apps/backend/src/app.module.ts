import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { SystemModule } from './modules/system/system.module';

/**
 * The API process. Every domain module is imported here once — worker and publisher import
 * the same modules, never a copy (docs/architecture/overview.md).
 */
@Module({
  imports: [SystemModule],
  controllers: [HealthController],
})
export class AppModule {}
