/**
 * 思维链流式/静态拆分器：
 * 识别常见成对思考标签（<think>、<thinking>、<thought>、<think_nya>、<report_nya>、<reasoning>、<cot> 等），
 * 在流式输出时将思考内容实时路由至独立 thought 通道，保持正文与后续记账抽取纯净。
 */

const THOUGHT_TAGS = [
  "think_nya~",
  "think_nya",
  "report_nya~",
  "report_nya",
  "thinking",
  "thought",
  "reasoning",
  "think",
  "cot",
] as const;

const OPEN_TAG_RE =
  /<(think_nya~?|report_nya~?|thinking|thought|reasoning|think|cot)(?:\s[^>]*)?>/i;
const TRAILING_COMMENT_RE = /^(?:\s*<!--\s*<\/think>\s*-->)/i;
const MAX_PENDING_TAG_LEN = 64;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function couldStartOpenTag(tail: string): boolean {
  if (!tail.startsWith("<") || tail.includes(">") || tail.length > MAX_PENDING_TAG_LEN) {
    return false;
  }
  const rest = tail.slice(1).toLowerCase();
  if (rest === "") return true;
  // 标签名部分或 `<tag attr...` 未闭合形态
  const space = rest.search(/\s/);
  if (space >= 0) {
    const tagName = rest.slice(0, space);
    return THOUGHT_TAGS.some((tag) => tag === tagName);
  }
  return THOUGHT_TAGS.some((tag) => tag.startsWith(rest));
}

function couldStartCloseTag(tail: string, activeTag: string): boolean {
  if (!tail.startsWith("<") || tail.includes(">") || tail.length > MAX_PENDING_TAG_LEN) {
    return false;
  }
  const expected = `</${activeTag}`;
  const lower = tail.toLowerCase();
  if (expected.startsWith(lower)) return true;
  if (lower.startsWith(expected)) {
    return /^\s*$/.test(lower.slice(expected.length));
  }
  return false;
}

export interface ThoughtChunk {
  readonly text: string;
  readonly thought: string;
}

export interface ThoughtSplitResult {
  readonly restText: string;
  readonly restThought: string;
  readonly body: string;
  readonly thought: string;
}

export class ThoughtStreamSplitter {
  private mode: "body" | "thought" = "body";
  private activeTag = "";
  private pending = "";
  private body = "";
  private thought = "";
  private thoughtBlocks = 0;

  push(chunk: string): ThoughtChunk {
    if (chunk === "") return { text: "", thought: "" };
    let textOut = "";
    let thoughtOut = "";
    let work = this.pending + chunk;
    this.pending = "";

    while (work !== "") {
      if (this.mode === "body") {
        const match = OPEN_TAG_RE.exec(work);
        if (match?.[1]) {
          const before = work.slice(0, match.index);
          if (before !== "") {
            textOut += before;
            this.body += before;
          }
          this.mode = "thought";
          this.activeTag = match[1].toLowerCase();
          if (this.thoughtBlocks > 0 && this.thought !== "" && !this.thought.endsWith("\n\n")) {
            const sep = this.thought.endsWith("\n") ? "\n" : "\n\n";
            thoughtOut += sep;
            this.thought += sep;
          }
          this.thoughtBlocks += 1;
          work = work.slice(match.index + match[0].length);
          continue;
        }
        const lt = work.lastIndexOf("<");
        if (lt >= 0 && couldStartOpenTag(work.slice(lt))) {
          const safe = work.slice(0, lt);
          if (safe !== "") {
            textOut += safe;
            this.body += safe;
          }
          this.pending = work.slice(lt);
          break;
        }
        textOut += work;
        this.body += work;
        break;
      }

      const closeRe = new RegExp(`</${escapeRegExp(this.activeTag)}\\s*>`, "i");
      const closeMatch = closeRe.exec(work);
      if (closeMatch) {
        const inside = work.slice(0, closeMatch.index);
        if (inside !== "") {
          thoughtOut += inside;
          this.thought += inside;
        }
        let after = work.slice(closeMatch.index + closeMatch[0].length);
        const comment = TRAILING_COMMENT_RE.exec(after);
        if (comment) after = after.slice(comment[0].length);
        if (this.body.trim() === "") after = after.replace(/^\s+/, "");
        this.mode = "body";
        this.activeTag = "";
        work = after;
        continue;
      }

      const lt = work.lastIndexOf("<");
      if (lt >= 0 && couldStartCloseTag(work.slice(lt), this.activeTag)) {
        const safe = work.slice(0, lt);
        if (safe !== "") {
          thoughtOut += safe;
          this.thought += safe;
        }
        this.pending = work.slice(lt);
        break;
      }
      thoughtOut += work;
      this.thought += work;
      break;
    }

    return { text: textOut, thought: thoughtOut };
  }

  finish(): ThoughtSplitResult {
    let restText = "";
    let restThought = "";
    if (this.pending !== "") {
      if (this.mode === "body") {
        restText = this.pending;
        this.body += this.pending;
      } else {
        restThought = this.pending;
        this.thought += this.pending;
      }
      this.pending = "";
    }
    return {
      restText,
      restThought,
      body: this.body.trim(),
      thought: this.thought.trim(),
    };
  }
}

/** 从完整或半成品文本中拆分思维链与正文；前后端共用同一套标签规则。 */
export function extractThoughtFromText(input: string): {
  readonly body: string;
  readonly thought: string;
} {
  const splitter = new ThoughtStreamSplitter();
  splitter.push(input);
  const done = splitter.finish();
  return { body: done.body, thought: done.thought };
}
