import { flow, partial, flatMap, flatten, last } from 'lodash';

/**
 * Reusable regular expressions segments.
 */
const patternSegments = {
  /**
   * Matches zero or more HTML attributes followed by the tag close bracket,
   * which may be prepended by zero or more spaces.  The attributes can use
   * single or double quotes and may be prepended by zero or more spaces.
   */
  htmlOpeningTagEnd: /(?: *\w+=(?:(?:"[^"]*")|(?:'[^']*')))* *>/,
};


const nonEscapePatterns = {
  /**
   * HTML Tags
   *
   * Matches HTML opening tags and any attributes. Does not check for contents
   * between tags or closing tags.
   */
  htmlTags: [
    /**
     * Matches the beginning of an HTML tag, excluding preformatted tag types.
     */
    /<(?!pre|style|script)[\w]+/,

    /**
     * Matches attributes.
     */
    patternSegments.htmlOpeningTagEnd,
  ],


  /**
   * Preformatted HTML Blocks
   *
   * Matches HTML blocks with preformatted content. The content of these blocks,
   * including the tags and attributes, should not be escaped at all.
   */
  preformattedHtmlBlocks: [
    /**
     * Matches the names of tags known to have preformatted content. The capture
     * group is reused when matching the closing tag.
     *
     * NOTE: this pattern reuses a capture group, and could break if combined with
     * other expressions using capture groups.
     */
    /<(pre|style|script)/,

    /**
     * Matches attributes.
     */
    patternSegments.htmlOpeningTagEnd,

    /**
     * Allow zero or more of any character (including line breaks) between the
     * tags. Match lazily in case of subsequent blocks.
     */
    /(.|[\n\r])*?/,

    /**
     * Match closing tag via first capture group.
     */
    /<\/\1>/,
  ],
};


/**
 * Joins an array of regular expressions into a single expression, without
 * altering the received expressions. Only flags passed as an argument will
 * apply to the resulting regular expression.
 */
function joinPatternSegments(patterns, flags = '') {
  const pattern = patterns.map(p => p.source).join('');
  return new RegExp(pattern, flags);
}


/**
 * Combines an array of regular expressions into a single expression, wrapping
 * each in a non-capturing group and interposing alternation characters (|) so
 * that each expression is executed separately. Only flags passed as an argument
 * will apply to the resulting regular expression.
 */
function combinePatterns(patterns, flags = '') {
  const pattern = patterns.map(p => `(?:${p.source})`).join('|');
  return new RegExp(pattern, flags);
}


function replaceWhen(matchPattern, replacePattern, text, invertMatchPattern) {
  function iterate(exp, text, acc) {
    const match = exp.exec(text);
    const lastEntry = last(acc);
    if (!match) return acc;
    if (match.index === 0) {
      acc.push({ index: 0, text: match[0], match: true });
    }
    else if (!lastEntry) {
      acc.push({ index: 0, text: match.input.slice(0, match.index) });
      acc.push({ index: match.index, text: match[0], match: true });
    }
    else if (match.index === lastEntry.index + lastEntry.text.length) {
      acc.push({ index: match.index, text: match[0], match: true });
    }
    else {
      const nextIndex = lastEntry.index + lastEntry.text.length;
      const nextText = match.input.slice(nextIndex, match.index);
      acc.push({ index: nextIndex, text: nextText });
      acc.push({ index: match.index, text: match[0], match: true });
    }
    return iterate(exp, text, acc);
  }

  const acc = iterate(matchPattern, text, []);
  const lastEntry = last(acc);
  if (!lastEntry) return replacePattern(text);

  const nextIndex = lastEntry.index + lastEntry.text.length;
  if (text.length > nextIndex) {
    acc.push({ index: nextIndex, text: text.slice(nextIndex) });
  }

  const replacedText = acc.map(entry => {
    const isMatch = invertMatchPattern ? !entry.match : entry.match;
    return isMatch ? replacePattern(entry.text) : entry.text;
  });

  return replacedText.join('');
}


/**
 * Escape patterns
 *
 * Each escape pattern matches a markdown entity and captures up to two
 * groups. These patterns must use one of the following formulas:
 *
 * - Single capture group only - /(...)/
 *   The captured characters should simply be escaped.
 *
 * - Single capture group followed by match content - /(...).../
 *   The captured characters should be escaped and the remaining match should
 *   remain unchanged.
 *
 * - Two capture groups surrounding matched content - /(...)...(...)/
 *   The captured characters in both groups should be escaped and the matched
 *   characters in between should remain unchanged.
 */
const escapePatterns = [
  /**
   * Emphasis/Bold - Asterisk
   *
   * Match strings surrounded by one or more asterisks on both sides.
   */
  /(\*+)[^\*]*(\1)/g,

  /**
   * Emphasis - Underscore
   *
   * Match strings surrounded by a single underscore on both sides followed by
   * a word boundary. Remark disregards whether a word boundary exists at the
   * beginning of an emphasis node.
   */
  /(_)[^_]+(_)\b/g,

  /**
   * Bold - Underscore
   *
   * Match strings surrounded by multiple underscores on both sides. Remark
   * disregards the absence of word boundaries on either side of a bold node.
   */
  /(_{2,})[^_]*(\1)/g,

  /**
   * Strikethrough
   *
   * Match strings surrounded by multiple tildes on both sides.
   */
  /(~+)[^~]*(\1)/g,

  /**
   * Inline Code
   *
   * Match strings surrounded by backticks.
   */
  /(`+)[^`]*(\1)/g,

  /**
   * Links, Images, References, and Footnotes
   *
   * Match strings surrounded by brackets. This could be improved to
   * specifically match only the exact syntax of each covered entity, but
   * doing so through current approach would incur a considerable performance
   * penalty.
   */
  /(\[)[^\]]*]/g,
];


/**
 * A Remark plugin for escaping markdown entities.
 *
 * When markdown entities are entered in raw markdown, they don't appear as
 * characters in the resulting AST; for example, dashes surrounding a piece of
 * text cause the text to be inserted in a special node type, but the asterisks
 * themselves aren't present as text. Therefore, we generally don't expect to
 * encounter markdown characters in text nodes.
 *
 * However, the CMS visual editor does not interpret markdown characters, and
 * users will expect these characters to be represented literally. In that case,
 * we need to escape them, otherwise they'll be interpreted during
 * stringification.
 */
export default function remarkEscapeMarkdownEntities() {
  const transform = (node, index) => {
    const children = node.children && node.children.map(transform);

    /**
     * Escape characters in text and html nodes only. We store a lot of normal
     * text in html nodes to keep Remark from escaping html entities.
     */
    if (['text', 'html'].includes(node.type)) {

      /**
       * Escape all characters if this is the first child node, otherwise only
       * common characters.
       */
      const value = index === 0 ? escapeAllChars(node.value) : escapeCommonChars(node.value);
      return { ...node, value, children };
    }

    /**
     * Always return nodes with recursively mapped children.
     */
    return {...node, children };
  };

  return transform;
}


function escapeCommonChars(text) {
  const { htmlTags, preformattedHtmlBlocks } = nonEscapePatterns;
  const joinedNonEscapePatterns = [ htmlTags, preformattedHtmlBlocks ].map(p => joinPatternSegments(p));
  const nonEscapePattern = combinePatterns(joinedNonEscapePatterns, 'gm');
  const escapeFunctions = escapePatterns.map(pattern => partial(escape, pattern));
  const escapeAll = flow(escapeFunctions);
  return replaceWhen(nonEscapePattern, escapeAll, text, true);
}


function escape(pattern, text) {
  return text.replace(pattern, (match, start, end) => {
    const hasEnd = typeof end === 'string';
    const matchSliceEnd = hasEnd ? match.length - end.length : match.length;
    const content = match.slice(start.length, matchSliceEnd);
    return `${escapeDelimiter(start)}${content}${hasEnd ? escapeDelimiter(end) : ''}`;
  });
}


function escapeDelimiter(delim) {
  let result = '';
  for (const char of delim) {
    result += `\\${char}`;
  }
  return result;
}


/**
 * Runs escapeCommonChars, and also escapes '#', '*', '-', '>', '=', '|' and
 * sequences of 3+ backticks or 4+ spaces when found at the beginning of any
 * node's first child node.
 */
function escapeAllChars(text) {
  const partiallyEscapedMarkdown = escapeCommonChars(text);
  return partiallyEscapedMarkdown.replace(/^\s*([-#*>=|]| {4,}|`{3,})/, '$`\\$1');
}
