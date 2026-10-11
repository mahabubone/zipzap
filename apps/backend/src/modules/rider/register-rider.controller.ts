/**
 * POST /v1/riders — thin by design: validate, call one use case, return.
 */

import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { RegisterRiderService } from './register-rider.service.ts';
import { RegisteredRiderDto } from './rider-response.dto.ts';

export class RegisterRiderDto {
  @IsString()
  @MaxLength(120)
  displayName!: string;

  @Matches(/^\+8801[3-9]\d{8}$/, { message: 'phone must be E.164, e.g. +8801700000000' })
  phone!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class RegisterRiderController {
  constructor(@Inject(RegisterRiderService) private readonly registerRider: RegisterRiderService) {}

  @ApiErrors()
  @Post()
  @ApiOperation({ summary: 'Register a rider' })
  @ApiCreatedResponse({
    type: RegisteredRiderDto,
    description:
      "The new rider's id and the status it was born with — AVAILABLE unless suspended at creation.",
  })
  @ApiBody({
    type: RegisterRiderDto,
    description:
      "The rider's name and E.164 phone, plus an optional parcel capacity — 3 when omitted.",
  })
  async register(@Body() body: RegisterRiderDto): Promise<RegisteredRiderDto> {
    return this.registerRider.execute({
      displayName: body.displayName,
      phone: body.phone,
      capacity: body.capacity,
    });
  }
}
