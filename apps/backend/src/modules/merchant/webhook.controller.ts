/**
 * Webhook HTTP surface. Thin by design: validate → one service call → return.
 *
 * Guarded by webhooks:manage for writes. The secret is returned once, on create
 * and on rotate — there is no "show me the secret" path, because there must not
 * be one.
 */

import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { WebhookEndpointService, type EndpointView } from './webhook-endpoint.service.ts';
import { WebhookReplayService } from './webhook-replay.service.ts';
import {
  ListWebhookDeliveriesService,
  type DeliveryLogPage,
} from './list-webhook-deliveries.service.ts';

export class DeliveryLogQuery {
  @IsOptional()
  @IsUUID('4')
  endpointId?: string;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  url!: string;

  @IsArray()
  @IsString({ each: true })
  events!: string[];
}

@ApiTags('webhooks')
@Controller('v1/webhooks')
@UseGuards(ApiKeyGuard)
export class WebhookController {
  constructor(
    @Inject(WebhookEndpointService) private readonly endpoints: WebhookEndpointService,
    @Inject(WebhookReplayService) private readonly replay: WebhookReplayService,
    @Inject(ListWebhookDeliveriesService) private readonly deliveries: ListWebhookDeliveriesService,
  ) {}

  private merchantId(request: AuthenticatedRequest): string {
    // ApiKeyGuard guarantees a merchant-scoped principal for this scope set.
    return request.principal!.merchantId!;
  }

  @Get()
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'List your webhook endpoints' })
  async list(@Req() request: AuthenticatedRequest): Promise<EndpointView[]> {
    return this.endpoints.list(this.merchantId(request));
  }

  @Post()
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Register a webhook endpoint; secret returned once' })
  async create(
    @Body() body: CreateWebhookDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ endpoint: EndpointView; secret: string }> {
    return this.endpoints.create({
      merchantId: this.merchantId(request),
      url: body.url,
      events: body.events,
    });
  }

  @Post(':id/rotate')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Rotate the signing secret; new secret returned once' })
  async rotate(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ secret: string }> {
    return this.endpoints.rotateSecret(this.merchantId(request), id);
  }

  @Post(':id/pause')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Pause delivery to an endpoint' })
  async pause(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<EndpointView> {
    return this.endpoints.setStatus(this.merchantId(request), id, 'PAUSED');
  }

  @Post(':id/resume')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Resume delivery to an endpoint' })
  async resume(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<EndpointView> {
    return this.endpoints.setStatus(this.merchantId(request), id, 'ACTIVE');
  }

  /**
   * The delivery log. Added because `replay` was unreachable without it — a merchant could not learn
   * that a delivery id existed, let alone that it had failed. Every attempt, every status code, and
   * whether the ladder has ended.
   */
  @Get('deliveries')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({
    summary: 'Every webhook delivery attempt for your endpoints, newest first',
  })
  async deliveryLog(
    @Req() request: AuthenticatedRequest,
    @Query() query: DeliveryLogQuery,
  ): Promise<DeliveryLogPage> {
    return this.deliveries.execute(this.merchantId(request), {
      endpointId: query.endpointId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post('deliveries/:deliveryId/replay')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Replay a terminal delivery with a fresh delivery id' })
  async replayDelivery(
    @Param('deliveryId') deliveryId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ deliveryId: string; endpointId: string; wireEvent: string }> {
    return this.replay.replay({ merchantId: this.merchantId(request), deliveryId });
  }
}
