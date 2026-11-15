import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";

// Garage selection rules (#691) in an isolated schema; cookies are an in-memory jar standing in for the Server Action request.
const cookieStore = new Map<string, string>();
const jar = {
  get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
  set: (name: string, value: string) => { cookieStore.set(name, value); },
  delete: (name: string) => { cookieStore.delete(name); },
};
mock.module("next/headers", { namedExports: { cookies: async () => jar, headers: async () => new Headers() } });
mock.module("next/navigation", { namedExports: { redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); } } });

let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let garage: typeof import("../src/modules/store/garage");
let actions: typeof import("../src/app/(store)/garaj/actions");
let closeDb: () => Promise<void>;
let accountId = "";

const car = (model: string, year = 2016, vehicleId?: string) => ({ make: "Volkswagen", model, year, ...(vehicleId ? { vehicleId } : {}) });
const keys = async () => (await garage.savedVehicles()).vehicles.map(v => v.key);
const activeKey = async () => { const v = await garage.currentVehicle(); return v ? garage.vehicleKey(v) : null; };
const signIn = async () => {
  const { createHash } = await import("node:crypto");
  const token = randomUUID();
  await schema.pool.query("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [createHash("sha256").update(token).digest("hex"), accountId]);
  cookieStore.set("gb_session", token);
};

before(async () => {
  schema = await isolatedSchema("garage_test");
  accountId = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('T','garage@example.invalid','x','service',true) RETURNING id`)).rows[0].id;
  const [{ db }, g, a] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/garage"), import("../src/app/(store)/garaj/actions")]);
  garage = g; actions = a; closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });
beforeEach(async () => { cookieStore.clear(); await schema.pool.query("DELETE FROM account_vehicles"); });

for (const mode of ["guest", "account"] as const) {
  const limit = () => (mode === "guest" ? garage.GUEST_LIMIT : garage.ACCOUNT_LIMIT);
  const start = () => (mode === "account" ? signIn() : Promise.resolve());

  test(`${mode}: picking A then B keeps both, B is active`, async () => {
    await start();
    await garage.chooseVehicle(car("A")); await garage.chooseVehicle(car("B"));
    assert.deepEqual(await keys(), [garage.vehicleKey(car("B")), garage.vehicleKey(car("A"))]);
    assert.equal(await activeKey(), garage.vehicleKey(car("B")));
  });

  test(`${mode}: an active vehicle the list never held is kept when another is picked`, async () => {
    await start();
    cookieStore.set("gb_vehicle", JSON.stringify(car("Legacy")));
    await garage.chooseVehicle(car("B"));
    assert.deepEqual(await keys(), [garage.vehicleKey(car("B")), garage.vehicleKey(car("Legacy"))]);
    assert.equal(await activeKey(), garage.vehicleKey(car("B")));
  });

  test(`${mode}: picking A again does not duplicate and makes A the most recent`, async () => {
    await start();
    await garage.chooseVehicle(car("A")); await garage.chooseVehicle(car("B")); await garage.chooseVehicle(car("A"));
    assert.deepEqual(await keys(), [garage.vehicleKey(car("A")), garage.vehicleKey(car("B"))]);
    assert.equal(await activeKey(), garage.vehicleKey(car("A")));
  });

  test(`${mode}: at the limit the least recently used vehicle drops`, async () => {
    await start();
    const all = Array.from({ length: limit() + 1 }, (_, i) => car(`M${i}`));
    for (const v of all.slice(0, limit())) await garage.chooseVehicle(v);
    await garage.chooseVehicle(all[0]); // M0 used again, so M1 is now the oldest
    await garage.chooseVehicle(all[limit()]);
    const saved = await keys();
    assert.equal(saved.length, limit());
    assert.ok(!saved.includes(garage.vehicleKey(all[1])), "M1 was least recently used");
    assert.ok(saved.includes(garage.vehicleKey(all[0])));
    assert.equal(saved[0], garage.vehicleKey(all[limit()]));
  });

  test(`${mode}: editing the active vehicle in /garaj replaces only that vehicle`, async () => {
    await start();
    await garage.chooseVehicle(car("A")); await garage.chooseVehicle(car("B")); await garage.chooseVehicle(car("C"));
    const form = new FormData(); form.set("make", "Volkswagen"); form.set("model", "C2"); form.set("year", "2016");
    await assert.rejects(actions.saveVehicle(form), /NEXT_REDIRECT/);
    assert.deepEqual(await keys(), [garage.vehicleKey(car("C2")), garage.vehicleKey(car("B")), garage.vehicleKey(car("A"))]);
    assert.equal(await activeKey(), garage.vehicleKey(car("C2")));
  });
}

test("guest garage moves to the account on sign-in without losing the picks", async () => {
  await garage.chooseVehicle(car("A")); await garage.chooseVehicle(car("B"));
  await garage.adoptGuestGarage(accountId);
  await signIn();
  assert.deepEqual(await keys(), [garage.vehicleKey(car("B")), garage.vehicleKey(car("A"))]);
});
