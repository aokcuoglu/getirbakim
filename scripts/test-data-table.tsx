import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";
import { Table, TableBody, TableCell, TableControls, TableHead, TableHeader, TableRow, serverOptionList } from "../src/components/ui/table";
import { sortOrder } from "../src/lib/table-sort";

const rows = (count: number) => Array.from({ length: count }, (_, i) => <TableRow key={i}><TableCell>Ürün {i}</TableCell><TableCell>{i * 10},50 ₺</TableCell><TableCell>x</TableCell></TableRow>);
const table = (count: number) => <Table>
  <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
  <TableBody>{rows(count)}</TableBody>
</Table>;

test("tables outside the admin render as stock shadcn tables", () => {
  const html = renderToString(table(10));
  assert.doesNotMatch(html, /<button|Tabloda ara/);
  assert.match(html, /data-slot="table-container"/);
});

test("admin tables get header sorting and filters, and a search from eight rows", () => {
  const html = renderToString(<TableControls>{table(10)}</TableControls>);
  assert.match(html, /aria-label="Tabloda ara"/);
  assert.match(html, /aria-label="Ürün: A→Z sırala"/);
  assert.match(html, /aria-label="Fiyat filtresi"/);
  // Screen-reader-only headers (action columns) stay plain.
  assert.doesNotMatch(html, /İşlem: A→Z/);
});

test("short admin tables get header controls but no search; tiny ones stay plain", () => {
  const short = renderToString(<TableControls>{table(4)}</TableControls>);
  assert.match(short, /Ürün: A→Z sırala/);
  assert.doesNotMatch(short, /Tabloda ara/);
  assert.doesNotMatch(renderToString(<TableControls>{table(2)}</TableControls>), /<button/);
});

test("controls={false} opts a table out", () => {
  const html = renderToString(<TableControls><Table controls={false}><TableBody>{rows(10)}</TableBody></Table></TableControls>);
  assert.doesNotMatch(html, /<button|Tabloda ara/);
});

test("server sort keys map to trusted SQL only", () => {
  const columns = { name: "p.name", price: "p.price" };
  assert.equal(sortOrder({}, columns, "p.id"), "p.id");
  assert.equal(sortOrder({ sort: "name" }, columns, "p.id"), "p.name ASC NULLS LAST, p.id");
  assert.equal(sortOrder({ sort: "price", dir: "desc" }, columns, "p.id"), "p.price DESC NULLS LAST, p.id");
  assert.equal(sortOrder({ sort: "price", dir: "drop table" }, columns, "p.id"), "p.price ASC NULLS LAST, p.id");
  assert.equal(sortOrder({ sort: "p.id; drop table products" }, columns, "p.id"), "p.id");
  assert.equal(sortOrder({ sort: "toString" }, columns, "p.id"), "p.id");
});

test("long server option lists are searched and cut, keeping the selected options", () => {
  const options = Array.from({ length: 250 }, (_, i) => ({ value: `B${i}`, label: i === 7 ? "Şahin Oto" : `Marka ${i}` }));
  const all = serverOptionList(options, [], "");
  assert.equal(all.list.length, 101);
  assert.equal(all.list[0].label, "Tümü");
  assert.equal(all.more, 150);
  const kept = serverOptionList(options, ["B240", "B3", "B245"], "");
  assert.deepEqual(kept.list.slice(0, 3).map(option => option.value), ["", "B240", "B245"]);
  assert.equal(kept.list.length, 103);
  // Turkish letters and case fold the same way as the client filters.
  const found = serverOptionList(options, [], "SAHIN");
  assert.deepEqual(found.list.map(option => option.value), ["", "B7"]);
  assert.equal(serverOptionList(options, [], "yok").matches, 0);
});
