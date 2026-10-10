/**
 * GET/PUT /v1/notification-preferences — which parcel events this merchant's customers hear about.
 *
 * Thin by design: validate, one service call, return. The merchant is never a parameter — it comes
 * from the principal, because a preferences endpoint that takes a merchant id is a preferences
 * endpoint that can be pointed at somebody else's account.
 *
 * The `eventType` vocabulary is closed at the DTO from the same list the consumer reads, so an
 * unknown event is rejected before it can become a row nothing will ever honour.
 */

import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString } from 'class-validator';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { NotificationPreferencesService } from './notification-preferences.service.ts';
import { NotificationPreferenceDto } from './notification-response.dto.ts';
import { NOTIFIABLE_EVENTS } from './rules/preferences.ts';

export class SetNotificationPreferenceDto {
  @IsString()
  @IsIn([...NOTIFIABLE_EVENTS])
  eventType!: string;

  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('notifications')
@Controller('v1/notification-preferences')
@UseGuards(ApiKeyGuard)
export class NotificationPreferencesController {
  constructor(
    @Inject(NotificationPreferencesService)
    private readonly preferences: NotificationPreferencesService,
  ) {}

  private merchantId(request: AuthenticatedRequest): string {
    // ApiKeyGuard guarantees a merchant-scoped principal for this scope set.
    return request.principal!.merchantId!;
  }

  @Get()
  @UseGuards(new ScopeGuard('notifications:manage'))
  @ApiOperation({
    summary: 'Which parcel notifications your customers receive',
    description:
      'Every event that can notify, answered either way. Absent means on: a merchant is opted ' +
      'out of an event by writing a row, never by leaving one out.',
  })
  @ApiOkResponse({ type: NotificationPreferenceDto, isArray: true })
  @ApiErrors()
  async list(@Req() request: AuthenticatedRequest): Promise<NotificationPreferenceDto[]> {
    return this.preferences.list(this.merchantId(request));
  }

  @Put()
  @UseGuards(new ScopeGuard('notifications:manage'))
  @ApiOperation({
    summary: 'Opt one event out, or back in',
    description:
      'Setting enabled=true removes the row rather than storing "on", so absence stays the single ' +
      'way to say "default".',
  })
  @ApiOkResponse({ type: NotificationPreferenceDto })
  @ApiErrors()
  async set(
    @Body() body: SetNotificationPreferenceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<NotificationPreferenceDto> {
    return this.preferences.set({
      merchantId: this.merchantId(request),
      eventType: body.eventType,
      enabled: body.enabled,
    });
  }
}
