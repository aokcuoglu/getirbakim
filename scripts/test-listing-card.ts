import assert from "node:assert/strict";
import test from "node:test";
import {cardFitBadge,defaultListingView,stockLabelParts} from "../src/modules/store/listing-card";
import {unconfirmedStockLabel} from "../src/modules/seo/structured-data";

test("a stock label splits into its status and note at the first separator", () => {
  assert.deepEqual(stockLabelParts(unconfirmedStockLabel),{status:"Stokta",note:"Siparişten sonra teyit edilir"});
  assert.deepEqual(stockLabelParts("Tedarikçide mevcut"),{status:"Tedarikçide mevcut"});
  assert.deepEqual(stockLabelParts("A · B · C"),{status:"A",note:"B · C"});
});

test("the fit badge follows the garage vehicle check", () => {
  assert.equal(cardFitBadge({fitsVehicle:true,vehicleSpecific:true,vehicleChecked:true}),"match");
  // Checked against the garage vehicle and not linked to it: no badge rather than a generic one.
  assert.equal(cardFitBadge({fitsVehicle:false,vehicleSpecific:true,vehicleChecked:true}),null);
  assert.equal(cardFitBadge({fitsVehicle:false,vehicleSpecific:true,vehicleChecked:false}),"listed");
  assert.equal(cardFitBadge({fitsVehicle:false,vehicleSpecific:false,vehicleChecked:false}),null);
});

test("approved service accounts start in the list, everyone else in the grid", () => {
  assert.equal(defaultListingView(null),"grid");
  assert.equal(defaultListingView({role:"service",approved:true}),"list");
  assert.equal(defaultListingView({role:"service",approved:false}),"grid");
  assert.equal(defaultListingView({role:"admin",approved:true}),"grid");
});
