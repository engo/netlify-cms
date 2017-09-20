import { flow, partial, flatMap, flatten } from 'lodash';

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
  /**
   * Escape patterns
   *
   * Each pattern must utilize two capture groups when matching surrounding
   * markdown entities, which allows the replacement function to escape only
   * the entities themselves.
   */
  const escapePatterns = [
    /**
     * Asterisks
     *
     * Match strings surrounded by one or more asterisks on both sides.
     */
    /(\*+)[^\*]+(\1)/g,

    /**
     * Single Underscores
     *
     * Match strings surrounded by a single underscore on both sides followed by
     * a word boundary. Remark disregards whether a word boundary exists at the
     * beginning of a set of underscores.
     */
    /(_)[^_](_)\b/g,

    /**
     * Multiple Underscores
     *
     * Match strings surrounded by multiple underscores on both sides. Remark
     * disregards the absence of word boundaries on either side of a set of
     * underscores where more than one underscore is present on both sides.
     */
    /(_{2,})[^_]+(\1)/g,

    /**
     * Multiple Tildes
     *
     * Match strings surrounded by multiple tildes on both sides.
     */
    /(~+)[^~]+(\1)/g,

    /**
     * Brackets
     *
     * Match strings surrounded by brackets.
     */
    /(\[)[^[](])/g,
  ];

  const nonEscapePatterns = [
    /**
     * Preformatted HTML Blocks
     *
     * HTML blocks with preformatted content should not be escaped at all. This
     * includes the 'pre', 'script', and 'style' tags.
     */
    /<(pre|style|script)(?:\s*\w+=(("[^"]*")|('[^']*')))*\s*>(.|[\n\r])*?<\/\1>/gm,
  ];

  /**
   * Escape all occurrences of '[', '*', '_', '`', and '~'.
   */
  function escapeCommonChars(text) {
    const escapeFunctions = escapePatterns.map(pattern => partial(escape, pattern));
    const escapeAll = flow(escapeFunctions);
    const escapedTextSegments = nonEscapePatterns.reduce((acc, pattern) => {
      return flatMap(acc, str => {
        let matchFound = false;
        const result = str.replace(pattern, (match, ...args) => {
          matchFound = true;
          const offset = args[args.length - 2];
          const fullStr = args[args.length - 1];
          if (match.length === fullStr.length) {
            return [match];
          }

          const prefix = fullStr.slice(0, offset);
          const suffix = fullStr.slice(offset + match.length);
          return [prefix && escapeAll(prefix), match, suffix && escapeAll(suffix)].filter(val => val);
        });
        return matchFound ? result : escapeAll(str);
      });
    }, [text]);

    const escapedText = flatten(escapedTextSegments).join();

    return escapedText;
  }

  function escape(pattern, text) {
    return text.replace(pattern, (match, start, end) => {
      const content = match.slice(start.length, match.length - end.length);
      return `${escapeDelimiter(start)}${content}${escapeDelimiter(end)}`;
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
   * Runs escapeCommonChars, and also escapes '#', '*', and '-' when found at
   * the beginning of any node's first child node.
   */
  function escapeAllChars(text) {
    const partiallyEscapedMarkdown = escapeCommonChars(text);
    return partiallyEscapedMarkdown.replace(/^\s*([-#*])/, '$`\\$1');
  }

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
