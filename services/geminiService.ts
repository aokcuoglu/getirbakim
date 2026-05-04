import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Note: In production this should be proxied through a server route.
const apiKey = process.env.API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || ''

let aiClient: GoogleGenAI | null = null

function getAiClient(): GoogleGenAI | null {
  if (!apiKey) return null
  if (aiClient) return aiClient

  try {
    aiClient = new GoogleGenAI({ apiKey })
    return aiClient
  } catch {
    return null
  }
}

export const getMechanicAdvice = async (
  query: string,
  currentVehicle: string | null
): Promise<string> => {
  const ai = getAiClient()
  if (!ai) {
    return "I'm currently offline (Missing API Key). Please try again later.";
  }

  try {
    const vehicleContext = currentVehicle 
      ? `The user is asking about a ${currentVehicle}.` 
      : "The user has not selected a specific vehicle yet.";

    const systemInstruction = `
      You are an expert automotive mechanic and parts specialist for "Lumina Parts", a premium auto parts store. 
      Your goal is to help users find the right parts, diagnose simple issues, and explain technical specifications.
      
      ${vehicleContext}
      
      Keep your answers concise, helpful, and professional but friendly. 
      If suggesting parts, recommend categories like "Oil", "Filters", or "Wipers".
      Do not invent specific part numbers or prices, but describe what to look for.
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: query,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
    });

    return response.text || "I'm checking the manual... could you rephrase that?";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "I'm having trouble connecting to the garage server. Please try again.";
  }
};

/**
 * JSON cevap içinden dizi çıkarır. Önce doğrudan parse, yoksa [ ] regex, yoksa {translations} vb.
 */
function extractStringArray(raw: string): string[] | null {
  let s = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  // Doğrudan dizi
  try {
    const p = JSON.parse(s || 'null')
    if (Array.isArray(p)) return p
    if (p && typeof p === 'object' && Array.isArray((p as { translations?: string[] }).translations))
      return (p as { translations: string[] }).translations
    if (p && typeof p === 'object' && Array.isArray((p as { result?: string[] }).result))
      return (p as { result: string[] }).result
  } catch {}
  // Metin içindeki [ "a", "b" ] benzeri diziyi bul
  const m = s.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const a = JSON.parse(m[0])
      if (Array.isArray(a)) return a
    } catch {}
  }
  return null
}

/**
 * İngilizce oto parça kategori isimlerini Türkçeye çevirir (Gemini).
 * - Uzunluk uyuşmazsa sadece uyuşmayan indeksler EN kalır (tüm batch atılmaz).
 * - Hata olursa 1 kez tekrar dener.
 * @param names - Çevrilecek isimler (sıra korunur)
 * @returns Aynı sırada Türkçe isimler; çevrilemeyenler orijinal
 */
export const translateCategoryNamesToTurkish = async (
  names: string[]
): Promise<string[]> => {
  const ai = getAiClient()
  if (!ai || names.length === 0) return names;

  const doRequest = async (): Promise<string[]> => {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Translate these automotive/parts category names from English to Turkish.

RULES:
- Reply with ONLY a JSON array of strings. No other text, no markdown, no explanation.
- Same order as input. Same length. One Turkish string per item.
- Use common Turkish automotive terminology (e.g. Engine=Motor, Brake=Fren, Filter=Filtre).

Example: Input ["Body","Engine"] → Output ["Gövde","Motor"]

Input: ${JSON.stringify(names)}

Output:`,
      config: { temperature: 0.2 }
    });

    const raw = (response.text || '').trim()
    const arr = extractStringArray(raw)
    if (!arr || !Array.isArray(arr)) {
      console.warn('[Gemini] JSON dizi cikarilamadi, orijinal kullanilacak.')
      return names
    }

    // Uzunluk farklı olsa bile mevcut cevirileri kullan; bos/gecersiz indekslerde orijinal
    return names.map((n, i) =>
      typeof arr[i] === 'string' && String(arr[i]).trim() ? String(arr[i]).trim() : n
    )
  };

  try {
    return await doRequest()
  } catch (e) {
    console.warn('[Gemini] Ceviri hata, 1 kez tekrar deneniyor:', (e as Error).message)
    try {
      return await doRequest()
    } catch (e2) {
      console.error('[Gemini] translateCategoryNamesToTurkish:', e2)
      return names
    }
  }
};
