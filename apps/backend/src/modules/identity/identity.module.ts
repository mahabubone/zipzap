import { Module, forwardRef } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module.ts';
import { FIND_CREDENTIAL, AuthenticateApiKeyService } from './authenticate-api-key.service.ts';
import { FindCredentialService } from '../merchant/find-credential.service.ts';
import { ApiKeyGuard } from './api-key.guard.ts';

/**
 * identity registers NO TypeORM connection in this slice, because it owns no tables.
 *
 * API credentials are merchant data — docs/domains/merchant.md lists api_credentials under the
 * merchant schema — so identity verifies a key by calling merchant's service rather than reading
 * a table. That is the boundary rule working in our favour: it removed a connection, a JOIN, and
 * an ownership question we would otherwise have answered wrongly.
 */
@Module({
  imports: [forwardRef(() => MerchantModule)],
  providers: [
    AuthenticateApiKeyService,
    ApiKeyGuard,
    { provide: FIND_CREDENTIAL, useExisting: FindCredentialService },
  ],
  // ScopeGuard is deliberately NOT a provider. It takes a scope string as a constructor argument
  // and is instantiated at the decorator site with `new ScopeGuard('shipments:write')`; listing
  // it here makes Nest try to inject a string, which it cannot resolve.
  exports: [AuthenticateApiKeyService, ApiKeyGuard],
})
export class IdentityModule {}
