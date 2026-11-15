// A product's categories are the enrichment (Trodo) categories of its supplier rows, labelled in Turkish.
export const productCategoriesSql = `SELECT s.product_id, pc.category_id, l.name FROM product_source_categories pc
  JOIN product_sources s ON s.supplier_item_id=pc.supplier_item_id
  JOIN source_category_labels l ON l.source=pc.source AND l.category_id=pc.category_id AND l.locale='tr' WHERE pc.source='trodo'`;
