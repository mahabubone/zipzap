/**
 * Shared pagination DTOs for cursor-paginated endpoints.
 */

import { ApiProperty } from '@nestjs/swagger';

export class CursorPaginationDto {
  @ApiProperty({
    example: 'eyJsYXN0SWQiOiIxMjMifQ==',
    nullable: true,
    description: 'Opaque cursor for the next page; null on the last page',
  })
  nextCursor!: string | null;

  @ApiProperty({ example: false, description: 'True when more rows exist past this page' })
  hasMore!: boolean;
}
