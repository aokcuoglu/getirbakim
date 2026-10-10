import test from "node:test";
import assert from "node:assert/strict";
import { fitmentLevel } from "../src/modules/store/fitment-level";

const linked = [{ vehicleTypeId: 10, modelId: 1 }, { vehicleTypeId: 20, modelId: 2 }];

test("without a garage vehicle the line records that none was chosen", () => {
  assert.equal(fitmentLevel(null, linked), "no_vehicle");
});
test("a product without vehicle data is unknown, never a mismatch", () => {
  assert.equal(fitmentLevel({ typeId: "10", modelId: "1" }, []), "unknown");
});
test("only a link to the selected engine type is guaranteed", () => {
  assert.equal(fitmentLevel({ typeId: "10", modelId: "1" }, linked), "guaranteed");
  assert.equal(fitmentLevel({ typeId: "11", modelId: "1" }, linked), "likely");
});
test("mismatch requires every source row to be linked", () => {
  assert.equal(fitmentLevel({ typeId: "30", modelId: "3" }, linked), "mismatch");
  assert.equal(fitmentLevel({ typeId: "30", modelId: "3" }, [...linked, { vehicleTypeId: null, modelId: null }]), "unknown");
});
test("a free-text garage vehicle without a catalog type cannot be judged", () => {
  assert.equal(fitmentLevel({ typeId: null, modelId: null }, linked), "unknown");
});
