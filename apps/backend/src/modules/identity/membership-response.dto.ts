/**
 * Response DTOs for the members endpoints.
 *
 * `MemberDto` carries a person's membership of one business, which is a narrower thing than the
 * person: the same email can appear under two different merchants with two different roles, and that
 * is what `identity.user_merchants` being a join table buys. So `merchantId` is a field rather than
 * an implicit scope.
 *
 * `lastUsedAt` is always null and is documented as such. It is null because the only thing that could
 * fill it is a read of `merchant.sessions` from the `identity` schema, which rule 2 forbids. A field
 * that lies about being derivable is worse than a field that is honestly null; the alternative — an
 * approximation — is worse still, because a console sorting by it would look correct.
 */

import { ApiProperty } from '@nestjs/swagger';
import type { MerchantGrantableRole } from './rules/membership.ts';

export class MemberDto {
  @ApiProperty({
    example: '9f8e7d6c-5b4a-3210-fedc-ba9876543210',
    description: 'The person, not the membership. One person may hold several memberships.',
  })
  userId!: string;

  @ApiProperty({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'The business this membership is of, taken from the path.',
  })
  merchantId!: string;

  @ApiProperty({ example: 'staff@shop.example', description: 'The login identity, lower-cased.' })
  email!: string;

  @ApiProperty({
    example: 'MERCHANT_OPERATOR',
    enum: ['MERCHANT_OWNER', 'MERCHANT_OPERATOR'],
    description:
      'The role held in THIS business. The same person may be an owner of one and an operator of ' +
      'another — the role lives on the membership, not on the user.',
  })
  role!: MerchantGrantableRole;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Always null today. Filling it would need a read of another schema store, which rule 2 ' +
      'forbids, and an approximation would be worse than an honest null.',
  })
  lastUsedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'When the account was disabled, if it was. Suspension of a person is deliberately separate ' +
      'from the suspension of a merchant: one suspended business must not lock them out of every ' +
      'other one they belong to.',
  })
  disabledAt!: string | null;
}

export class MemberListDto {
  @ApiProperty({ type: MemberDto, isArray: true })
  members!: readonly MemberDto[];
}
