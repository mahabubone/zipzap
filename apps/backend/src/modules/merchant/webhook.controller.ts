/**
 * Webhook HTTP surface. Thin by design: validate → one service call → return.
 *
 * Guarded by webhooks:manage for writes. The secret is returned once, on create
 * and on rotate — there is no "show me the secret" path, because there must not
 * be one.
 */

import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsArray, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { WebhookEndpointService } from './webhook-endpoint.service.ts';
import { WebhookReplayService } from './webhook-replay.service.ts';
import { ListWebhookDeliveriesService } from './list-webhook-deliveries.service.ts';
import { DeliveryLogQuery } from './webhook-delivery-log-query.dto.ts';
import {
  CreatedEndpointDto,
  DeliveryLogPageDto,
  EndpointViewDto,
  ReplayedDeliveryDto,
  RotatedSecretDto,
} from './merchant-response.dto.ts';

export class CreateWebhookDto {
  @ApiProperty({
    example: 'https://hooks.example.com/zipzap',
    description:
      'The URL deliveries are POSTed to. Only its being a URL is checked here — TLS and ' +
      'reachability are not, so a plain-http URL is accepted and then fails delivery.',
  })
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  url!: string;

  @ApiProperty({
    example: ['shipment.delivered', 'cod.collected'],
    type: String,
    isArray: true,
    description:
      'Event types to subscribe to, from the wire catalogue on the `webhooks` tag. One that is not ' +
      'in the catalogue is rejected rather than silently accepted.',
  })
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

  @ApiErrors()
  @Get()
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'List your webhook endpoints' })
  @ApiOkResponse({
    type: EndpointViewDto,
    isArray: true,
    description:
      'Every endpoint registered to your business, oldest first and never paginated — a merchant ' +
      'has a handful, not thousands. No signing secret is in here: the secret exists in the create ' +
      'and rotate responses and nowhere else.',
  })
  async list(@Req() request: AuthenticatedRequest): Promise<readonly EndpointViewDto[]> {
    return this.endpoints.list(this.merchantId(request));
  }

  @ApiErrors()
  @Post()
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({
    summary: 'Register a webhook endpoint; secret returned once',
    description:
      'Registers a delivery URL and an event list, and returns the signing secret once. An event ' +
      'outside the `x-webhook-events` catalogue is rejected with 404 rather than accepted quietly, ' +
      'and the body carries no business identity at all — that comes from your credential.',
  })
  @ApiBody({
    type: CreateWebhookDto,
    description:
      'The URL to POST deliveries to, and the events to send it. Any other field is rejected, so ' +
      'there is nothing here through which to name a business.',
  })
  @ApiCreatedResponse({
    type: CreatedEndpointDto,
    description:
      'The endpoint as it was stored, and its signing secret this one time. The secret is kept to ' +
      'sign deliveries and is never returned again — there is no route that shows it, so store it ' +
      'now or rotate to get a fresh one.',
  })
  async create(
    @Body() body: CreateWebhookDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreatedEndpointDto> {
    return this.endpoints.create({
      merchantId: this.merchantId(request),
      url: body.url,
      events: body.events,
    });
  }

  @ApiErrors()
  @Post(':id/rotate')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Rotate the signing secret; new secret returned once' })
  @ApiParam({
    name: 'id',
    description: 'The endpoint whose signing secret is replaced. Must be one of your own.',
  })
  @ApiOkResponse({
    type: RotatedSecretDto,
    description:
      'The new signing secret, returned exactly once, as at create. Deliveries dispatched from now ' +
      'on are signed with it, while jobs already queued keep the old secret until their retry ladder ' +
      'ends — so expect both to verify until the ladder drains.',
  })
  async rotate(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RotatedSecretDto> {
    return this.endpoints.rotateSecret(this.merchantId(request), id);
  }

  @ApiErrors()
  @Post(':id/pause')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Pause delivery to an endpoint' })
  @ApiParam({
    name: 'id',
    description: 'The endpoint to stop delivering to. Must be one of your own.',
  })
  @ApiOkResponse({
    type: EndpointViewDto,
    description:
      'The endpoint with status PAUSED. New events stop being dispatched to it immediately, and ' +
      'replay refuses while it is paused; attempts already queued still run their ladder out.',
  })
  async pause(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<EndpointViewDto> {
    return this.endpoints.setStatus(this.merchantId(request), id, 'PAUSED');
  }

  @ApiErrors()
  @Post(':id/resume')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({ summary: 'Resume delivery to an endpoint' })
  @ApiParam({
    name: 'id',
    description: 'The endpoint to resume delivering to. Must be one of your own.',
  })
  @ApiOkResponse({
    type: EndpointViewDto,
    description:
      'The endpoint back to status ACTIVE, receiving events again from the next dispatch. Pause ' +
      'and resume are the only statuses this route writes.',
  })
  async resume(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<EndpointViewDto> {
    return this.endpoints.setStatus(this.merchantId(request), id, 'ACTIVE');
  }

  /**
   * The delivery log. Added because `replay` was unreachable without it — a merchant could not learn
   * that a delivery id existed, let alone that it had failed. Every attempt, every status code, and
   * whether the ladder has ended.
   */
  @ApiErrors()
  @Get('deliveries')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({
    summary: 'Every webhook delivery attempt for your endpoints, newest first',
    description:
      'The evidence trail that makes replay reachable: every attempt, the status code your server ' +
      'answered with, the error when it answered none, and whether the retry ladder has ended. ' +
      'Scoped to your business in the query itself, not filtered afterwards, and never mutated here.',
  })
  @ApiOkResponse({
    type: DeliveryLogPageDto,
    description:
      'A page of attempts, newest first: status code, error, delivered, and whether the row is ' +
      'terminal. Follow `nextCursor` rather than an offset — the log grows while it is being read, ' +
      'and `null` means there is nothing after this page.',
  })
  async deliveryLog(
    @Req() request: AuthenticatedRequest,
    @Query() query: DeliveryLogQuery,
  ): Promise<DeliveryLogPageDto> {
    return this.deliveries.execute(this.merchantId(request), {
      endpointId: query.endpointId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @ApiErrors()
  @Post('deliveries/:deliveryId/replay')
  @UseGuards(new ScopeGuard('webhooks:manage'))
  @ApiOperation({
    summary: 'Replay a terminal delivery with a fresh delivery id',
    description:
      'Re-enqueues a terminal delivery, so a merchant can pause, fix the endpoint and replay ' +
      'instead of reconciling by hand. A delivery still climbing its ladder is refused: it will ' +
      'arrive on its own, and re-firing it now would double-deliver.',
  })
  @ApiParam({
    name: 'deliveryId',
    description:
      'A delivery id from the delivery log. It must be terminal — delivered, permanently failed, ' +
      'or out of retries.',
  })
  @ApiOkResponse({
    type: ReplayedDeliveryDto,
    description:
      'The fresh delivery id the replay was enqueued under, with the endpoint and event it repeats. ' +
      'The original id is deliberately not reused: a receiver that deduplicates on `ZipZap-Delivery` ' +
      'would drop the replay as a duplicate. The payload carries `replayOf` pointing at the original.',
  })
  async replayDelivery(
    @Param('deliveryId') deliveryId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ReplayedDeliveryDto> {
    return this.replay.replay({ merchantId: this.merchantId(request), deliveryId });
  }
}
