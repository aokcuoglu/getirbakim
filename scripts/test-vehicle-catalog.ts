import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/lib/db";
import { getVehicleBrands, getVehicleModels, getModelVehicles, savedCatalogVehicle, searchVehicleCatalog } from "../src/modules/store/vehicle-catalog.server";
import { readVehicleCatalogImport, parseVehicleCsv } from "../src/modules/store/vehicle-catalog-import";
import { vehicleProductionDates } from "../src/modules/store/vehicle-catalog";
import { vehicleSchema } from "../src/modules/store/garage";
import { GET } from "../src/app/api/vehicles/route";

after(async () => { await db.end(); });
const source = readVehicleCatalogImport();

test("every imported DB field matches its CSV source, with no duplicate or missing IDs", async () => {
  const data = await source;
  const brands = await db.query("SELECT id, name, display_name, popular FROM vehicle_brands ORDER BY id");
  const models = await db.query(`SELECT id, brand_id, name, to_char(date_from, 'YYYY-MM-DD') AS date_from,
    to_char(date_to, 'YYYY-MM-DD') AS date_to FROM vehicle_models ORDER BY id`);
  const vehicles = await db.query(`SELECT id, model_id, name, cc, fuel_type, fuel_name, hp, kwt,
    to_char(year_of_constr_from, 'YYYY-MM-DD') AS year_of_constr_from,
    to_char(year_of_constr_to, 'YYYY-MM-DD') AS year_of_constr_to, search_text FROM vehicle_types ORDER BY id`);
  assert.deepEqual(brands.rows, [...data.brands].sort((a, b) => a.id - b.id));
  assert.deepEqual(models.rows, [...data.models].sort((a, b) => a.id - b.id));
  assert.deepEqual(vehicles.rows, [...data.vehicles].sort((a, b) => a.id - b.id));
  assert.equal(brands.rowCount, 251); assert.equal(models.rowCount, 5767); assert.equal(vehicles.rowCount, 37937);
  for (const vehicle of data.vehicles) {
    const model = data.models.find(m => m.id === vehicle.model_id)!;
    const brand = data.brands.find(b => b.id === model.brand_id)!;
    assert.ok(vehicleSchema.safeParse({ make: brand.display_name, model: model.name,
      year: Number(vehicle.year_of_constr_from?.slice(0, 4)), vehicleId: String(vehicle.id),
      generation: model.name, fuel: vehicle.fuel_name, engine: vehicle.name, power: `${vehicle.hp} hp / ${vehicle.kwt} kW` }).success, `Unsaveable vehicle ${vehicle.id}`);
  }
});

test("CSV quoting, null dates/displacement and DB-backed picker lists are preserved", async () => {
  assert.deepEqual(parseVehicleCsv('id,name\r\n1,"A, B"\r\n2,"A ""B"""\r\n'), [{ id: "1", name: "A, B" }, { id: "2", name: 'A "B"' }]);
  assert.equal((await getVehicleBrands()).filter(b => b.popular).length, 10);
  const models = await getVehicleModels("121");
  assert.equal(models?.find(m => m.id === "1616")?.name, "411,412");
  const vehicles = await getModelVehicles("5598");
  const vehicle = vehicles?.find(v => v.id === "1");
  assert.equal(vehicle?.engine, "1.4 (L08, L68)");
  assert.equal(vehicle?.fuel, "Benzin"); assert.equal(vehicle?.cc, 1364);
  assert.equal(vehicle?.power, "90 hp / 66 kW");
  const electric = (await searchVehicleCatalog("EVX")).vehicles.find(v => v.id === "801659");
  assert.equal(electric?.cc, null); assert.equal(electric?.dateTo, null);
  assert.equal(vehicleProductionDates("2024-01", null), "01.2024 – devam ediyor");
  assert.equal(vehicleProductionDates(null, null), "Başlangıç bilinmiyor – devam ediyor");
});

test("DB search accepts aliases and accents, paginates consistently, and treats SQL wildcards literally", async () => {
  const first = await searchVehicleCatalog("VW Golf dizel");
  const second = await searchVehicleCatalog("VW Golf dizel", 60);
  assert.ok(first.total > 60); assert.equal(first.vehicles.length, 60);
  assert.ok(first.vehicles.every(v => v.make === "VOLKSWAGEN" && v.fuel.includes("Dizel")));
  assert.ok(second.vehicles.every(v => !first.vehicles.some(other => v.id === other.id)));
  const pastEnd = await searchVehicleCatalog("VW Golf dizel", first.total + 1);
  assert.equal(pastEnd.total, first.total); assert.deepEqual(pastEnd.vehicles, []);
  const accented = await searchVehicleCatalog("citroën"), plain = await searchVehicleCatalog("citroen");
  assert.equal(accented.total, plain.total); assert.ok(plain.total > 0);
  assert.equal((await searchVehicleCatalog("nonexistent-vehicle-987654")).total, 0);
  for (const query of ["%", "_", "\\", "' OR TRUE --"]) {
    const expected = (await source).vehicles.filter(v => query.toLowerCase().split(/\s+/).every(term => v.search_text.includes(term))).length;
    assert.equal((await searchVehicleCatalog(query)).total, expected);
  }
});

test("selection resolves a DB TecDoc ID and rejects missing IDs and invalid years", async () => {
  const saved = await savedCatalogVehicle("1", 2010);
  assert.equal(saved?.vehicleId, "1"); assert.equal(saved?.make, "OPEL");
  assert.equal(saved?.engine, "1.4 (L08, L68)");
  assert.equal(await savedCatalogVehicle("1", 2005), null);
  assert.equal(await savedCatalogVehicle("1", 2015), null);
  assert.equal(await savedCatalogVehicle("1", 2010.5), null);
  assert.equal(await savedCatalogVehicle("vw-0-1", 2018), null);
  assert.equal(await savedCatalogVehicle("2147483648", 2018), null);
  const oldest = (await source).vehicles.find(v => v.year_of_constr_from?.startsWith("1932"))!;
  assert.ok(vehicleSchema.safeParse(await savedCatalogVehicle(String(oldest.id), 1932)).success);
});

test("database constraints reject broken relationships and invalid production data", async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const sql of [
      "UPDATE vehicle_types SET model_id=2147483647 WHERE id=1",
      "UPDATE vehicle_models SET brand_id=2147483647 WHERE id=278",
      "UPDATE vehicle_types SET cc=0 WHERE id=1",
      "UPDATE vehicle_types SET year_of_constr_to='1900-01-01' WHERE id=1",
      "UPDATE vehicle_models SET date_from='2020-01-02' WHERE id=278",
    ]) {
      await client.query("SAVEPOINT invalid_data");
      await assert.rejects(client.query(sql));
      await client.query("ROLLBACK TO SAVEPOINT invalid_data");
    }
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("catalog API queries the DB and validates identifiers and pagination", async () => {
  const get = (query = "") => GET(new Request(`http://localhost/api/vehicles${query}`));
  assert.equal((await (await get()).json()).brands.length, 251);
  const models = await (await get("?brandId=121")).json();
  assert.ok(models.models.every((m: { brandId: string }) => m.brandId === "121"));
  assert.ok((await (await get(`?modelId=${models.models[0].id}`)).json()).vehicles.length > 0);
  assert.equal((await (await get("?q=benzin")).json()).vehicles.length, 60);
  assert.equal((await get("?modelId=missing")).status, 404);
  assert.equal((await get("?brandId=2147483648")).status, 404);
  assert.equal((await get("?offset=-1")).status, 400);
  assert.equal((await get("?offset=NaN")).status, 400);
  assert.equal((await get(`?q=${"a".repeat(121)}`)).status, 400);
});
