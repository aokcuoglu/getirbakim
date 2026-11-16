'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/modules/auth/session';
import { invalidateListings } from '@/modules/store/listing-epoch';
import { addCustomSynonymGroup, deleteCustomSynonymGroup, parseSynonymInput } from './analytics';

const page = '/yonetim/arama?tab=synonyms';
/** A synonym group from the admin form: two or more spellings, comma separated (#822). */
export async function addSynonymGroupAction(form: FormData) {
  const admin = await requireAdmin();
  const words = parseSynonymInput(String(form.get('words') ?? ''));
  if (words.length < 2) redirect(`${page}&error=words`);
  await addCustomSynonymGroup(words, admin.id);
  // Drops cached searches and makes every process reload the groups (custom-synonyms.ts).
  await invalidateListings();
  revalidatePath('/yonetim/arama'); redirect(`${page}&saved=added`);
}
export async function deleteSynonymGroupAction(form: FormData) {
  await requireAdmin();
  const input = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect(`${page}&error=delete`);
  const deleted = await deleteCustomSynonymGroup(input.data.id);
  await invalidateListings();
  revalidatePath('/yonetim/arama'); redirect(deleted ? `${page}&saved=deleted` : `${page}&error=delete`);
}
