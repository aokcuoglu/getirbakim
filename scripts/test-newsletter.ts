import assert from "node:assert/strict";
import {test} from "node:test";
import {newsletterSchema} from "../src/modules/store/newsletter-schema";

test("newsletter requires explicit email consent and rejects malformed emails and bot fields",()=>{
  const valid={email:" TEST@example.invalid ",consent:"on",website:""};
  assert.equal(newsletterSchema.parse(valid).email,"test@example.invalid");
  for(const change of [{email:"invalid"},{email:"a".repeat(255)+"@example.invalid"},{consent:undefined},{consent:"off"},{consent:true},{website:"spam"}])assert.equal(newsletterSchema.safeParse({...valid,...change}).success,false);
  assert.ok(!("status" in newsletterSchema.parse({...valid,status:"confirmed"})));
});
