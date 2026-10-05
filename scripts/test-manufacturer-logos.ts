import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedLogoBrand,readLogoPng} from '../src/modules/store/manufacturer-logo-import';

test('brand aliases share one logo record after exact product verification',()=>{
 assert.equal(verifiedLogoBrand({brand:'FEBI',code:'FEBI 104620'},{manufacturer:'FEBI BILSTEIN',partNumber:'104620'}),'FEBIBILSTEIN');
 assert.equal(verifiedLogoBrand({brand:'MANN',code:'MANN C 2039'},{manufacturer:'MANN-FILTER',partNumber:'C 2039'}),'MANNFILTER');
 assert.equal(verifiedLogoBrand({brand:'LEMFORDER',code:'LEM 29930 02'},{manufacturer:'LEMFÖRDER',partNumber:'29930 02'}),'LEMFORDER');
});
test('OEM reference cannot attach a source brand logo to another manufacturer',()=>{
 assert.throws(()=>verifiedLogoBrand({brand:'BSG',code:'BSG 30-700-060'},{manufacturer:'FEBI BILSTEIN',partNumber:'104620'}));
 assert.throws(()=>verifiedLogoBrand({brand:'FEBI',code:'FEBI 104620'},{manufacturer:'FEBI BILSTEIN',partNumber:'104621'}));
});
test('logo import validates raster format, bounds and truncation',()=>{
 const png=readFileSync('tests/fixtures/BOSCH.png');
 assert(readLogoPng(png).width>0);
 assert.throws(()=>readLogoPng(png.subarray(0,30)));
 assert.throws(()=>readLogoPng(Buffer.from('<svg onload="alert(1)"/>')));
 const invalid=Buffer.from(png);invalid.writeUInt32BE(0,16);assert.throws(()=>readLogoPng(invalid));
 invalid.writeUInt32BE(3000,16);assert.throws(()=>readLogoPng(invalid));
});
