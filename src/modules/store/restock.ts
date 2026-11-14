"use server";

import {headers} from "next/headers";
import {currentAccount} from "@/modules/auth/session";
import {createRestockRequest} from "./restock-requests";
import type {RestockState} from "./restock-schema";

export async function requestRestock(_previous:RestockState,form:FormData):Promise<RestockState> {
  const [account,list]=await Promise.all([currentAccount(),headers()]);
  // The first hop of X-Forwarded-For is the client behind the edge proxy; it only feeds the rate limit, hashed.
  const ip=list.get("x-forwarded-for")?.split(",")[0]?.trim()||list.get("x-real-ip")||null;
  return createRestockRequest({productId:form.get("productId"),email:form.get("email"),consent:form.get("consent"),website:form.get("website")??""},
    {accountId:account?.id??null,ip});
}
