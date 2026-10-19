// Minimal type declarations for the parts of the VS Code API this extension uses.
// (Kept in the repo so it builds without downloading @types/vscode.)
declare module 'vscode' {
  export interface Disposable { dispose(): unknown; }
  export interface Uri { toString(): string; }
  export class Position {
    constructor(line: number, character: number);
    readonly line: number;
    readonly character: number;
  }
  export class Range {
    constructor(start: Position, end: Position);
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    readonly start: Position;
    readonly end: Position;
  }
  export class Selection extends Range { readonly isEmpty: boolean; }
  export interface TextLine { readonly text: string; readonly lineNumber: number; }
  export interface TextDocument {
    readonly uri: Uri;
    readonly lineCount: number;
    getText(range?: Range): string;
    lineAt(line: number): TextLine;
  }
  export class TextEdit {
    static replace(range: Range, newText: string): TextEdit;
    range: Range;
    newText: string;
  }
  export interface FormattingOptions { tabSize: number; insertSpaces: boolean; }
  export interface DocumentFilter { language?: string; }
  export type DocumentSelector = DocumentFilter | DocumentFilter[] | string;
  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;
  export interface DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: unknown): ProviderResult<TextEdit[]>;
  }
  export interface DocumentRangeFormattingEditProvider {
    provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: unknown): ProviderResult<TextEdit[]>;
  }
  export interface TextEditorEdit { replace(location: Range, value: string): void; }
  export interface TextEditor {
    readonly document: TextDocument;
    readonly selection: Selection;
    edit(callback: (editBuilder: TextEditorEdit) => void): Thenable<boolean>;
  }
  export interface WorkspaceConfiguration { get<T>(section: string, defaultValue: T): T; }
  export interface ExtensionContext { readonly subscriptions: { dispose(): unknown }[]; }
  export namespace languages {
    function registerDocumentFormattingEditProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider): Disposable;
    function registerDocumentRangeFormattingEditProvider(selector: DocumentSelector, provider: DocumentRangeFormattingEditProvider): Disposable;
  }
  export namespace workspace {
    function getConfiguration(section?: string, scope?: Uri): WorkspaceConfiguration;
  }
  export namespace window {
    const activeTextEditor: TextEditor | undefined;
    function showWarningMessage(message: string): Thenable<string | undefined>;
  }
  export namespace commands {
    function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
  }
}
interface Thenable<T> { then<R>(onfulfilled?: (value: T) => R | Thenable<R>, onrejected?: (reason: unknown) => R | Thenable<R>): Thenable<R>; }
