import * as vscode from 'vscode';
import { format, sameTokens, FormatOptions, DEFAULT_OPTIONS } from './formatter';

const LANGUAGES = ['sql', 'plsql', 'oraclesql', 'oracle-sql', 'oracle_sql'];

function readOptions(doc: vscode.TextDocument, editorOpts?: vscode.FormattingOptions): FormatOptions {
  const c = vscode.workspace.getConfiguration('sqlPlsqlFormatter', doc.uri);
  const useEditorIndent = c.get<boolean>('useEditorIndentation', false);
  return {
    indentSize: useEditorIndent && editorOpts ? editorOpts.tabSize : c.get<number>('indentSize', DEFAULT_OPTIONS.indentSize),
    useTabs: useEditorIndent && editorOpts ? !editorOpts.insertSpaces : c.get<boolean>('useTabs', DEFAULT_OPTIONS.useTabs),
    keywordCase: c.get('keywordCase', DEFAULT_OPTIONS.keywordCase),
    identifierCase: c.get('identifierCase', DEFAULT_OPTIONS.identifierCase),
    commaPosition: c.get('commaPosition', DEFAULT_OPTIONS.commaPosition),
    breakAndOr: c.get<boolean>('breakAndOr', DEFAULT_OPTIONS.breakAndOr),
    maxBlankLines: c.get<number>('maxBlankLines', DEFAULT_OPTIONS.maxBlankLines),
  };
}

/** Formats text; returns undefined (and warns) if the result would change anything but whitespace/case. */
function safeFormat(text: string, opts: FormatOptions): string | undefined {
  try {
    const out = format(text, opts);
    if (!sameTokens(text, out)) {
      vscode.window.showWarningMessage('SQL/PL-SQL Formatter: this code could not be formatted safely, so it was left unchanged.');
      return undefined;
    }
    return out;
  } catch (e) {
    vscode.window.showWarningMessage('SQL/PL-SQL Formatter: formatting failed — ' + (e as Error).message);
    return undefined;
  }
}

function formatRange(doc: vscode.TextDocument, range: vscode.Range, opts: FormatOptions): vscode.TextEdit[] {
  // Expand to whole lines so indentation stays consistent.
  const full = new vscode.Range(range.start.line, 0, range.end.line, doc.lineAt(range.end.line).text.length);
  const text = doc.getText(full);
  let out = safeFormat(text, opts);
  if (out === undefined) return [];
  const firstLine = doc.lineAt(full.start.line).text;
  const baseIndent = firstLine.slice(0, firstLine.length - firstLine.trimStart().length);
  const isWholeDoc = full.start.line === 0 && full.end.line === doc.lineCount - 1;
  out = out.replace(/\n$/, '');
  if (baseIndent && !isWholeDoc) out = out.split('\n').map(l => (l ? baseIndent + l : l)).join('\n');
  if (text.endsWith('\n')) out += '\n';
  return out === text ? [] : [vscode.TextEdit.replace(full, out)];
}

export function activate(context: vscode.ExtensionContext): void {
  const selector = LANGUAGES.map(language => ({ language }));

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(doc, editorOpts) {
        const last = doc.lineAt(doc.lineCount - 1);
        return formatRange(doc, new vscode.Range(0, 0, last.lineNumber, last.text.length), readOptions(doc, editorOpts));
      },
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
      provideDocumentRangeFormattingEdits(doc, range, editorOpts) {
        return formatRange(doc, range, readOptions(doc, editorOpts));
      },
    }),
    vscode.commands.registerCommand('sqlPlsqlFormatter.format', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const opts = readOptions(doc);
      const sel = editor.selection;
      const range = sel.isEmpty
        ? new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length)
        : new vscode.Range(sel.start, sel.end);
      const edits = formatRange(doc, range, opts);
      if (edits.length) await editor.edit(b => edits.forEach(e => b.replace(e.range, e.newText)));
    }),
  );
}

export function deactivate(): void { /* nothing to clean up */ }
