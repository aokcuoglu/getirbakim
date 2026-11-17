import test from "node:test";
import assert from "node:assert/strict";
import { fitmentLevel } from "../src/modules/store/fitment-level";
import { vehicleNotListed } from "../src/modules/store/fitment-notice";

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
test("a type an admin removed from the product is a mismatch, whatever the rows say", () => {
  assert.equal(fitmentLevel({ typeId: "10", modelId: "1" }, [{ vehicleTypeId: 20, modelId: 1 }], [10]), "mismatch");
  assert.equal(fitmentLevel({ typeId: "10", modelId: "1" }, [], [10]), "mismatch");
  assert.equal(fitmentLevel({ typeId: "10", modelId: "1" }, [{ vehicleTypeId: null, modelId: null }], [10]), "mismatch");
  assert.equal(fitmentLevel({ typeId: "11", modelId: "1" }, linked, [10]), "likely");
});

const catalogVehicle = { typeId: "10", modelId: "1" };
const notListedInput = { level: "unknown" as const, vehicle: catalogVehicle, vehicleMake: "VOLKSWAGEN", listed: 19, unlinkedMakes: ["LADA"] };
test("a catalog vehicle whose make has no unlinked rows is not listed", () => {
  assert.equal(vehicleNotListed(notListedInput), true);
});
test("an unlinked row of the vehicle's make keeps the notice at unverified", () => {
  assert.equal(vehicleNotListed({ ...notListedInput, unlinkedMakes: ["LADA", "VOLKSWAGEN"] }), false);
  assert.equal(vehicleNotListed({ ...notListedInput, vehicleMake: "Volkswagen", unlinkedMakes: ["VOLKSWAGEN"] }), false);
});
test("a product listing no vehicles says nothing about the garage vehicle", () => {
  assert.equal(vehicleNotListed({ ...notListedInput, listed: 0 }), false);
});
test("a vehicle without a catalog type or model cannot be judged", () => {
  assert.equal(vehicleNotListed({ ...notListedInput, vehicle: { typeId: null, modelId: null } }), false);
  assert.equal(vehicleNotListed({ ...notListedInput, vehicle: { typeId: "10", modelId: null } }), false);
  assert.equal(vehicleNotListed({ ...notListedInput, vehicle: null }), false);
});
test("only the unknown level can become not listed", () => {
  for (const level of ["mismatch", "likely", "guaranteed", "no_vehicle", null] as const) assert.equal(vehicleNotListed({ ...notListedInput, level }), false);
});
