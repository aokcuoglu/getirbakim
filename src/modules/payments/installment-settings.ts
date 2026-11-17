import 'server-only';
import { cache } from 'react';
import type { PoolClient } from 'pg';
import { db } from '@/lib/db';
import { INSTALLMENT_COUNTS,type InstallmentSettings } from './installment-plan';

type SettingsRow = {installments_enabled:boolean;installment_max:number;installment_min_basket_kurus:number;installment_single_rate:string;installment_rates:Record<string,unknown>};

const basisPoints=(percent:unknown)=>Math.round(Number(percent)*100);

/** Installment settings (#886); without a settings row installments are off. Pass the checkout client to read in its transaction. */
export async function installmentSettings(connection:Pick<PoolClient,'query'>=db):Promise<InstallmentSettings> {
 const row=(await connection.query<SettingsRow>(`SELECT installments_enabled,installment_max,installment_min_basket_kurus,installment_single_rate,installment_rates
  FROM commerce_settings WHERE id=true`)).rows[0];
 if(!row) return {enabled:false,max:6,minBasketKurus:0,singleRateBp:0,ratesBp:{}};
 const ratesBp:Record<number,number>={};
 for(const count of INSTALLMENT_COUNTS) {
  const value=row.installment_rates?.[String(count)];
  if(value!==undefined && value!==null && Number.isFinite(Number(value))) ratesBp[count]=basisPoints(value);
 }
 return {enabled:row.installments_enabled,max:row.installment_max,minBasketKurus:row.installment_min_basket_kurus,singleRateBp:basisPoints(row.installment_single_rate),ratesBp};
}

/** Per-request cached read for pages (product detail). */
export const currentInstallmentSettings=cache(()=>installmentSettings());
