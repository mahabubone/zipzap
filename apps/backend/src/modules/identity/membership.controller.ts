/**
 * Members: who may act inside this business, and as what.
 *
 * The write path that did not exist. `identity.user_merchants` was seeded and never written by the
 * API, which meant `MerchantAuthService.revokeSessionsForUser` had no caller — auth.md promised
 * rotation on privilege change and nothing in the API could change a privilege. It also meant a
 * merchant could not remove somebody who had left.
 *
 * Tenant-scoped in the path rather than derived from the credential alone: `/v1/merchants/:merchantId`
 * so a platform principal acting on a customer's behalf has a merchant to name. `assertTenant` runs
 * first, so a merchant id the caller does not belong to gets the same 404 as one that does not
 * exist — otherwise the path would be an oracle for which business ids are real.
 *
 * The business comes from the path, never the body: a body-supplied tenant is the classic
 * cross-tenant write.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { MembershipNotFoundError } from '../../common/domain-error.ts';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from './api-key.guard.ts';
import { assertTenant } from './rules/api-principal.ts';
import { MERCHANT_GRANTABLE_ROLES } from './rules/membership.ts';
import { RateLimitGuard } from './rate-limit.guard.ts';
import { MembershipService, type MemberView } from './membership.service.ts';
import { MemberDto, MemberListDto } from './membership-response.dto.ts';

/** Who to enrol, and as what. The business comes from the path. */
export class InviteMemberDto {
  @ApiProperty({
    example: 'staff@shop.example',
    description:
      'The email to enrol. A person who already has an account gains a second membership — that is ' +
      'what lets one login act inside two businesses.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'MERCHANT_OPERATOR',
    enum: MERCHANT_GRANTABLE_ROLES,
    description:
      'The role to grant. Platform roles are refused: a merchant granting one would be a tenant ' +
      'writing itself out of its own tenancy.',
  })
  @IsIn(MERCHANT_GRANTABLE_ROLES)
  role!: (typeof MERCHANT_GRANTABLE_ROLES)[number];
}

/** What to change a member to. */
export class ChangeRoleDto {
  @ApiProperty({
    example: 'MERCHANT_OWNER',
    enum: MERCHANT_GRANTABLE_ROLES,
    description:
      'The new role. The same value as the current role is a no-op that signs nobody out.',
  })
  @IsIn(MERCHANT_GRANTABLE_ROLES)
  role!: (typeof MERCHANT_GRANTABLE_ROLES)[number];
}

@ApiTags('members')
@Controller('v1/merchants/:merchantId/members')
@UseGuards(ApiKeyGuard)
export class MembershipController {
  constructor(@Inject(MembershipService) private readonly members: MembershipService) {}

  @Get()
  @UseGuards(new ScopeGuard('members:manage'))
  @ApiOperation({
    summary: 'List this business members',
    description:
      'Every person who may act inside this business and the role they hold in it. Ordered ' +
      'owner-first, so the account owner is the first row on a business of any size.',
  })
  @ApiParam({ name: 'merchantId', description: 'The business whose members to read.' })
  @ApiOkResponse({
    type: MemberListDto,
    description:
      'The members, owner first then by email. An empty list is possible and means a business ' +
      'nobody can act inside — which the orphaning rules exist to prevent.',
  })
  @ApiErrors()
  async list(
    @Req() req: AuthenticatedRequest & { requestId?: string },
    @Param('merchantId') merchantId: string,
  ): Promise<{ members: readonly MemberView[] }> {
    assertTenant(req.principal!, merchantId);
    return this.members.list(merchantId);
  }

  @Post()
  @UseGuards(new ScopeGuard('members:manage'), new RateLimitGuard('merchant', true))
  @ApiOperation({
    summary: 'Add a member to this business',
    description:
      'Enrols a person by email, creating an account for them if they have none. An email that ' +
      'already has an account gains a second membership — that is what makes one login able to act ' +
      'inside two businesses, and why this is not a "create user" endpoint.',
  })
  @ApiParam({ name: 'merchantId', description: 'The business to add the member to.' })
  @ApiCreatedResponse({
    type: MemberDto,
    description:
      'The membership as stored. A disabled account is refused rather than reactivated by an ' +
      'invite — enabling it is a separate decision from enrolling it.',
  })
  @ApiBody({
    type: InviteMemberDto,
    description: 'The email to enrol and the role to grant. No merchant id is accepted here.',
  })
  @ApiErrors()
  async invite(
    @Req() req: AuthenticatedRequest & { requestId?: string },
    @Param('merchantId') merchantId: string,
    @Body() body: InviteMemberDto,
  ): Promise<MemberView> {
    assertTenant(req.principal!, merchantId);
    return this.members.invite({
      merchantId,
      email: body.email,
      role: body.role,
      invitedBy: req.principal!.subjectId,
      ip: req.ip ?? null,
      requestId: req.requestId ?? null,
    });
  }

  @Put(':userId')
  @UseGuards(new ScopeGuard('members:manage'), new RateLimitGuard('merchant', true))
  @ApiOperation({
    summary: 'Change a member role',
    description:
      'Changes what a member may do and ends every session they hold, because a demotion narrows ' +
      'the scopes a session asserts and those are derived from the membership on each request. Setting ' +
      'the role they already hold changes nothing and signs nobody out.',
  })
  @ApiParam({ name: 'merchantId', description: 'The business the member belongs to.' })
  @ApiParam({ name: 'userId', description: 'The person whose role is changing.' })
  @ApiOkResponse({
    type: MemberDto,
    description: 'The membership with its new role. Sessions for this person have been revoked.',
  })
  @ApiBody({
    type: ChangeRoleDto,
    description:
      'The new role. Setting the role the member already holds is a no-op that changes nothing and ' +
      'signs nobody out.',
  })
  @ApiErrors()
  async changeRole(
    @Req() req: AuthenticatedRequest & { requestId?: string },
    @Param('merchantId') merchantId: string,
    @Param('userId') userId: string,
    @Body() body: ChangeRoleDto,
  ): Promise<MemberView> {
    assertTenant(req.principal!, merchantId);
    return this.members.changeRole({
      merchantId,
      userId,
      role: body.role,
      changedBy: req.principal!.subjectId,
      ip: req.ip ?? null,
      requestId: req.requestId ?? null,
    });
  }

  @Delete(':userId')
  @UseGuards(new ScopeGuard('members:manage'), new RateLimitGuard('merchant', true))
  @ApiOperation({
    summary: 'Remove a member from this business',
    description:
      'Removes the membership and ends every session the person holds, immediately. The last owner ' +
      'cannot be removed: a business with no owner has nobody who can add one back, so the lockout ' +
      'would be permanent.',
  })
  @ApiParam({ name: 'merchantId', description: 'The business to remove the member from.' })
  @ApiParam({ name: 'userId', description: 'The person to remove.' })
  @ApiOkResponse({
    type: MemberDto,
    description:
      'The membership as it was, so the removal is confirmable before it is reported back.',
  })
  @ApiErrors()
  async remove(
    @Req() req: AuthenticatedRequest & { requestId?: string },
    @Param('merchantId') merchantId: string,
    @Param('userId') userId: string,
  ): Promise<MemberView> {
    assertTenant(req.principal!, merchantId);
    // Read before delete so the response can say who was removed. The delete itself re-checks the
    // orphaning rule and throws if it would now orphan the business, so a read that succeeds and a
    // delete that throws is a coherent sequence.
    const view = await this.members.memberView(merchantId, userId);
    if (view === null) throw new MembershipNotFoundError();

    await this.members.remove({
      merchantId,
      userId,
      removedBy: req.principal!.subjectId,
      ip: req.ip ?? null,
      requestId: req.requestId ?? null,
    });
    return view;
  }
}
