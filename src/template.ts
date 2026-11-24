export interface TokenSpan {
  readonly token: string;
  readonly start: number;
  readonly end: number;
}

export interface AppliedTemplate {
  readonly text: string;
  readonly spans: readonly TokenSpan[];
  readonly missing: readonly string[];
}

const TOKEN_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

export function extractTokens(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    seen.add(match[1]!);
  }
  return [...seen];
}

export function applyTokens(
  template: string,
  values: Readonly<Record<string, string>>,
): AppliedTemplate {
  const spans: TokenSpan[] = [];
  const missing = new Set<string>();
  let text = "";
  let cursor = 0;

  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const at = match.index ?? 0;
    const token = match[1]!;
    text += template.slice(cursor, at);
    if (Object.hasOwn(values, token)) {
      const replacement = values[token]!;
      const start = text.length;
      text += replacement;
      spans.push({ token, start, end: text.length });
    } else {
      missing.add(token);
      text += match[0];
    }
    cursor = at + match[0].length;
  }

  text += template.slice(cursor);
  return { text, spans, missing: [...missing] };
}
