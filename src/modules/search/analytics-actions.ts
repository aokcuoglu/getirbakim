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

/** Runs the AI suggestion pass (#834): up to 40 zero-result queries and 120 catalog spelling pairs, about a minute. */
export async function generateSynonymSuggestionsAction() {
  await requireAdmin();
  const { suggestForVocabulary, suggestForZeroResults } = await import('./synonym-suggestions');
  let added = 0;
  try {
    added += (await suggestForZeroResults(40)).added;
    added += (await suggestForVocabulary(120)).added;
  } catch (error) {
    console.error('Synonym suggestions failed', error instanceof Error ? error.message : error);
    revalidatePath('/yonetim/arama'); redirect(`/yonetim/arama?tab=suggestions&error=ai${added ? `&added=${added}` : ''}`);
  }
  revalidatePath('/yonetim/arama'); redirect(`/yonetim/arama?tab=suggestions&saved=generated&added=${added}`);
}
/** Approves a suggestion into the synonym groups, or rejects it so it is never suggested again. */
export async function decideSuggestionAction(form: FormData) {
  const admin = await requireAdmin();
  const input = z.object({ id: z.string().regex(/^\d+$/), decision: z.enum(['approve', 'reject']) }).safeParse(Object.fromEntries(form));
  if (!input.success) redirect('/yonetim/arama?tab=suggestions&error=decide');
  const { decideSuggestion } = await import('./synonym-suggestions');
  const changed = await decideSuggestion(input.data.id, input.data.decision === 'approve', admin.id);
  revalidatePath('/yonetim/arama');
  redirect(changed ? `/yonetim/arama?tab=suggestions&saved=${input.data.decision === 'approve' ? 'approved' : 'rejected'}` : '/yonetim/arama?tab=suggestions&error=decide');
}
