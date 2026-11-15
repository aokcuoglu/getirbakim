import assert from "node:assert/strict";
import { test } from "node:test";
import { headerCategoryLinks, packCategoryTree, sidebarCategoryBranch, unpackCategoryTree, type StoreCategory } from "../src/modules/store/category-tree";

// The category tree the header menu and sidebar load from /api/categories instead of every page's HTML (#642).

const node = (id: number, parentId: number | null, path: number[], position: number, media?: string): StoreCategory =>
  ({ id, parentId, name: `Kategori ${id}`, slug: `kategori-${id}`, path, position, imagePath: media ? `/api/category-media/${media}` : null });
const tree: StoreCategory[] = [
  node(3, null, [3], 0, "a1"),
  node(252, 3, [3, 252], 1, "b2"),
  node(269, 252, [3, 252, 269], 2),
  node(270, 252, [3, 252, 270], 3, "c3"),
  node(606, 3, [3, 606], 4),
  node(956, null, [956], 5, "d4"),
  node(957, 956, [956, 957], 6),
];

test("pack and unpack keep order, path and images", () => {
  const packed = packCategoryTree(tree);
  assert.deepEqual(packed[2], [269, 252, "Kategori 269", "kategori-269", null]);
  assert.deepEqual(packed[0], [3, null, "Kategori 3", "kategori-3", "a1"]);
  assert.deepEqual(unpackCategoryTree(JSON.parse(JSON.stringify(packed))), tree);
});

test("unpacking rebuilds the path when a child comes before its parent", () => {
  const [child, parent] = unpackCategoryTree([[269, 252, "Diskler", "diskler", null], [252, null, "Fren", "fren", "x"]]);
  assert.deepEqual(child.path, [252, 269]);
  assert.deepEqual(parent.path, [252]);
  assert.equal(parent.imagePath, "/api/category-media/x");
});

test("header links follow the featured order, skip missing ids and say which have children", () => {
  assert.deepEqual(headerCategoryLinks(tree), [
    { id: 3, name: "Kategori 3", slug: "kategori-3", hasChildren: true },
    { id: 956, name: "Kategori 956", slug: "kategori-956", hasChildren: true },
  ]);
  assert.deepEqual(headerCategoryLinks([node(607, 606, [3, 606, 607], 0)]), [{ id: 607, name: "Kategori 607", slug: "kategori-607", hasChildren: false }]);
});

test("sidebar branch: top level, children, siblings of a leaf, unknown slug", () => {
  const ids = (slug?: string) => sidebarCategoryBranch(tree, slug).nodes.map(n => n.id);
  // Without a category: the children of "Yedek parça" (3), then the other roots.
  assert.deepEqual(ids(), [252, 606, 956]);
  assert.equal(sidebarCategoryBranch(tree).parent, null);
  assert.deepEqual(ids("kategori-252"), [269, 270]);
  assert.deepEqual(sidebarCategoryBranch(tree, "kategori-252").parent, { name: "Kategori 3", slug: "kategori-3" });
  assert.deepEqual(ids("kategori-269"), [269, 270]);
  assert.deepEqual(sidebarCategoryBranch(tree, "kategori-269").parent, { name: "Kategori 252", slug: "kategori-252" });
  assert.deepEqual(sidebarCategoryBranch(tree, "kategori-252").nodes[0], { id: 269, name: "Kategori 269", slug: "kategori-269", hasChildren: false });
  assert.deepEqual(ids("yok"), [252, 606, 956]);
  assert.equal(sidebarCategoryBranch(tree, "kategori-3").nodes.find(n => n.id === 252)?.hasChildren, true);
});
