/**
 * Hub repository. Joins the caller's transaction — it must never open its own.
 *
 * The hub schema is the hub module's own; the `hubs` table was created with raw SQL
 * (migration 0025), and the hub module deliberately holds no TypeORM entity for it,
 * so counts are expressed as direct queries on `hub.hubs`.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';

@Injectable()
export class HubRepository {
  /** All hubs registered in the network. */
  countHubs(manager: EntityManager): Promise<number> {
    return manager
      .query('SELECT COUNT(*) AS count FROM hub.hubs')
      .then((rows: any[]) => Number(rows[0].count));
  }

  /** Hubs grouped by their kind (e.g. district, regional). */
  countHubsByKind(manager: EntityManager): Promise<Map<string, number>> {
    return manager
      .query('SELECT kind, COUNT(*) AS count FROM hub.hubs GROUP BY kind')
      .then((rows: any[]) => new Map(rows.map((r) => [r.kind, Number(r.count)])));
  }
}
