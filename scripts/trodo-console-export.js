// Run in the developer console of an open Trodo product page.
// Only public product components are read; no account/session state is exported.
(() => {
  const sections = ["product-details", "compatible-vehicles", "oe-numbers"];
  const vehicleComponent = document.getElementById("compatible-vehicles")?.__vue__;
  const oeComponent = document.getElementById("oe-numbers")?.__vue__;
  const product = vehicleComponent?.$props?.product ?? oeComponent?.$props?.product;
  if (!product || !oeComponent) {
    throw new Error("Product components are unavailable. Open a product page and wait for it to load.");
  }
  const snapshot = {
    source: location.href,
    capturedAt: new Date().toISOString(),
    product,
    oeNumbers: oeComponent.productOeNumbers,
    vehicleTree: vehicleComponent?.productVehicleList,
    // Engine rows reflect currently loaded/expanded groups, not all vehicle IDs.
    sections: Object.fromEntries(sections.map(id => {
      const element = document.getElementById(id);
      return [id, element ? { text: element.innerText, html: element.outerHTML } : null];
    })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `trodo-${String(product.tecdoc_sku ?? product.entity_id).replace(/[^a-z0-9-]/gi, "")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "Public product snapshot downloaded. Verify expanded engine groups before importing as complete.";
})();
