export interface DialoguePart {
  readonly text: string;
  readonly dialogue: boolean;
}

const QUOTES = new Map([
  ["“", "”"],
  ["「", "」"],
  ["『", "』"],
  ['"', '"'],
]);

/** 只划分显示片段；跨段台词和流式尚未闭合的引号沿用同一对话状态。 */
export function dialogueParagraphs(text: string): DialoguePart[][] {
  const closing: string[] = [];
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "")
    .map((paragraph) => {
      const parts: DialoguePart[] = [];
      let start = 0;
      let escaped = false;
      const append = (end: number, dialogue: boolean) => {
        if (end > start) parts.push({ text: paragraph.slice(start, end), dialogue });
        start = end;
      };

      for (let i = 0; i < paragraph.length; i += 1) {
        const char = paragraph.charAt(i);
        if (char === "\\") {
          escaped = !escaped;
          continue;
        }
        const escapedQuote = escaped && char === '"';
        escaped = false;
        if (escapedQuote) continue;

        if (char === closing.at(-1)) {
          closing.pop();
          if (closing.length === 0) append(i + 1, true);
          continue;
        }

        const endQuote = QUOTES.get(char);
        if (endQuote === undefined) continue;
        if (closing.length === 0) append(i, false);
        // 多段独白可每段重开左引号，直到最后一段才闭合。
        if (i === 0 && endQuote === closing.at(-1) && char !== endQuote) continue;
        closing.push(endQuote);
      }

      append(paragraph.length, closing.length > 0);
      return parts;
    });
}
