/**
 * POST /v1/riders — thin by design: validate, call one use case, return.
 */

import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { RegisterRiderService, type RegisteredRider } from './register-rider.service.ts';

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

  @Post()
  @ApiOperation({ summary: 'Register a rider' })
  async register(@Body() body: RegisterRiderDto): Promise<RegisteredRider> {
    return this.registerRider.execute({
      displayName: body.displayName,
      phone: body.phone,
      capacity: body.capacity,
    });
  }
}
