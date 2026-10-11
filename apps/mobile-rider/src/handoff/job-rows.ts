/**
 * Projecting a server job feed into rows.
 *
 * Pure, by AGENTS.md's rule 3 — no React Native, no Expo. It sits here rather than in
 * `screens/JobsScreen.tsx` so the mapping can be tested without a renderer, and the screens stay
 * views. Three callers import it: the jobs feed, the home feed, and the route that resolves a
 * `{ jobId }` back into a row.
 *
 * The handoff is what this exists for. Before R6 the delivery job carried a shipment id and nothing
 * else, so a rider was asked to collect cash without being told how much and to call somebody whose
 * number never reached the device.
 */

/** What the rider needs to know about the parcel. */
export interface ShipmentHandoff {
  /** Integer poisha. Zero means prepaid: there is nothing to take. */
  readonly codAmountMinor: number;
  readonly codCurrency: string;
  readonly recipientPhone: string | null;
  readonly recipientName: string | null;
  readonly recipientAddress: string | null;
}

export interface JobRow {
  readonly key: string;
  readonly kind: 'pickup' | 'delivery';
  readonly id: string;
  readonly shipmentId: string | null;
  readonly title: string;
  readonly status: string;
  readonly detail: string;
  readonly createdAt: string;
  /**
   * What to collect and who to call, on a delivery job.
   *
   * Null when the parcel is gone — cancelled while the rider was offline — and on pickups, which
   * have no customer. The job screen says so rather than inventing a number.
   */
  readonly shipment: ShipmentHandoff | null;
}

/**
 * The jobs query's cached value, as the raw server response.
 *
 * `GET /v1/riders/:riderId/jobs` sends both handoff halves, and `shipment` may be null: a job on
 * the van whose parcel was cancelled while the phone was in a pocket.
 */
export interface RiderJobs {
  readonly pickups: ReadonlyArray<{
    id: string;
    shipmentIds: readonly string[];
    status: string;
    totalWeightGrams: number;
    createdAt: string;
  }>;
  readonly deliveries: ReadonlyArray<{
    id: string;
    shipmentId: string;
    status: string;
    attemptsMade: number;
    lastFailureReason: string | null;
    createdAt: string;
    shipment?: ShipmentHandoff | null;
  }>;
}

/** Projects the query into rows. Defensive about server shape, since a projection is a boundary. */
export function toJobRows(data: RiderJobs | undefined): JobRow[] {
  if (!data || !Array.isArray(data.pickups) || !Array.isArray(data.deliveries)) return [];

  const pickups: JobRow[] = data.pickups.map((p) => ({
    key: `pickup-${p.id}`,
    kind: 'pickup',
    id: p.id,
    shipmentId: p.shipmentIds[0] ?? null,
    title: `Pickup ${p.shipmentIds.length} ${p.shipmentIds.length === 1 ? 'parcel' : 'parcels'}`,
    status: p.status,
    detail: `${(p.totalWeightGrams ?? 0).toLocaleString()}g · ${p.shipmentIds.length} shipment${
      p.shipmentIds.length === 1 ? '' : 's'
    }`,
    createdAt: p.createdAt,
    // A pickup has no customer and nothing to collect: the rider takes the parcels from a shop.
    shipment: null,
  }));

  const deliveries: JobRow[] = data.deliveries.map((d) => ({
    key: `delivery-${d.id}`,
    kind: 'delivery',
    id: d.id,
    shipmentId: d.shipmentId,
    title: `Delivery ${shortId(d.shipmentId)}`,
    status: d.status,
    detail:
      d.attemptsMade > 0
        ? `Attempt ${d.attemptsMade}${d.lastFailureReason ? ` · ${d.lastFailureReason}` : ''}`
        : 'Not yet attempted',
    createdAt: d.createdAt,
    shipment: d.shipment ?? null,
  }));

  // Newest first across both kinds — the order the server already
  // returns each list in, merged by timestamp.
  return [...pickups, ...deliveries].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
