import Link from "next/link";
import {Suspense} from "react";
import {UserRound} from "lucide-react";
import {currentAccount} from "@/modules/auth/session";
import {cn} from "@/lib/utils";
import {sheetRow} from "./category-parts";

const row=cn(sheetRow,"min-h-[49px] border-b border-border px-4 py-3 text-sm font-normal");

function AccountRow({signedIn}:{signedIn:boolean}){
 return <Link href={signedIn?"/hesap":"/giris"} className={row}><UserRound size={15}/><span>{signedIn?"Hesabım":"Giriş yap"}</span></Link>;
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
