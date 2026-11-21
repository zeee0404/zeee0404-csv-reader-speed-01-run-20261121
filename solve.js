// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// answer {columns, rows, errors} for every input, but reads the text with native
// scans instead of one character at a time.
//
// The reference builds every field a character at a time (value += c). This one
// never loops over characters:
// - an unquoted field ends at the nearest of the next comma, LF or CR, each
//   found with a native indexOf (the CR cursor advances once per CR in the
//   whole text, never once per field);
// - a quoted field is found with indexOf('"');
// - every field value is taken with slice();
// - a record whose first line holds no quote at all is read with one split(',');
// - field readers return the value string and report how it ended through two
//   shared slots, so no result object is allocated per field.
// The control flow mirrors the reference exactly — same record/line bookkeeping,
// same error codes in the same order — so the answers are identical; only the
// work per character is gone.
//
// Semantics (csv-reader's broken-row policy, kept verbatim):
// - U+FEFF at the very start is dropped; a record ends at LF or CRLF; a line left
//   with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside it is one quote, each CRLF or lone CR inside it reads as LF; what
//   follows its closing quote, up to the next comma or line break, is appended as
//   it stands (quote_junk, when the field ends); a quote that never closes is a
//   literal character and the text after it is read again as unquoted
//   (unterminated_quote).
// - A quote inside an unquoted field is a literal character. Fields stay strings.
// - columns is the first record when header is true, else null; rows are padded
//   with "" (short_row, with fields: its count) or cut (long_row, with extra: the
//   cut fields) to the first record's width.
// - Each error is {code, line, row}: line the 1-based line its record starts on
//   (every LF, CRLF and lone CR inside a quoted field counted), row its record's
//   index in rows (null for the header), in the order met.

const COMMA = 'comma';
const LINE_BREAK = 'line break';
const END = 'end';

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters its unquoted read
  // kept: the field readers return the value string and report these here, so
  // no result object is allocated per field.
  let lastEnded = END;
  let lastAdded = 0;

  // The first CR at or after pos, kept as a cursor: pos only moves forward, so
  // advancing it costs one indexOf per CR in the whole text, never per field.
  // (An unterminated quote moves pos backwards; that branch resets it.)
  let nextCR = text.indexOf('\r', 0);

  // Advance the CR cursor to the first CR at or after pos.
  function advanceCR() {
    while (nextCR !== -1 && nextCR < pos) nextCR = text.indexOf('\r', nextCR + 1);
  }

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // The quoted content of text[a..b): CRLF and lone CR read as LF, and every line
  // break inside it counted into `line`. Most quoted fields hold no line break at
  // all, so the two indexOf checks keep the common case to a plain slice.
  function quotedContent(a, b) {
    if (a === b) return '';
    const seg = text.slice(a, b);
    if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) return seg;
    const breaks = seg.match(/\r\n|\r|\n/g);
    if (breaks !== null) line += breaks.length;
    return seg.indexOf('\r') === -1 ? seg : seg.replace(/\r\n?/g, '\n');
  }

  // Reads an unquoted field from pos, with `value` as its prefix ('' normally, or
  // a quoted field's content when reading what follows its closing quote).
  // Returns the field's value; lastEnded says how it ended and lastAdded counts
  // the characters kept.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      if (pos >= n) {
        lastEnded = END;
        lastAdded = added;
        return value;
      }
      // The next comma or LF, whichever is nearer (n when neither is left), and
      // the first CR at or after pos: whichever of the three is nearest ends it.
      const iComma = text.indexOf(',', pos);
      const iLF = text.indexOf('\n', pos);
      advanceCR();
      let next = n;
      let kind = END;
      if (iComma !== -1) {
        next = iComma;
        kind = COMMA;
      }
      if (iLF !== -1 && iLF < next) {
        next = iLF;
        kind = LINE_BREAK;
      }
      if (nextCR !== -1 && nextCR < next) {
        next = nextCR;
        kind = 'cr';
      }
      if (next > pos) {
        value += text.slice(pos, next);
        added += next - pos;
      }
      if (kind === COMMA) {
        pos = next + 1;
        lastEnded = COMMA;
        lastAdded = added;
        return value;
      }
      if (kind === LINE_BREAK) {
        pos = next + 1;
        line += 1;
        lastEnded = LINE_BREAK;
        lastAdded = added;
        return value;
      }
      if (kind === END) {
        pos = n;
        lastEnded = END;
        lastAdded = added;
        return value;
      }
      // kind === 'cr'
      if (text.charCodeAt(next + 1) === 10) {
        pos = next + 2;
        line += 1;
        lastEnded = LINE_BREAK;
        lastAdded = added;
        return value;
      }
      error('stray_cr');
      pos = next + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns its value;
  // lastEnded says how it ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let segStart = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted. pos moves backwards, so the CR cursor
        // is reset to the new pos.
        pos = open + 1;
        line = openLine;
        nextCR = text.indexOf('\r', pos);
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote, and the field goes on.
        value += quotedContent(segStart, q) + '"';
        pos = q + 2;
        segStart = q + 2;
        continue;
      }
      value += quotedContent(segStart, q);
      pos = q + 1;
      if (pos >= n) {
        lastEnded = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        lastEnded = COMMA;
        return value;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        lastEnded = LINE_BREAK;
        return value;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        lastEnded = LINE_BREAK;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break.
      const junk = readUnquoted(value);
      if (lastAdded > 0) error('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let fast = false;
    // Fast path: a record whose first line holds no quote at all is all unquoted
    // fields, so one split(',') reads it. (A quote anywhere in the line means a
    // quoted field or a literal quote: fall through to the field scanner. A CR
    // other than a trailing CRLF is a stray CR: fall through too.)
    let lineEnd = text.indexOf('\n', pos);
    const hasLF = lineEnd !== -1;
    if (!hasLF) lineEnd = n;
    const q = text.indexOf('"', pos);
    if ((q === -1 || q >= lineEnd) && lineEnd > pos) {
      advanceCR();
      let end = lineEnd;
      if (hasLF && text.charCodeAt(end - 1) === 13) end -= 1; // CRLF
      if (nextCR === -1 || nextCR >= end) {
        fields.push(...text.slice(pos, end).split(','));
        pos = hasLF ? lineEnd + 1 : n;
        if (hasLF) line += 1;
        fast = true;
      }
    }
    if (!fast) {
      let value;
      do {
        quoted = text.charCodeAt(pos) === 34;
        value = quoted ? readQuoted() : readUnquoted('');
        fields.push(value);
      } while (lastEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
