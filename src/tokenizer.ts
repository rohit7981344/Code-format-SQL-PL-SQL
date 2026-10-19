export type TokenType =
  | 'word'      // keyword or identifier
  | 'qident'    // "Quoted Identifier"
  | 'bind'      // :bind_variable, :new, :old
  | 'string'    // 'text', q'[text]', N'text'
  | 'number'
  | 'op'        // operators: := => || <= >= <> != .. + - * / = < > % @ .
  | 'comma'
  | 'semi'
  | 'lparen'
  | 'rparen'
  | 'lcomment'  // -- comment
  | 'bcomment'  // /* comment */
  | 'label'     // <<label>>
  | 'slash'     // SQL*Plus "/" on its own line
  | 'raw';      // SQL*Plus command line kept as-is (SET, PROMPT, ...)

export interface Token {
  type: TokenType;
  text: string;
  /** number of line breaks in the source between the previous token and this one */
  newlinesBefore: number;
}

const SQLPLUS_COMMANDS = new Set([
  'SET', 'PROMPT', 'SPOOL', 'DEFINE', 'UNDEFINE', 'COLUMN', 'COL', 'WHENEVER',
  'EXEC', 'EXECUTE', 'SHOW', 'CONNECT', 'CONN', 'DISCONNECT', 'TTITLE', 'BTITLE',
  'BREAK', 'COMPUTE', 'CLEAR', 'PAUSE', 'ACCEPT', 'VARIABLE', 'VAR', 'PRINT', 'REM', 'REMARK', 'HOST', 'START'
]);

const MULTI_OPS = [':=', '=>', '||', '<=', '>=', '<>', '!=', '^=', '~=', '..', '**'];
const Q_QUOTE_PAIRS: Record<string, string> = { '[': ']', '(': ')', '{': '}', '<': '>' };

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  let newlines = 0;
  // true when the next token could start a new statement (start of file, after ; or /)
  let atStatementBoundary = true;
  let lineHasToken = false;

  const push = (type: TokenType, text: string) => {
    tokens.push({ type, text, newlinesBefore: newlines });
    newlines = 0;
    lineHasToken = true;
    if (type === 'semi' || type === 'slash' || type === 'raw') {
      atStatementBoundary = true;
    } else if (type !== 'lcomment' && type !== 'bcomment') {
      atStatementBoundary = false;
    }
  };

  while (i < n) {
    const c = src[i];

    // whitespace
    if (c === '\n') { newlines++; lineHasToken = false; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i++; continue; }

    // line comment
    if (c === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      push('lcomment', src.slice(i, j).trimEnd());
      i = j;
      continue;
    }

    // block comment
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      push('bcomment', src.slice(i, j));
      i = j;
      continue;
    }

    // SQL*Plus "/" alone on a line
    if (c === '/' && !lineHasToken) {
      let j = i + 1;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
      if (j >= n || src[j] === '\n') {
        push('slash', '/');
        i = j;
        continue;
      }
    }

    // SQL*Plus commands and @script lines at the start of a statement: keep the line raw
    if (!lineHasToken && atStatementBoundary) {
      const m = /^(@@?|[A-Za-z]+)/.exec(src.slice(i, i + 20));
      if (m && (m[1].startsWith('@') || SQLPLUS_COMMANDS.has(m[1].toUpperCase()))) {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        push('raw', src.slice(i, j).trimEnd());
        i = j;
        continue;
      }
    }

    // q-quoted strings: q'[...]', nq'{...}'
    const qm = /^(n?q)'(.)/i.exec(src.slice(i, i + 4));
    if (qm) {
      const open = qm[2];
      const close = Q_QUOTE_PAIRS[open] ?? open;
      const start = i;
      let j = i + qm[0].length;
      const endSeq = close + "'";
      const k = src.indexOf(endSeq, j);
      j = k < 0 ? n : k + 2;
      push('string', src.slice(start, j));
      i = j;
      continue;
    }

    // normal strings (also N'...')
    if (c === "'" || ((c === 'n' || c === 'N') && src[i + 1] === "'")) {
      const start = i;
      let j = c === "'" ? i + 1 : i + 2;
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      push('string', src.slice(start, j));
      i = j;
      continue;
    }

    // quoted identifier
    if (c === '"') {
      let j = src.indexOf('"', i + 1);
      j = j < 0 ? n : j + 1;
      push('qident', src.slice(i, j));
      i = j;
      continue;
    }

    // label <<name>>
    if (c === '<' && src[i + 1] === '<') {
      const m = /^<<\s*[A-Za-z_][\w$#]*\s*>>/.exec(src.slice(i));
      if (m) { push('label', m[0].replace(/\s+/g, '')); i += m[0].length; continue; }
    }

    // bind variable :name / :1
    if (c === ':' && src[i + 1] !== '=' && /[A-Za-z0-9_]/.test(src[i + 1] ?? '')) {
      const m = /^:[A-Za-z0-9_$#]+/.exec(src.slice(i))!;
      push('bind', m[0]);
      i += m[0].length;
      continue;
    }

    // numbers (but not the start of "..")
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? '') && src[i - 1] !== '.')) {
      const m = /^(\d+(\.(?!\.)\d*)?|\.\d+)([eE][+-]?\d+)?[fFdD]?/.exec(src.slice(i))!;
      push('number', m[0]);
      i += m[0].length;
      continue;
    }

    // words (identifiers / keywords), including $ and # as Oracle allows
    if (/[A-Za-z_À-￿]/.test(c)) {
      const m = /^[A-Za-z_À-￿][\w$#À-￿]*/.exec(src.slice(i))!;
      push('word', m[0]);
      i += m[0].length;
      continue;
    }

    if (c === ',') { push('comma', ','); i++; continue; }
    if (c === ';') { push('semi', ';'); i++; continue; }
    if (c === '(') { push('lparen', '('); i++; continue; }
    if (c === ')') { push('rparen', ')'); i++; continue; }

    const two = src.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) { push('op', two); i += 2; continue; }

    push('op', c);
    i++;
  }
  return tokens;
}
