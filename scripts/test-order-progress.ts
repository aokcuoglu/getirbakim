import assert from "node:assert/strict";
import { test } from "node:test";
import { orderSteps } from "../src/components/order-progress";

const states = (status: string, payment_status: string) => orderSteps({ status, payment_status }).map(step => `${step.key}:${step.state}`);

test("awaiting payment: payment is the current step", () => {
  assert.deepEqual(states("awaiting_payment", "awaiting"), ["placed:done", "payment:current", "confirmation:upcoming", "shipping:upcoming"]);
});
test("paid and pending: confirmation is current", () => {
  assert.deepEqual(states("pending", "paid"), ["placed:done", "payment:done", "confirmation:current", "shipping:upcoming"]);
});
test("unpaid order skips the payment step", () => {
  assert.deepEqual(states("pending", "none"), ["placed:done", "confirmation:current", "shipping:upcoming"]);
});
test("confirmed, shipped, delivered", () => {
  assert.deepEqual(states("confirmed", "paid"), ["placed:done", "payment:done", "confirmation:done", "shipping:current"]);
  assert.deepEqual(states("shipped", "paid"), ["placed:done", "payment:done", "confirmation:done", "shipping:done"]);
  assert.deepEqual(states("delivered", "none"), ["placed:done", "confirmation:done", "shipping:done"]);
});
test("ended orders show no steps", () => {
  for (const [status, payment] of [["cancelled", "cancelled"], ["cancelled", "expired"], ["cancelled", "refund_required"], ["cancelled", "refunded"], ["pending", "refunded"]]) assert.deepEqual(orderSteps({ status, payment_status: payment }), []);
});
