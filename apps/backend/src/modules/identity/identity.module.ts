import { Module, forwardRef } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { MerchantModule } from '../merchant/merchant.module.ts';
import { FIND_CREDENTIAL, AuthenticateApiKeyService } from './authenticate-api-key.service.ts';
import { FindCredentialService } from '../merchant/find-credential.service.ts';
import { UserService } from './user.service.ts';
import { UserEntity } from './user.entity.ts';
import { UserMerchantEntity } from './user-merchant.entity.ts';
import { ApiKeyGuard } from './api-key.guard.ts';
import { MeController } from './me.controller.ts';
import { LoginController } from './login.controller.ts';
import { LogoutController } from './logout.controller.ts';
import { MembershipController } from './membership.controller.ts';
import { MembershipService } from './membership.service.ts';

/**
 * identity owns two tables as of migration 0036: `users` (a person) and `user_merchants` (the
 * membership, and where a role lives).
 *
 * It registered NO TypeORM connection until then, because a person's password hash sat on
 * `merchant.merchants` — which is exactly why one login could not hold two businesses: the
 * credential that proved who you were was the same row that scoped what you could see. Owning the
 * user is what separates the two.
 *
 * The other direction is unchanged and still a service call: API credentials are merchant's tables,
 * so identity verifies a key through `FindCredentialService` rather than reading them.
 */
@Module({
  imports: [
    forModule('identity', [UserEntity, UserMerchantEntity]),
    forwardRef(() => MerchantModule),
  ],
  providers: [
    AuthenticateApiKeyService,
    ApiKeyGuard,
    UserService,
    // MembershipService injects MerchantAuthService, which is why MerchantModule is imported
    // `forwardRef`: the revocation on a role change or removal is the same service the login flow
    // uses, and duplicating it would be two revocation paths to keep in step.
    MembershipService,
    { provide: FIND_CREDENTIAL, useExisting: FindCredentialService },
  ],
  // ScopeGuard is deliberately NOT a provider. It takes a scope string as a constructor argument
  // and is instantiated at the decorator site with `new ScopeGuard('shipments:write')`; listing
  // it here makes Nest try to inject a string, which it cannot resolve.
  exports: [AuthenticateApiKeyService, ApiKeyGuard, UserService, MembershipService],
  controllers: [MeController, LoginController, LogoutController, MembershipController],
})
export class IdentityModule {}
