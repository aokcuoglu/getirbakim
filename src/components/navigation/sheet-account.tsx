import Link from "next/link";
import {Suspense} from "react";
import { StoreIcon } from "@/components/site/store-icon";
import {currentAccount} from "@/modules/auth/session";
function AccountRow({signedIn}:{signedIn:boolean}){
 return <Link href={signedIn?"/hesap":"/giris"} className="sheet-account-row"><StoreIcon name="user-round" size={15}/><span>{signedIn?"Hesabım":"Giriş yap"}</span></Link>;
}

async function SessionAccountRow(){
 return <AccountRow signedIn={(await currentAccount())!==null}/>;
}

/**
 * The account row at the foot of the phone/tablet category sheet (#1043): "Hesabım" for a signed-in visitor (as the
 * header's account menu shows), "Giriş yap" otherwise. A server slot streamed into the client sheet, so the sheet needs
 * no session fetch of its own; the session lookup is shared with the header through React cache. Until it streams in,
 * "Hesabım" stands in: /hesap sends a signed-out visitor to the sign-in page.
 */
export function SheetAccount(){
 return <Suspense fallback={<AccountRow signedIn/>}><SessionAccountRow/></Suspense>;
}
