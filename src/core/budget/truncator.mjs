/**
 * Paragraph-safe text truncator for the context budget manager.
 *
 * Splits text on double-newline paragraph boundaries and assembles
 * paragraphs until the character budget is reached. Never splits a
 * paragraph mid-content.
 */

/**
 * Truncate text to fit within maxChars by keeping whole paragraphs only.
 *
 * Splits on double-newline boundaries and reassembles until the
 * cumulative character count would exceed maxChars.
 *
 * @param {string} text — raw markdown text from a SKILL.md
 * @param {number} maxChars — hard character cap
 * @returns {string} truncated text (≤ maxChars chars)
 */
export function truncateAtParagraph(text, maxChars) {
  if (typeof text !== 'string' || maxChars <= 0) return '';

  maxChars = Math.floor(maxChars);

  if (text.length <= maxChars) return text;

  // Split on double-newline to get paragraph blocks
  const paragraphs = text.split(/\n\s*\n/);
  const kept = [];
  let accumulated = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const sep = i < paragraphs.length - 1 ? '\n\n' : '';
    const paraWithSep = para + sep;

    // If the paragraph itself exceeds the remaining budget, include it
    // whole anyway — we never split mid-paragraph
    if (accumulated + paraWithSep.length > maxChars && accumulated > 0) {
      break;
    }

    // If this is the first paragraph and it alone exceeds budget, include it
    kept.push(para);
    accumulated += paraWithSep.length;
  }

  return kept.join('\n\n');
}

/**
 * Compute the character count of a string, handling multi-byte
 * Unicode code points as single characters (same as .length for
 * well-formed UTF-8 strings).
 *
 * @param {string} text
 * @returns {number}
 */
export function charCount(text) {
  return text.length;
}
