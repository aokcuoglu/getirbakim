# Getirbakim design language

## Direction

A search-led auto-parts marketplace for individual vehicle owners, with a separate, denser workspace for professional services and administrators. Adapt Airbnb's clear discovery, rounded surfaces and restrained elevation to technical product information. Use Carbon's flat, structured approach for operational screens. Keep Getirbakim's identity and existing server-side business rules.

References: [Airbnb analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/airbnb/DESIGN.md), [IBM analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/ibm/DESIGN.md), [Carbon data tables](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines). The collection contains third-party analyses; these are inspiration, not official brand specifications.

## Foundations

- Use local Inter at weights 400, 500 and 600. Keep all copy Turkish.
- Primary action: `#0077c7`; hover: `#0063b4`. Text: `#222831`; secondary text: `#626b75`; dividers: `#e5e7eb`; soft canvas: `#f7f8fa`; blue tint: `#eef7fd`.
- Reserve red for errors and warnings, not ordinary product prices. Distinguish stock/status with text as well as color.
- Use a 4px spacing base, commonly 8/12/16/24/32/48/56px. Content caps at 1280px including 32px desktop or 20px mobile gutters.
- Storefront controls: 8px corners. Cards: 12–20px. Segmented search: pill on desktop, rounded stacked fields on mobile. Popovers and purchase summaries get restrained shadows; product cards primarily use borders.
- Administration: 0–4px corners, thin borders, flat surfaces, aligned tabular numbers. Scope its styles to `.admin-workspace` / supplier classes.

## Discovery and commerce

- Make real product-name/brand and product/OEM-code search the main entry point. The search mode must travel with the query; category searches retain their category.
- Vehicle registration is a secondary entry. It saves a preference and does not filter the catalog. Never imply verified vehicle-part compatibility without supporting data.
- Default consumer catalogs to a card grid; service accounts start in list view. Let both switch views. Show name, brand, product code, available OEM, price and stock clearly; progressively disclose long technical descriptions.
- Desktop catalog: filter sidebar plus results. Mobile: collapsible filter group, stacked search and full-width product cards. Preserve URL-based filtering, sorting and pagination.
- Product detail: clear heading, gallery and technical attributes on the left; sticky purchase summary on the right. At 600px and below, the same quantity/purchase form becomes a fixed bottom action bar. Reserve space so it does not obscure the last page content.
- Supplier observations with unconfirmed retail price/stock retain their preparation state and have no purchase form. Do not add invented ratings, offers, delivery dates, photos or compatibility badges.

## Operational workspace and accessibility

- Use compact filter toolbars, legible table headers, alternating rows, restrained hover, right-aligned numbers and sticky headers within scrollable tables. Make horizontal table regions keyboard-focusable.
- Keep existing product, sync and transfer tabs, status messages and server actions. UI styling must not trigger supplier imports.
- Provide visible keyboard focus, semantic search regions and headings, labeled quantities, and native dialog focus/Escape behavior. Keep primary touch controls at least 44px tall.
- Support 320px, 390px, 768px and desktop layouts without document-level horizontal overflow. Respect reduced motion and mobile safe-area insets.

## Implementation map

`src/app/globals.css` owns only the document reset. `src/styles/design-system.css` owns shared controls, tokens, typography, panels and status surfaces; `storefront.css` owns discovery/navigation; `catalog.css` owns catalog cards/filters; `commerce.css` owns detail/cart surfaces; `garage.css` owns the garage page; `admin-workspace.css` owns the admin shell, navigation and shared admin primitives; `supplier-admin.css` and `enrichment-admin.css` own their pages' specific surfaces. Import admin styles from its nested layout, keep route styles scoped, and verify production CSS order as well as development rendering. Feature components live under `components/auth`, `garage`, `navigation` and `privacy`; `components/ui` contains reusable controls and icons.

Shared chrome is component-based: `components/layout/site-header.tsx` (`<SiteHeader />`) and `service-strip.tsx` are rendered once by the root layout, so every route — storefront and `/yonetim` — gets the same header. `/yonetim` adds only the workspace navigation (`components/admin/admin-nav.tsx`) in `app/yonetim/layout.tsx`. Build admin pages from `components/admin/ui` (`AdminPage`, `AdminPageHeader`, `AdminPanel`, `AdminColumns`, `StatGrid`/`Stat`, `StatusMessage`, `StatusBadge`, `EmptyState`, `TableRegion`) with `.admin-table`, `.admin-form` and `.admin-inline-form`, not with per-page headings, notices or panel markup. Every admin page and data loader keeps its own `requireAdmin()`: layouts do not re-run on client navigation. Keep header controls at least 44px in both dimensions; at 370px and below the wordmark contracts to make room.

The Trodo measurement notes under `docs/design-reference` are historical asset/layout references, not the current layout specification. Existing local images and fonts remain usable.
