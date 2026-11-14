'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/modules/auth/session';
import { deleteRestockRequest, markRestockNotified } from './restock';

const page = '/yonetim/stok-bildirimleri';
/** The admin told the shopper by hand (no email is sent from the store yet). */
export async function markRestockNotifiedAction(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ id: z.uuid() }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`${page}?error=1`);
  const changed = await markRestockNotified([input.data.id], admin.id);
  revalidatePath('/yonetim', 'layout'); redirect(changed ? `${page}?saved=notified` : `${page}?error=1`);
}
/** Withdrawal at the shopper's request: the request is deleted at once. */
export async function deleteRestockRequestAction(form: FormData) {
  await requireAdmin();
  const input = z.object({ id: z.uuid(), tab: z.enum(['pending', 'notified']).catch('pending') }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`${page}?error=1`);
  const deleted = await deleteRestockRequest(input.data.id);
  revalidatePath('/yonetim', 'layout');
  redirect(deleted ? `${page}?${input.data.tab === 'notified' ? 'tab=notified&' : ''}saved=deleted` : `${page}?error=1`);
}
