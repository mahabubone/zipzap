/**
 * POST /v1/pickups/:id/assign — thin by design: validate, call one use case, return.
 *
 * Candidate positions arrive from the caller (operations console today, dispatch later); the
 * rider contract scores them deterministically. The controller knows nothing about scoring.
 */

import { Body, Controller, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { AssignPickupService } from './assign-pickup.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { AssignedPickupDto } from './pickup-response.dto.ts';

export class AssignmentCandidateDto {
  @IsUUID('4')
  riderId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  distanceMetres?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  activeJobs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recentRefusals?: number;
}

export class AssignPickupDto {
  @IsArray()
  candidates!: AssignmentCandidateDto[];
}

@ApiTags('pickups')
@Controller('v1/pickups')
@UseGuards(ApiKeyGuard)
export class AssignPickupController {
  constructor(@Inject(AssignPickupService) private readonly assignPickup: AssignPickupService) {}

  @Post(':id/assign')
  @UseGuards(new ScopeGuard('pickup:create'))
  @ApiOperation({ summary: 'Assign a rider to a pickup' })
  @ApiParam({ name: 'id', description: 'The pickup aggregate id to assign.' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: AssignedPickupDto })
  @ApiErrors()
  async assign(
    @Param('id') id: string,
    @Body() body: AssignPickupDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<AssignedPickupDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }

    const { result, replayed } = await this.assignPickup.execute({
      pickupId: id,
      candidates: body.candidates.map((candidate) => ({
        riderId: candidate.riderId,
        distanceMetres: candidate.distanceMetres ?? null,
        activeJobs: candidate.activeJobs ?? 0,
        capacity: candidate.capacity ?? 1,
        recentRefusals: candidate.recentRefusals ?? 0,
      })),
      idempotencyKey: idempotencyKey.trim(),
      actorId: request.principal?.subjectId ?? null,
    });

    return { ...result, replayed };
  }
}
