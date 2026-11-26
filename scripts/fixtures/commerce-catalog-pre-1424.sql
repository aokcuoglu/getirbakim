-- commerce_catalog's body before #1424, frozen: the oracle scripts/test-unavailable-catalog.ts compares the split views
-- (commerce_supplier_catalog under commerce_catalog, db/commerce.sql) against, row for row and listing for listing.
-- One WITH ... UNION ALL view: the planner neither flattened it nor dropped its unused columns. Not applied by setup.
-- When the catalog's rules change on purpose, update this copy with them or delete the tests that read it.
-- The latest succeeded import per supplier and company: supplier_latest_imports (db/schema.sql, #1158, #1169).
WITH latest AS (
 SELECT supplier,company,currencies_data,completed_at FROM supplier_latest_imports
), rates AS (
 SELECT supplier,company,completed_at,r->>'dovizCinsi' AS currency,(r->>'satis')::numeric AS rate
 FROM latest CROSS JOIN LATERAL jsonb_array_elements(currencies_data->'dovizListesi') r
), supplier_prices AS (
 SELECT i.*,COALESCE(p.markup_percent,s.markup_percent) AS markup_percent,
 COALESCE(p.vat_percent,s.vat_percent) AS vat_percent,s.max_age_hours,s.basbug_checkout_mode,
 commerce_source_fresh(i.supplier,i.last_seen_at,s.max_age_hours,sc.commerce_enabled,sc.commerce_stale_minutes,sc.last_success_at,sc.stale_minutes,now()) AS source_fresh,
 CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN 1::numeric ELSE r.rate END AS exchange_rate,
 CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN i.last_seen_at ELSE r.completed_at END AS rate_at,
 (i.price_data->>'nf')::numeric AS cost,ov.name AS override_name,ov.description AS override_description,
 ov.price_kurus AS override_price,ov.sale_until,ov.brand AS override_brand,ov.part_number AS override_part_number,
 ov.hide_oem AS override_hide_oem,mb.name AS master_brand,
 -- The campaign price only inside its window; a NULL end is open.
 commerce_campaign_price(ov.sale_price_kurus,ov.sale_from,ov.sale_until,now()) AS sale_price,
 -- Rows with an admin price are few; every other row takes the formula's branches below and pays for it once.
 (ov.price_kurus IS NOT NULL OR ov.sale_price_kurus IS NOT NULL) AS admin_priced,
 -- An open price anomaly (#1030, #1050, supplier_price_anomalies above) keeps the row unpriced.
 (pa.supplier_item_id IS NOT NULL) AS price_anomaly
 FROM commerce_supplier_items i CROSS JOIN commerce_settings s
 LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=i.id
 LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=i.id
 LEFT JOIN supplier_brands sb ON sb.supplier=i.supplier AND sb.label=supplier_item_brand(i.supplier,i.product_data)
 LEFT JOIN brands mb ON mb.id=sb.brand_id
 LEFT JOIN supplier_sync_scopes sc ON sc.supplier=i.supplier AND sc.company=i.company AND sc.list_group=i.list_group AND sc.warehouse=i.warehouse
 LEFT JOIN rates r ON r.supplier=i.supplier AND r.company=i.company AND r.currency=i.product_data->>'dc'
 LEFT JOIN supplier_price_anomalies pa ON pa.supplier_item_id=i.id AND pa.status='open'
 WHERE ov.hidden IS NOT TRUE
), priced AS (
 -- The formula price (auto_price) is the only gate: an admin price never sells a row the formula cannot price.
 SELECT *,CASE WHEN cost>0 AND exchange_rate>0 AND NOT price_anomaly
 AND (basbug_checkout_mode='snapshot' OR ((supplier='manual' OR rate_at>now()-make_interval(hours=>max_age_hours)) AND source_fresh))
 THEN commerce_formula_price(cost,exchange_rate,markup_percent,vat_percent) END AS auto_price
 FROM supplier_prices
), sold AS (
 -- The price rules live in the commerce_*_price functions above; livePriceChanges (src/modules/store/supplier-checkout.ts,
 -- #861) calls the same functions (#882). These CTEs are inlined, so each column below is its expression wherever it
 -- is used: auto_price is evaluated in CASE branches only, the formula's branch first, so a row without an admin
 -- price computes it exactly once (as before #580). Rows with one recompute it a few times. The NOT admin_priced
 -- branches only save time (the functions give the same result for a NULL fixed and campaign price); keep
 -- commerce_regular_price/commerce_final_price behind them: they are not inlined (auto_price is used twice), and
 -- calling them on every row made full scans ~15% slower when measured (#882).
 SELECT *,CASE WHEN NOT admin_priced THEN NULL ELSE commerce_regular_price(auto_price,override_price) END AS regular_price
 FROM priced
), final AS (
 SELECT *,CASE WHEN NOT admin_priced THEN auto_price ELSE commerce_final_price(regular_price,sale_price) END AS final_price,
 CASE WHEN NOT admin_priced THEN false ELSE COALESCE(regular_price IS NOT NULL AND sale_price<regular_price,false) END AS on_sale,
 CASE WHEN NOT admin_priced THEN false ELSE regular_price IS NOT NULL AND (override_price IS NOT NULL OR COALESCE(sale_price<regular_price,false)) END AS overridden,
 jsonb_build_object('source','supplier','nf',cost,'currency',product_data->>'dc','exchange_rate',exchange_rate,
 'rate_at',rate_at,'markup_percent',markup_percent,'vat_percent',vat_percent,'stock',stock_data,'observed_at',last_seen_at,
 'checkout_mode',basbug_checkout_mode,'source_fresh',source_fresh,'company',company,'list_group',list_group,'warehouse',warehouse,
 'cost_kurus',round(cost*exchange_rate*100)) AS formula_snapshot
 FROM sold
)
SELECT id,category,supplier,code,name,brand,description,price_kurus,stock,updated_at,
 ''::text AS oem,'store'::text AS source,''::text AS company,
 stock>0 AS available,LEAST(stock,99) AS max_quantity,
 commerce_store_stock_label(stock) AS stock_label,
 jsonb_build_object('source','store','base_price_kurus',price_kurus) AS pricing_snapshot,
 brand AS display_brand,code AS display_code,false AS name_overridden,brand AS brand_label
FROM store_products
UNION ALL
SELECT id,NULLIF(product_data->>'category',''),supplier,code,
 COALESCE(override_name,NULLIF(product_data->>'ac',''),code),COALESCE(NULLIF(product_data->>'uk',''),'Belirtilmemiş'),
 COALESCE(override_description,product_data->>'ac2',''),
 final_price,
 NULL::integer,changed_at,CASE WHEN override_hide_oem THEN '' ELSE COALESCE(product_data->>'oe','') END,'supplier',company,
 commerce_supplier_available(basbug_checkout_mode,source_fresh,stock_data),
 99,
 commerce_supplier_stock_label(basbug_checkout_mode,source_fresh,stock_data),
 -- docs/commerce.md: price_kind fixed (the admin's price) or sale (the campaign; list_price_kurus is the price it replaces).
 CASE WHEN NOT overridden THEN formula_snapshot ELSE formula_snapshot
  || jsonb_build_object('source','override','price_kind',CASE WHEN on_sale THEN 'sale' ELSE 'fixed' END,'auto_price_kurus',auto_price)
  || CASE WHEN override_price IS NOT NULL THEN jsonb_build_object('fixed_price_kurus',override_price) ELSE '{}'::jsonb END
  || CASE WHEN on_sale THEN jsonb_build_object('list_price_kurus',regular_price,'sale_until',sale_until) ELSE '{}'::jsonb END
 END,
 COALESCE(override_brand,master_brand,NULLIF(product_data->>'uk',''),'Belirtilmemiş'),COALESCE(override_part_number,code),
 override_name IS NOT NULL,supplier_item_brand(supplier,product_data)
FROM final;
