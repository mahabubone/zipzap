/**
 * Rider-status validator for offline-sync command queues (Phase 5 rung 4).
 *
 * Compares the aggregate's current status against the `expected_state` the rider recorded at
 * enqueue time. A mismatch is a recorded rejection with a human-readable reason — never a
 * silent drop. Command types that carry no `status` expectation in their `expected_state` are
 * unconditional: the device is asking only to know "did it land?" and the server answers yes.
 */

import { EntityManager } from 'typeorm';
import type { PendingCommandRow } from './command-queue.repository.ts';
import { RiderEntity } from './rider.entity.ts';

interface RiderStatusExpectation {
  status: string;
}

export const RIDER_STATUS_VALIDATOR = async (
  manager: EntityManager,
  command: PendingCommandRow,
): Promise<{ valid: boolean; reason?: string }> => {
  const exp = (command.expected_state as RiderStatusExpectation | undefined)?.status;
  if (!exp) {
    return { valid: true };
  }
  const rider = await manager.getRepository(RiderEntity).findOneBy({ id: command.rider_id });
  if (!rider) {
    return { valid: false, reason: 'rider not found' };
  }
  if (rider.status !== exp) {
    return { valid: false, reason: `expected status ${exp}, rider is ${rider.status}` };
  }
  return { valid: true };
};
