// CSV cells and files as Excel (Turkish) opens them: ";" delimiter, UTF-8 BOM, CRLF. Pure, shared by the manual list
// export (#832) and the partner statement (#1200).

/** A cell quoted only when it holds the delimiter, a quote or a line break. */
export const csvText = (value: string) => /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;

// Excel would read 00123 as 123, long numeric codes as 1,23E+12, 1E5 as 100000 and 1-2 or 3.4.2020 as dates: such
// codes are written as a text formula.
export const csvCode = (code: string) => /^0\d+$|^\d{12,}$|^\d+[eE]\d+$|^\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?$/.test(code) ? `="${code}"` : csvText(code);

/** Free text: a value starting with = + - @ would be a formula in Excel, so it is prefixed with an apostrophe. */
export const csvSafe = (value: string) => csvText(/^[=+\-@]/.test(value) ? `'${value}` : value);

/** Lines (cells already escaped and joined) → the file: UTF-8 BOM, CRLF line ends. */
export const csvFile = (lines: string[]) => `﻿${lines.join("\r\n")}\r\n`;
