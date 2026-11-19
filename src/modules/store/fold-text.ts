// Text folding shared by the name modules (product-name.ts, suggestion-names.ts), kept apart so neither imports the other.

const foldTable: Record<string, string> = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u", "ë": "e" };

/** Lower case ASCII form of a token, the key of the dictionary and of the text comparisons. */
export function foldText(text: string): string {
  return text.replace(/İ/g, "i").toLocaleLowerCase("tr").replace(/[çğıöşüâîûë]/g, letter => foldTable[letter]);
}
