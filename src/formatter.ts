import { Token, tokenize } from './tokenizer';
import {
  KEYWORDS, DATATYPES, CLAUSE_STARTERS, SPACE_BEFORE_PAREN, JOIN_WORDS
} from './keywords';

export type CaseStyle = 'upper' | 'lower' | 'preserve';

export interface FormatOptions {
  /** spaces per indent level (SQL Developer default: 4) */
  indentSize: number;
  useTabs: boolean;
  keywordCase: CaseStyle;
  identifierCase: CaseStyle;
  /** trailing: "a,\n b"  leading: "a\n, b" */
  commaPosition: 'trailing' | 'leading';
  /** put AND / OR of WHERE and HAVING on their own lines */
  breakAndOr: boolean;
  /** max consecutive blank lines kept from the source */
  maxBlankLines: number;
}

export const DEFAULT_OPTIONS: FormatOptions = {
  indentSize: 4,
  useTabs: false,
  keywordCase: 'upper',
  identifierCase: 'lower',
  commaPosition: 'trailing',
  breakAndOr: true,
  maxBlankLines: 1,
};

type FrameKind = 'declare' | 'is' | 'begin' | 'exception' | 'if' | 'loop' | 'casestmt' | 'caseexpr';
interface Frame {
  kind: FrameKind;
  base: number;      // indent of the opening / closing keyword
  inner: number;     // indent of statements inside
  awaitingBegin?: boolean;
  levelBefore?: number;
}

interface Query {
  first: string;     // SELECT / INSERT / UPDATE / DELETE / MERGE / WITH
  base: number;      // indent of clause keywords
  depth: number;     // paren depth the query lives at
  clause: string;    // current clause keyword
  started: boolean;
  between: boolean;
}

type ParenKind = 'list' | 'sub' | 'inline';
interface Paren { kind: ParenKind; levelBefore: number; lineIndent: number; }

type HeaderKind = 'pending' | 'proc' | 'trigger' | 'table' | 'view' | 'type' | 'other';
interface Header { base: number; kind: HeaderKind; listDone: boolean; }

interface Prev { type: Token['type'] | 'none'; up: string; isKeyword: boolean; }

const BLOCK_KINDS: FrameKind[] = ['declare', 'is', 'begin', 'exception'];

export function format(source: string, options: Partial<FormatOptions> = {}): string {
  return new Formatter({ ...DEFAULT_OPTIONS, ...options }).run(source);
}

class Formatter {
  private lines: string[] = [];
  private cur = '';
  private curIndent = 0;
  private level = 0;
  private frames: Frame[] = [];
  private queries: Query[] = [];
  private parens: Paren[] = [];
  private header: Header | null = null;
  private stmtStart = true;
  private stmtFirst = '';
  private pendingThen: null | 'if' | 'handler' | 'casestmt' = null;
  private pendingClause: { q: Query; kw: string } | null = null;
  private forcedBreak = false;
  private noSpaceNext = false;
  private forallPending = false;
  private prev: Prev = { type: 'none', up: '', isKeyword: false };
  private toks: Token[] = [];
  private idx = 0;

  constructor(private o: FormatOptions) {}

  run(source: string): string {
    this.toks = tokenize(source);
    for (this.idx = 0; this.idx < this.toks.length; this.idx++) {
      this.handle(this.toks[this.idx]);
    }
    this.newline();
    while (this.lines.length && this.lines[this.lines.length - 1] === '') this.lines.pop();
    return this.lines.join('\n') + (this.lines.length ? '\n' : '');
  }

  // ---------------------------------------------------------------- output helpers

  private indentStr(n: number): string {
    return this.o.useTabs ? '\t'.repeat(n) : ' '.repeat(n * this.o.indentSize);
  }

  private newline(): void {
    if (this.cur !== '') {
      this.lines.push(this.indentStr(this.curIndent) + this.cur);
      this.cur = '';
    }
  }

  private blankLine(): void {
    this.newline();
    if (!this.lines.length || this.o.maxBlankLines < 1) return;
    let blanks = 0;
    for (let i = this.lines.length - 1; i >= 0 && this.lines[i] === ''; i--) blanks++;
    if (blanks < this.o.maxBlankLines) this.lines.push('');
  }

  private emit(text: string, space: boolean): void {
    if (this.forcedBreak) { this.newline(); this.forcedBreak = false; }
    if (this.cur === '') { this.curIndent = this.level; this.cur = text; }
    else this.cur += (space ? ' ' : '') + text;
  }

  private emitAt(level: number, text: string): void {
    this.newline();
    this.level = level;
    this.emit(text, false);
  }

  // ---------------------------------------------------------------- lookups

  private peekSig(k = 1): Token | undefined {
    let found = 0;
    for (let j = this.idx + 1; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.type === 'lcomment' || t.type === 'bcomment') continue;
      if (++found === k) return t;
    }
    return undefined;
  }

  private peekUp(k = 1): string {
    const t = this.peekSig(k);
    return t && t.type === 'word' ? t.text.toUpperCase() : (t ? t.text : '');
  }

  private top(): Frame | undefined { return this.frames[this.frames.length - 1]; }

  private blockInner(): number {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].kind !== 'caseexpr') return this.frames[i].inner;
    }
    return 0;
  }

  private depth(): number { return this.parens.length; }

  private query(): Query | undefined {
    const q = this.queries[this.queries.length - 1];
    return q && q.depth === this.depth() ? q : undefined;
  }

  private applyCase(word: string, keyword: boolean): string {
    const style = keyword ? this.o.keywordCase : this.o.identifierCase;
    return style === 'upper' ? word.toUpperCase() : style === 'lower' ? word.toLowerCase() : word;
  }

  // ---------------------------------------------------------------- spacing

  private needSpace(t: Token): boolean {
    if (this.cur === '') return false;
    if (this.noSpaceNext) { this.noSpaceNext = false; return false; }
    const p = this.prev;
    if (t.type === 'comma' || t.type === 'semi' || t.type === 'rparen') return false;
    if (['.', '%', '@', '..'].includes(t.text)) return false;
    if (['.', '%', '@', '..'].includes(p.up)) return false;
    if (p.type === 'lparen') return false;
    if (t.type === 'lparen') {
      if (p.type === 'word' || p.type === 'qident' || p.type === 'bind') {
        const q = this.query();
        if (q && q.first === 'INSERT' && q.clause === 'INSERT') return true; // INSERT INTO emp (a, b)
        if (!p.isKeyword || DATATYPES.has(p.up)) return false;              // nvl(...), VARCHAR2(30)
        return true;
      }
      if (p.type === 'rparen') return false;
      return true;
    }
    return true;
  }

  // ---------------------------------------------------------------- dispatcher

  private handle(t: Token): void {
    // keep (at most maxBlankLines) blank lines between statements
    if (t.newlinesBefore >= 2 && this.stmtStart && this.lines.length + (this.cur ? 1 : 0) > 0) {
      this.blankLine();
    }
    switch (t.type) {
      case 'lcomment': return this.comment(t, true);
      case 'bcomment': return this.comment(t, false);
      case 'raw': this.newline(); this.lines.push(t.text); this.stmtStart = true; return;
      case 'slash': return this.slash();
      case 'label': this.emitAt(this.level, t.text); this.newline(); this.stmtStart = true; return;
      case 'word': return this.word(t);
      case 'lparen': return this.lparen(t);
      case 'rparen': return this.rparen(t);
      case 'comma': return this.comma(t);
      case 'semi': return this.semi(t);
      case 'op': return this.op(t);
      default: return this.simple(t);
    }
  }

  private setPrev(t: Token, isKeyword = false): void {
    this.prev = { type: t.type, up: t.type === 'word' ? t.text.toUpperCase() : t.text, isKeyword };
  }

  private flushPendingClause(up: string): void {
    const pc = this.pendingClause;
    if (!pc) return;
    const cont: Record<string, string[]> = {
      SELECT: ['DISTINCT', 'UNIQUE', 'ALL'],
      GROUP: ['BY'], ORDER: ['BY', 'SIBLINGS'], CONNECT: ['BY', 'PRIOR', 'NOCYCLE'],
      UNION: ['ALL'], START: ['WITH'], SET: [],
    };
    if ((cont[pc.kw] ?? []).includes(up)) return; // stays on the clause line
    this.pendingClause = null;
    this.newline();
    this.level = pc.q.base + 1;
  }

  private simple(t: Token): void {
    this.flushPendingClause(t.text);
    this.emit(t.text, this.needSpace(t));
    this.setPrev(t);
    this.stmtStart = false;
  }

  private comment(t: Token, line: boolean): void {
    const multi = t.text.includes('\n');
    if (t.newlinesBefore === 0 && this.cur !== '' && !multi) {
      this.cur += ' ' + t.text;
      if (line) this.forcedBreak = true;
      return;
    }
    // comment that followed ";" (or another line end we created) on the same source line
    if (t.newlinesBefore === 0 && this.cur === '' && this.lines.length && !multi
      && this.lines[this.lines.length - 1] !== '' && this.prev.type !== 'none') {
      this.lines[this.lines.length - 1] += ' ' + t.text;
      return;
    }
    this.newline();
    if (this.pendingClause) { /* keep comment at clause content level */ this.level = this.pendingClause.q.base + 1; }
    if (multi) {
      const parts = t.text.split('\n');
      this.lines.push(this.indentStr(this.level) + parts[0].trimEnd());
      for (const p of parts.slice(1)) this.lines.push(p.trimEnd());
      return;
    }
    this.emit(t.text, false);
    this.forcedBreak = true;
  }

  private slash(): void {
    this.newline();
    this.lines.push('/');
    this.frames = []; this.queries = []; this.parens = [];
    this.header = null; this.level = 0; this.stmtStart = true; this.stmtFirst = '';
    this.pendingThen = null; this.pendingClause = null;
    this.prev = { type: 'none', up: '', isKeyword: false };
  }

  // ---------------------------------------------------------------- words

  private word(t: Token): void {
    const up = t.text.toUpperCase();
    const afterDot = this.prev.up === '.' || this.prev.up === '%';
    const isKw = !afterDot && (KEYWORDS.has(up) || DATATYPES.has(up));
    const text = afterDot && (up === 'ROWTYPE' || up === 'TYPE' || up === 'ROWCOUNT' || up === 'FOUND'
      || up === 'NOTFOUND' || up === 'ISOPEN' || up === 'BULK_ROWCOUNT' || up === 'BULK_EXCEPTIONS')
      ? this.applyCase(t.text, true)
      : this.applyCase(t.text, isKw);

    if (this.stmtStart && !this.stmtFirst) this.stmtFirst = up;
    if (!isKw) { this.flushPendingClause(up); this.write(t, text, false); return; }

    const q = this.query();
    const top = this.top();
    const hdr = this.header;

    // ---- header detection: CREATE [OR REPLACE] ... PROCEDURE / PACKAGE / TRIGGER / TABLE / VIEW
    if (up === 'CREATE' && this.stmtStart) {
      this.header = { base: this.level, kind: 'pending', listDone: false };
      this.newline();
      return this.write(t, text, true);
    }
    if (hdr && hdr.kind === 'pending') {
      const kinds: Record<string, HeaderKind> = {
        PROCEDURE: 'proc', FUNCTION: 'proc', PACKAGE: 'proc', TRIGGER: 'trigger',
        TABLE: 'table', VIEW: 'view', TYPE: 'type',
      };
      if (kinds[up]) hdr.kind = kinds[up];
      else if (!['OR', 'REPLACE', 'EDITIONABLE', 'NONEDITIONABLE', 'FORCE', 'NO', 'GLOBAL', 'TEMPORARY',
        'PRIVATE', 'MATERIALIZED', 'UNIQUE', 'BITMAP', 'PUBLIC'].includes(up)) hdr.kind = 'other';
    }
    if (hdr && hdr.kind === 'type' && up === 'BODY') hdr.kind = 'proc';
    if ((up === 'PROCEDURE' || up === 'FUNCTION') && this.stmtStart && !hdr) {
      this.header = { base: this.level, kind: 'proc', listDone: false };
    }

    // ---- trigger header lines
    if (hdr && hdr.kind === 'trigger' && ['BEFORE', 'AFTER', 'INSTEAD', 'FOR', 'REFERENCING', 'WHEN', 'FOLLOWS'].includes(up)
      && !(up === 'FOR' && this.prev.up === 'INSTEAD')) {
      this.emitAt(hdr.base + 1, text);
      this.level = hdr.base + 1;
      return this.after(t);
    }

    // ---- CASE / WHEN / THEN / ELSE / END (also inside SQL)
    if (up === 'CASE' && this.prev.up !== 'END') {
      this.flushPendingClause(up);
      if (this.stmtStart && !q) {
        this.newline();
        const base = this.level;
        this.emit(text, false);
        this.frames.push({ kind: 'casestmt', base, inner: base + 2 });
      } else {
        const base = this.cur === '' ? this.level : this.curIndent;
        this.emit(text, this.needSpace(t));
        this.frames.push({ kind: 'caseexpr', base, inner: base + 1, levelBefore: this.level });
      }
      return this.after(t);
    }
    if (up === 'WHEN' && top) {
      if (top.kind === 'caseexpr') { this.emitAt(top.base + 1, text); return this.after(t); }
      if (top.kind === 'casestmt') { this.emitAt(top.base + 1, text); this.pendingThen = 'casestmt'; return this.after(t); }
      if (top.kind === 'exception' && this.prev.up !== 'EXIT' && this.prev.up !== 'CONTINUE') {
        this.emitAt(top.base + 1, text); this.pendingThen = 'handler'; return this.after(t);
      }
    }
    if (up === 'THEN' && this.pendingThen && top) {
      this.emit(text, true);
      if (this.pendingThen === 'if') this.level = top.inner;
      else { this.level = top.base + 2; top.inner = top.base + 2; }
      this.pendingThen = null;
      this.newline();
      this.after(t);
      this.stmtStart = true;
      return;
    }
    if (up === 'ELSE' && top) {
      if (top.kind === 'caseexpr') { this.emitAt(top.base + 1, text); return this.after(t); }
      if (top.kind === 'casestmt' || top.kind === 'if') {
        const at = top.kind === 'if' ? top.base : top.base + 1;
        this.emitAt(at, text);
        this.level = top.kind === 'if' ? top.inner : top.base + 2;
        this.newline();
        this.after(t);
        this.stmtStart = true;
        return;
      }
    }
    if (up === 'ELSIF' && top && top.kind === 'if') {
      this.emitAt(top.base, text);
      this.pendingThen = 'if';
      return this.after(t);
    }
    if (up === 'END') return this.end(t, text);

    // ---- PL/SQL blocks
    if (up === 'IF' && this.prev.up !== 'END' && !q) {
      this.newline();
      this.frames.push({ kind: 'if', base: this.level, inner: this.level + 1 });
      this.emit(text, false);
      this.pendingThen = 'if';
      return this.after(t);
    }
    if (up === 'LOOP' && this.prev.up !== 'END') {
      const base = this.cur === '' ? this.level : this.curIndent;
      this.emit(text, this.needSpace(t));
      this.frames.push({ kind: 'loop', base, inner: base + 1 });
      this.level = base + 1;
      this.newline();
      this.after(t);
      this.stmtStart = true;
      return;
    }
    if (up === 'DECLARE' && !q) {
      const base = hdr ? hdr.base : this.level;
      this.header = null;
      this.emitAt(base, text);
      this.frames.push({ kind: 'declare', base, inner: base + 1, awaitingBegin: true });
      this.level = base + 1;
      this.newline();
      this.after(t);
      this.stmtStart = true;
      return;
    }
    if (up === 'BEGIN' && !q) {
      this.header = null;
      if (top && top.awaitingBegin) {
        this.emitAt(top.base, text);
        top.kind = 'begin';
        top.awaitingBegin = false;
        top.inner = top.base + 1;
        this.level = top.inner;
      } else {
        const base = hdr ? hdr.base : this.level;
        this.emitAt(base, text);
        this.frames.push({ kind: 'begin', base, inner: base + 1 });
        this.level = base + 1;
      }
      this.newline();
      this.after(t);
      this.stmtStart = true;
      this.pendingThen = null;
      return;
    }
    if (up === 'EXCEPTION' && top && top.kind === 'begin' && this.peekSig()?.type !== 'semi' && !q) {
      this.emitAt(top.base, text);
      top.kind = 'exception';
      top.inner = top.base + 1;
      this.level = top.base + 1;
      this.newline();
      this.after(t);
      this.stmtStart = true;
      return;
    }
    if ((up === 'IS' || up === 'AS') && hdr && hdr.kind === 'proc' && !q
      && !['OBJECT', 'TABLE', 'VARRAY', 'LANGUAGE', 'EXTERNAL', 'RECORD', 'REF'].includes(this.peekUp())) {
      this.emit(text, true);
      this.frames.push({ kind: 'is', base: hdr.base, inner: hdr.base + 1, awaitingBegin: true });
      this.level = hdr.base + 1;
      this.header = null;
      this.newline();
      this.after(t);
      this.stmtStart = true;
      return;
    }
    if (up === 'FORALL') this.forallPending = true;

    // ---- SQL statements
    const suppressDml = (hdr && (hdr.kind === 'trigger' || hdr.kind === 'table'))
      || ['GRANT', 'REVOKE', 'AUDIT', 'NOAUDIT', 'COMMENT', 'ALTER', 'DROP'].includes(this.stmtFirst);
    if (q && !q.started && up === q.first) {
      q.started = true;
      this.emit(text, this.needSpace(t));
      if (up === 'SELECT') this.pendingClause = { q, kw: 'SELECT' };
      return this.after(t, true);
    }
    const startsDml = !q && !suppressDml && (
      (up === 'SELECT') ||
      (up === 'WITH' && (this.stmtStart || ['AS', 'IS', 'FOR'].includes(this.prev.up))) ||
      (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(up) && (this.stmtStart || this.forallPending))
    );
    if (startsDml) {
      this.flushPendingClause(up);
      let base = this.level;
      if (!this.stmtStart) {
        base = hdr && (hdr.kind === 'view' || hdr.kind === 'table') ? hdr.base : this.level + 1;
        this.newline();
      }
      this.forallPending = false;
      const nq: Query = { first: up, base, depth: this.depth(), clause: up, started: true, between: false };
      this.queries.push(nq);
      this.level = base;
      this.emit(text, this.needSpace(t));
      if (up === 'SELECT') this.pendingClause = { q: nq, kw: 'SELECT' };
      return this.after(t, true);
    }

    if (q) {
      // clause keywords
      if (CLAUSE_STARTERS.has(up) && this.isClause(q, up)) {
        this.pendingClause = null;
        this.emitAt(q.base, text);
        q.clause = up;
        q.between = false;
        const inline = ['INTO', 'VALUES', 'FETCH', 'OFFSET', 'BULK', 'USING', 'RETURNING'].includes(up);
        if (inline) this.level = q.base + 1;
        else this.pendingClause = { q, kw: up };
        return this.after(t, true);
      }
      if (up === 'WHEN' && q.first === 'MERGE') { this.emitAt(q.base, text); return this.after(t, true); }
      if (up === 'ON' && q.first === 'MERGE' && q.clause === 'USING') { this.emitAt(q.base, text); return this.after(t, true); }
      // joins
      if (q.clause === 'FROM' && JOIN_WORDS.has(up)
        && !(up === 'JOIN' && (JOIN_WORDS.has(this.prev.up) || this.prev.up === 'OUTER'))) {
        this.flushPendingClause(up);
        this.emitAt(q.base + 1, text);
        return this.after(t, true);
      }
      if (up === 'BETWEEN') q.between = true;
      if ((up === 'AND' || up === 'OR') && this.o.breakAndOr && (q.clause === 'WHERE' || q.clause === 'HAVING')) {
        if (up === 'AND' && q.between) { q.between = false; }
        else {
          this.flushPendingClause(up);
          this.emitAt(q.base + 1, text);
          return this.after(t, true);
        }
      }
    }

    this.flushPendingClause(up);
    this.write(t, text, true);
  }

  private isClause(q: Query, up: string): boolean {
    const next = this.peekUp();
    switch (up) {
      case 'SELECT': return q.first !== 'SELECT' || q.clause !== 'SELECT' ? true : false;
      case 'GROUP': case 'ORDER': return next === 'BY';
      case 'CONNECT': return next === 'BY';
      case 'START': return next === 'WITH';
      case 'SET': return q.first === 'UPDATE' || q.first === 'MERGE';
      case 'USING': return q.first === 'MERGE';
      case 'FROM': return this.prev.up !== 'DELETE';
      case 'INTO': return !['INSERT', 'MERGE', 'COLLECT', 'ALL'].includes(this.prev.up);
      case 'BULK': return q.first === 'SELECT' || q.clause === 'RETURNING';
      case 'WINDOW': return false;
      default: return true;
    }
  }

  private end(t: Token, text: string): void {
    const top = this.top();
    this.pendingClause = null;
    if (!top) return this.write(t, text, true);
    if (top.kind === 'caseexpr') {
      this.emitAt(top.base, text);
      this.frames.pop();
      this.level = top.levelBefore ?? top.base;
      return this.after(t);
    }
    this.emitAt(top.base, text);
    this.frames.pop();
    this.level = top.base;
    this.queries = this.queries.filter(q => q.depth < this.depth());
    if (top.kind === 'if' || top.kind === 'loop' || top.kind === 'casestmt') {
      const nextUp = this.peekUp();
      if (['IF', 'LOOP', 'CASE'].includes(nextUp)) {
        this.idx++;
        while (this.toks[this.idx].type !== 'word') { this.handle(this.toks[this.idx]); this.idx++; }
        this.emit(this.applyCase(this.toks[this.idx].text, true), true);
      }
    }
    this.after(t);
  }

  private write(t: Token, text: string, isKw: boolean): void {
    this.emit(text, this.needSpace(t));
    this.after(t, isKw);
  }

  private after(t: Token, isKw = true): void {
    this.setPrev(t, isKw && t.type === 'word');
    this.stmtStart = false;
  }

  // ---------------------------------------------------------------- punctuation

  private lparen(t: Token): void {
    this.flushPendingClause('(');
    const space = this.needSpace(t);
    const hdr = this.header;
    const nextUp = this.peekUp();
    if (hdr && (hdr.kind === 'proc' || hdr.kind === 'table') && !hdr.listDone && this.depth() === 0) {
      hdr.listDone = true;
      this.emit('(', this.cur !== '');
      this.parens.push({ kind: 'list', levelBefore: this.level, lineIndent: this.curIndent });
      this.level = this.curIndent + 1;
      this.newline();
    } else if (nextUp === 'SELECT' || nextUp === 'WITH') {
      this.emit('(', space);
      const lineIndent = this.curIndent;
      this.parens.push({ kind: 'sub', levelBefore: this.level, lineIndent });
      this.queries.push({ first: nextUp, base: lineIndent + 1, depth: this.depth(), clause: nextUp, started: false, between: false });
      this.level = lineIndent + 1;
      this.newline();
    } else {
      this.emit('(', space);
      this.parens.push({ kind: 'inline', levelBefore: this.level, lineIndent: this.curIndent });
    }
    this.setPrev(t);
    this.stmtStart = false;
  }

  private rparen(t: Token): void {
    const p = this.parens.pop();
    if (!p || p.kind === 'inline') {
      // close any CASE expression opened inside these parens on the same line
      this.emit(')', false);
    } else {
      if (p.kind === 'sub') {
        const d = this.depth();
        this.queries = this.queries.filter(q => q.depth <= d);
      }
      this.pendingClause = null;
      this.emitAt(p.lineIndent, ')');
      this.level = p.levelBefore;
    }
    this.setPrev(t);
    this.stmtStart = false;
  }

  private comma(t: Token): void {
    const p = this.parens[this.parens.length - 1];
    const q = this.query();
    const breakList = (p && p.kind === 'list')
      || (q && ['SELECT', 'GROUP', 'ORDER', 'SET', 'RETURNING', 'FROM', 'WITH'].includes(q.clause) && !this.pendingClause);
    if (breakList) {
      if (this.o.commaPosition === 'leading') {
        this.newline();
        if (q && q.clause === 'WITH') this.level = q.base;
        this.emit(',', false);
      } else {
        this.emit(',', false);
        this.newline();
        if (q && q.clause === 'WITH' && !(p && p.kind === 'list')) this.level = q.base;
      }
    } else {
      this.emit(',', false);
    }
    this.setPrev(t);
  }

  private semi(t: Token): void {
    this.pendingClause = null;
    this.emit(';', false);
    this.queries = [];
    this.parens = [];
    this.header = null;
    this.pendingThen = null;
    this.forallPending = false;
    this.level = this.blockInner();
    this.newline();
    this.stmtStart = true;
    this.stmtFirst = '';
    this.setPrev(t);
  }

  private op(t: Token): void {
    this.flushPendingClause(t.text);
    const p = this.prev;
    const unary = (t.text === '-' || t.text === '+')
      && (p.type === 'none' || p.type === 'op' || p.type === 'lparen' || p.type === 'comma'
        || (p.type === 'word' && p.isKeyword));
    this.emit(t.text, this.needSpace(t));
    if (unary || t.text === '.' || t.text === '%' || t.text === '@' || t.text === '..') this.noSpaceNext = true;
    this.setPrev(t);
    this.stmtStart = false;
  }
}

/**
 * Safety check: the formatter may only change whitespace and letter case.
 * Returns true when both texts contain the same tokens (ignoring case of words).
 */
export function sameTokens(a: string, b: string): boolean {
  const norm = (s: string) => tokenize(s).map(t =>
    t.type === 'word' ? t.text.toUpperCase()
      : t.type === 'bind' ? t.text.toUpperCase()
        : t.type === 'lcomment' || t.type === 'bcomment' || t.type === 'raw' ? t.text.replace(/\s+/g, ' ').trim()
          : t.text);
  const x = norm(a), y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
