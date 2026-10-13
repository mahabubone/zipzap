import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { HubStaffService } from './hub-staff.service.ts';
import type { StaffedHubRow, StaffRow } from './hub.repository.ts';
import { HubStaffDto, MyHubDto } from './hub-response.dto.ts';

const HUB_STAFF_ROLES = ['MANAGER', 'OPERATOR'] as const;

/** Who to assign to a hub, and in what role. */
export class AssignStaffDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'The user id to assign. Must be an existing user.',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    example: 'OPERATOR',
    enum: HUB_STAFF_ROLES,
    description:
      'The staff role at the hub. MANAGER may assign/revoke staff; OPERATOR scans and reconciles only.',
  })
  @IsIn(HUB_STAFF_ROLES)
  role!: (typeof HUB_STAFF_ROLES)[number];
}

@ApiTags('hubs')
@Controller('v1/hubs')
@UseGuards(ApiKeyGuard)
export class HubStaffController {
  constructor(@Inject(HubStaffService) private readonly staff: HubStaffService) {}

  /**
   * The hub the caller is assigned to.
   *
   * This is what the hub console calls on load — it replaces the picker. A person assigned to one
   * hub lands straight at it; a person assigned to nothing gets a 404 that the console renders as
   * "contact your manager", not a login redirect.
   */
  @Get('my-hub')
  @UseGuards(new ScopeGuard('hub:read'))
  @ApiOperation({ summary: 'The hub this person is assigned to' })
  @ApiOkResponse({
    type: MyHubDto,
    description:
      'The hub the caller works at, including the role they hold there. A person between hubs ' +
      'gets a 404 — that is a normal state, not an authentication failure.',
  })
  @ApiErrors()
  async myHub(@Req() req: AuthenticatedRequest): Promise<StaffedHubRow> {
    const hub = await this.staff.myHub(req.principal!.subjectId);
    if (!hub) {
      throw new ResourceNotFoundError('You are not assigned to a hub.');
    }
    return hub;
  }

  @Get(':hubCode/staff')
  @UseGuards(new ScopeGuard('hub:manage'))
  @ApiOperation({ summary: 'Staff assigned to one hub' })
  @ApiParam({ name: 'hubCode', description: 'The hub whose staff are listed.' })
  @ApiOkResponse({
    type: HubStaffDto,
    isArray: true,
    description:
      'Every person currently assigned to this hub, oldest assignment first. Only a manager at ' +
      'this hub (or a platform admin) may read it.',
  })
  @ApiErrors()
  async list(
    @Req() req: AuthenticatedRequest,
    @Param('hubCode') hubCode: string,
  ): Promise<readonly StaffRow[]> {
    await this.staff.assertCanManageHub(hubCode, req.principal!);
    return this.staff.listAtHub(hubCode);
  }

  @Post(':hubCode/staff')
  @UseGuards(new ScopeGuard('hub:manage'))
  @ApiOperation({ summary: 'Assign a person to a hub' })
  @ApiParam({ name: 'hubCode', description: 'The hub to assign the person to.' })
  @ApiBody({
    type: AssignStaffDto,
    description: 'The user ID and role for the new hub assignment.',
  })
  @ApiCreatedResponse({
    type: HubStaffDto,
    description:
      'The assignment as stored. A person already assigned elsewhere is refused by the database ' +
      '(one active hub per person). Only a manager at this hub (or platform admin) may assign.',
  })
  @ApiErrors()
  async assign(
    @Req() req: AuthenticatedRequest,
    @Param('hubCode') hubCode: string,
    @Body() body: AssignStaffDto,
  ): Promise<StaffRow> {
    await this.staff.assertCanManageHub(hubCode, req.principal!);
    return this.staff.assign({
      hubCode,
      userId: body.userId,
      role: body.role,
      assignedBy: req.principal!.subjectId,
    });
  }

  @Delete(':hubCode/staff/:userId')
  @UseGuards(new ScopeGuard('hub:manage'))
  @ApiOperation({ summary: 'Revoke a person assignment at a hub' })
  @ApiParam({ name: 'hubCode', description: 'The hub to revoke the assignment from.' })
  @ApiParam({ name: 'userId', description: 'The person whose assignment is revoked.' })
  @ApiOkResponse({
    description:
      'The assignment is ended (revoked_at set, row kept for history). A person with no active ' +
      'assignment at this hub gets a 404, not a 403 — a 403 would confirm they once worked here.',
  })
  @ApiErrors()
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param('hubCode') hubCode: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.staff.assertCanManageHub(hubCode, req.principal!);
    return this.staff.revoke({ hubCode, userId });
  }
}
