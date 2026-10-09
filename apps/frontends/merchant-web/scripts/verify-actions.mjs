/**
 * Action availability, asserted without a test framework — same convention as
 * verify-phone.mjs and verify-client.mjs.
 *
 * The point is not that the buttons are pretty. It is that the console never offers an
 * action the state machine will refuse: a "Hold" button on a parcel that has not left the
 * building costs a merchant a failed request and a support ticket. And these constants are
 * a COPY of the backend transition table, so drift is the real risk.
 *
 * Run: node apps/frontends/merchant-web/scripts/verify-actions.mjs
 */
import { actionsFor, anyActionAvailable } from '../src/lib/actions.ts';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${
      ok ? '' : `\n        got ${JSON.stringify(actual)}  want ${JSON.stringify(expected)}`
    }`,
  );
}

// Read straight off TRANSITIONS in apps/backend/src/modules/shipment/rules/state-machine.ts.
const HOLDS_FROM = ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'RETRY_SCHEDULED'];
const CANCELS_FROM = ['DRAFT', 'CREATED', 'PICKUP_REQUESTED', 'PICKUP_ASSIGNED'];
const EXCEPTIONS_FROM = [
  'PICKED_UP',
  'AT_ORIGIN_HUB',
  'SORTING',
  'DISPATCHED',
  'IN_TRANSIT',
  'AT_DESTINATION_HUB',
];

// --- hold: three states, and never before delivery is attempted -------------------
for (const status of HOLDS_FROM) {
  check(`hold available from ${status}`, actionsFor(status).canHold, true);
}
for (const status of ['CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']) {
  check(`hold refused from ${status}`, actionsFor(status).canHold, false);
}

// --- release: only from ON_HOLD ---------------------------------------------------
check('release available from ON_HOLD', actionsFor('ON_HOLD').canRelease, true);
for (const status of ['CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']) {
  check(`release refused from ${status}`, actionsFor(status).canRelease, false);
}

// --- cancel: only before the parcel moves ------------------------------------------
for (const status of CANCELS_FROM) {
  check(`cancel available from ${status}`, actionsFor(status).canCancel, true);
}
for (const status of ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']) {
  check(`cancel refused from ${status}`, actionsFor(status).canCancel, false);
}

// --- exceptions: in the network only -----------------------------------------------
for (const status of EXCEPTIONS_FROM) {
  check(`exception available from ${status}`, actionsFor(status).canReportException, true);
}
for (const status of ['CREATED', 'DELIVERED', 'CANCELLED', 'RETURNED']) {
  check(`exception refused from ${status}`, actionsFor(status).canReportException, false);
}

// --- LOST is IN_TRANSIT only; nothing is lost while still in the building ----------
check('LOST allowed in transit', actionsFor('IN_TRANSIT').canReportLost, true);
for (const status of ['CREATED', 'PICKED_UP', 'SORTING', 'OUT_FOR_DELIVERY']) {
  check(`LOST refused from ${status}`, actionsFor(status).canReportLost, false);
}

// --- DAMAGED is found at sort or in the network ------------------------------------
check('DAMAGED allowed while sorting', actionsFor('SORTING').canReportDamaged, true);
check('DAMAGED allowed in transit', actionsFor('IN_TRANSIT').canReportDamaged, true);
check('DAMAGED refused out for delivery', actionsFor('OUT_FOR_DELIVERY').canReportDamaged, false);

// --- terminal states offer nothing at all ------------------------------------------
for (const status of ['CANCELLED', 'RETURNED']) {
  check(`no action offered on ${status}`, anyActionAvailable(actionsFor(status)), false);
}

// --- an unknown status must offer nothing, not everything --------------------------
// Default-allow here would show a Cancel button on a state this build has never heard of.
const unknown = actionsFor('SOME_FUTURE_STATE');
check('unknown status offers no cancel', unknown.canCancel, false);
check('unknown status offers no hold', unknown.canHold, false);
check('unknown status offers nothing', anyActionAvailable(unknown), false);

console.log(failures === 0 ? '\naction availability ok' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
