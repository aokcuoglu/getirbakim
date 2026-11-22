// CSV cells and files as Excel (Turkish) opens them: ";" delimiter, UTF-8 BOM, CRLF. Pure, shared by the manual list
// export (#832) and the partner statement (#1200).

/** A cell quoted only when it holds the delimiter, a quote or a line break. */
export const csvText = (value: string) => /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;

/** Free text: a value starting with = + - @ would be a formula in Excel, so it is prefixed with an apostrophe. */
export const csvSafe = (value: string) => csvText(/^[=+\-@]/.test(value) ? `'${value}` : value);

// Excel would read 00123 as 123, long numeric codes as 1,23E+12, 1E5 as 100000 and 1-2 or 3.4.2020 as dates: such
// codes are written as a text formula.
const excelNumberLike = /^0\d+$|^\d{12,}$|^\d+[eE]\d+$|^\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?$/;

/** A code in a file that is read back (manual list export, #832): any other code is written as is, so it round-trips. */
export const csvCode = (code: string) => excelNumberLike.test(code) ? `="${code}"` : csvText(code);

/** A reference in an export-only file (partner statement, #1200): like csvCode, but formula-guarded like free text. */
export const csvRef = (ref: string) => excelNumberLike.test(ref) ? `="${ref}"` : csvSafe(ref);

/** Lines (cells already escaped and joined) → the file: UTF-8 BOM, CRLF line ends. */
export const csvFile = (lines: string[]) => `﻿${lines.join("\r\n")}\r\n`;
