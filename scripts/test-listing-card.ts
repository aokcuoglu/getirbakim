import assert from "node:assert/strict";
import test from "node:test";
import {cardFitBadge,defaultListingView,homeCardModel,listingCardModel,stockLabelParts} from "../src/modules/store/listing-card";
import {unconfirmedStockLabel} from "../src/modules/seo/structured-data";
import {money} from "../src/modules/store/money";
import {campaignEndText} from "../src/modules/store/best-offer";
import type {CatalogProduct} from "../src/modules/store/catalog";

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

// #1212: the client card gets finished strings; prices, discount and campaign texts are decided here on the server.
const product=(over:Partial<CatalogProduct>={}):CatalogProduct=>({
 id:"11111111-1111-4111-8111-111111111111",supplier:"dinamik",code:"0 986 452 041",name:"YAĞ FİLTRESİ",brand:"BOSCH",description:"",
 updated_at:new Date("2026-11-01T00:00:00Z"),category:"filtre",price_kurus:100_000,stock:5,oem:"",source:"supplier",available:true,
 max_quantity:5,stock_label:unconfirmedStockLabel,pricing_snapshot:{},display_brand:"BOSCH",display_code:"0 986 452 041",name_overridden:false,
 ...over,
});

test("a consumer sees the price, a service account its discounted price", () => {
  const consumer=listingCardModel({product:product()});
  assert.equal(consumer.price,money(100_000));
  assert.equal(consumer.discounted,false);
  assert.equal(consumer.priceMuted,false);
  assert.equal(consumer.hasPrice,true);
  const service=listingCardModel({product:product(),discountPercent:10});
  assert.equal(service.price,money(90_000));
  assert.equal(service.discounted,true);
  // An approved service account without a discount still sees "Servisine özel fiyat".
  assert.equal(listingCardModel({product:product(),discountPercent:0}).discounted,true);
});

test("a running campaign strikes the regular price through and names its end", () => {
  const sale=product({pricing_snapshot:{price_kind:"sale",list_price_kurus:150_000,sale_until:"2026-12-31T20:59:00Z"}});
  const model=listingCardModel({product:sale,discountPercent:10});
  assert.equal(model.regular,money(135_000));
  assert.equal(model.campaignEnd,campaignEndText(new Date("2026-12-31T20:59:00Z")));
  assert.equal(listingCardModel({product:product()}).regular,undefined);
  assert.ok(!("campaignEnd" in listingCardModel({product:product()})));
});

test("an unavailable product shows its label, no price and no campaign", () => {
  const model=listingCardModel({product:product({unavailable:true,available:false,stock_label:"Şu an tedarik edilemiyor",
    pricing_snapshot:{price_kind:"sale",list_price_kurus:150_000}})});
  assert.equal(model.price,"Şu an tedarik edilemiyor");
  assert.equal(model.unavailable,true);
  assert.equal(model.priceMuted,true);
  assert.equal(model.regular,undefined);
});

test("a product without a price says the price is being updated", () => {
  const model=listingCardModel({product:product({price_kurus:null})});
  assert.equal(model.price,"Fiyat bilgisi güncelleniyor");
  assert.equal(model.priceMuted,true);
  assert.equal(model.hasPrice,false);
});

test("without details the card lists the maker and the OEM number", () => {
  const model=listingCardModel({product:product({oem:"1234567"})});
  assert.deepEqual(model.card.map(row=>row.key),["Üretici","OEM"]);
  assert.deepEqual(listingCardModel({product:product()}).card.map(row=>row.key),["Üretici"]);
  assert.equal(model.fit,null);
  assert.equal(model.stock.status,"Stokta");
});

test("the cart adds the listing's chosen offer, else the product", () => {
  assert.equal(listingCardModel({product:product()}).purchaseId,"11111111-1111-4111-8111-111111111111");
  assert.equal(listingCardModel({product:product({offer_id:"22222222-2222-4222-8222-222222222222"})}).purchaseId,"22222222-2222-4222-8222-222222222222");
});

test("the model is plain data for the client card", () => {
  const model=listingCardModel({product:product({pricing_snapshot:{price_kind:"sale",list_price_kurus:150_000,sale_until:"2026-12-31T20:59:00Z"}}),
    image:{src:"/media/p.webp",width:240,height:240},logo:{src:"/media/l.webp",width:84,height:28},art:"filter",discountPercent:5,
    details:{specifications:[["Brand class","Premium"]],card:[{key:"Brand class",label:"Marka sınıfı",value:"Premium"}],vehicleSpecific:true,partNumber:"0986452041"}});
  assert.deepEqual(structuredClone(model),model);
  assert.deepEqual(JSON.parse(JSON.stringify(model)),model);
  assert.equal(model.image,"/media/p.webp");
  assert.equal(model.brandClass,"Premium");
  assert.equal(model.fit,"listed");
  assert.ok(model.href.startsWith("/urun/"));
});

test("a home card shows a consumer's price under its category", () => {
  const model=homeCardModel({product:product(),category:{name:"Filtreler",slug:"filtre"},image:{src:"/media/p.webp",width:180,height:180}});
  assert.equal(model.amount,money(100_000));
  assert.equal(model.categoryName,"Filtreler");
  assert.equal(model.categoryHref,"/kategori/filtre");
  assert.equal(model.image,"/media/p.webp");
  assert.equal(model.note,undefined);
  assert.equal(model.regular,undefined);
  assert.ok(model.href.startsWith("/urun/") && model.title.includes("BOSCH"));
  assert.deepEqual(homeCardModel({product:product()}).categoryName,"Yedek parçalar");
});

test("a home card discounts a service account's price and the campaign's regular price", () => {
  const model=homeCardModel({product:product({pricing_snapshot:{price_kind:"sale",list_price_kurus:150_000}}),discountPercent:10});
  assert.equal(model.amount,money(90_000));
  assert.equal(model.regular,money(135_000));
  assert.deepEqual(structuredClone(model),model);
});

test("an unavailable home card links to the notify form instead of a price", () => {
  const model=homeCardModel({product:product({unavailable:true,available:false,stock_label:"Şu an tedarik edilemiyor",pricing_snapshot:{price_kind:"sale",list_price_kurus:150_000}})});
  assert.deepEqual(model.note,{text:"Şu an tedarik edilemiyor · Gelince haber ver",href:model.href+"#haber-ver"});
  assert.equal(model.amount,undefined);
  assert.equal(model.regular,undefined);
  assert.deepEqual(homeCardModel({product:product({price_kurus:null})}).note,{text:"Fiyat bilgisi güncelleniyor"});
});
