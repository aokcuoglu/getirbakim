import assert from "node:assert/strict";
import { test } from "node:test";
import { isRepxpertBlock, parseRepxpertVehicle, repxpertVehiclePath } from "../src/modules/store/vehicle-repxpert";

// Trimmed REPXPERT response for TA-125157 (image URLs shortened; real ones are signed tokens).
const stelvio = {
  bodyType: "SUV", constructionYearFrom: "12.2016", cylinders: 4, displacementCCM: 1995, driveType: "Tüm tekerlekleri çekişli",
  engineCodes: ["552 73 835", "EC2", "EC2"], enginePowerHP: 280, enginePowerKW: 206, engineType: "Otto", externalID: "125157",
  fuelMixtureFormation: "Doğrudan püskürtme", fuelType: "Benzin", fullName: "ALFA ROMEO STELVIO (949_) 2.0 Q4 (949.AXA2A)",
  imageMap: { entry: [{ key: "100", value: "https://www.repxpert.com.tr/ta-vehicle-image/w100" }, { key: "800", value: "https://www.repxpert.com.tr/ta-vehicle-image/w800" },
    { key: "400", value: "https://example.com/w400" }] },
  kbaNumbers: ["1742ACG", "1742ABJ"], name: "2.0 Q4 (949.AXA2A)", referenceNumber: 125157, uuid: "TA-125157", valves: 4,
};

test("a vehicle type response becomes specs with the largest REPXPERT picture", () => {
  assert.deepEqual(parseRepxpertVehicle(stelvio, 125157), {
    fullName: "ALFA ROMEO STELVIO (949_) 2.0 Q4 (949.AXA2A)", bodyType: "SUV", driveType: "Tüm tekerlekleri çekişli", engineType: "Otto",
    fuelMixture: "Doğrudan püskürtme", cylinders: 4, valves: 4, engineCodes: ["552 73 835", "EC2"], kbaNumbers: ["1742ACG", "1742ABJ"],
    imageUrl: "https://www.repxpert.com.tr/ta-vehicle-image/w800",
  });
});

test("missing fields stay empty and another type's response is rejected", () => {
  const bare = parseRepxpertVehicle({ uuid: "TA-7", cylinders: 0, engineCodes: [" "] }, 7);
  assert.equal(bare.imageUrl, null);
  assert.equal(bare.cylinders, null);
  assert.deepEqual(bare.engineCodes, []);
  assert.throws(() => parseRepxpertVehicle(stelvio, 7));
  assert.throws(() => parseRepxpertVehicle(null, 7));
});

test("the request path and Akamai block detection", () => {
  assert.equal(repxpertVehiclePath(125157), "/api/Repxpert-TR/linkageTargets/vehicle/TA-125157?fields=FULL&lang=tr&curr=RXP&catalogCountry=TR");
  assert.equal(isRepxpertBlock(403, ""), true);
  assert.equal(isRepxpertBlock(200, "<title>Access denied</title>"), true);
  assert.equal(isRepxpertBlock(200, JSON.stringify(stelvio)), false);
});
