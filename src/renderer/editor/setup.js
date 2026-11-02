// EditorView / EditorState construction with reconfigurable compartments.
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { foldGutter, indentOnInput, syntaxHighlighting, bracketMatching, foldKeymap, indentUnit } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter, lintKeymap } from '@codemirror/lint';
import { latex, bibtex, latexHighlight } from './latex-lang.js';
import { latexCompletion } from './completion.js';
import { makeLatexEnter, latexHover, spellScope, flashLineField } from './extras.js';

export const cmp = {
  lang: new Compartment(),
  lineNumbers: new Compartment(),
  wrap: new Compartment(),
  tab: new Compartment(),
  closeBrackets: new Compartment(),
  spell: new Compartment(),
  font: new Compartment(),
  readOnly: new Compartment(),
};

export function fontTheme(s) {
  return EditorView.theme({
    '&': { fontSize: s.fontSize + 'px' },
    '.cm-content, .cm-gutters': { fontFamily: `${quoteFont(s.fontFamily)}, 'Cascadia Code', 'JetBrains Mono', Consolas, 'Microsoft YaHei UI', monospace` },
    '.cm-content': { lineHeight: String(s.lineHeight || 1.6) },
    '.cm-gutters': { lineHeight: String(s.lineHeight || 1.6) },
  });
}
function quoteFont(f) { return /^['"]/.test(f) || !/\s/.test(f) ? f : `'${f}'`; }

function langFor(path) {
  if (path && /\.bib$/i.test(path)) return bibtex();
  if (path && /\.(md|txt|py|json|csv)$/i.test(path)) return [];
  return latex();
}

export function dynamicConfig(s, path) {
  return [
    cmp.lang.of(langFor(path)),
    cmp.lineNumbers.of(s.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    cmp.wrap.of(s.wrap ? EditorView.lineWrapping : []),
    cmp.tab.of([indentUnit.of(s.tabSize === 'tab' ? '\t' : ' '.repeat(+s.tabSize || 2)), EditorState.tabSize.of(+s.tabSize || 4)]),
    cmp.closeBrackets.of(s.autoCloseBrackets ? closeBrackets() : []),
    cmp.spell.of(s.spellcheck ? [EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }), spellScope] : [EditorView.contentAttributes.of({ spellcheck: 'false' })]),
    cmp.font.of(fontTheme(s)),
    cmp.readOnly.of([]),
  ];
}

export function createState({ doc, path, settings, appKeymap, onUpdate, extraExtensions = [] }) {
  return EditorState.create({
    doc,
    extensions: [
      Prec.highest(keymap.of(appKeymap)),
      highlightSpecialChars(),
      history(),
      foldGutter({ markerDOM: (open) => { const s = document.createElement('span'); s.className = 'cm-fold-marker ' + (open ? 'open' : 'closed'); return s; } }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(latexHighlight),
      bracketMatching(),
      autocompletion({ override: [latexCompletion], activateOnTyping: true, maxRenderedOptions: 80, icons: true, closeOnBlur: true, defaultKeymap: true, aboveCursor: false }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches({ minSelectionLength: 2 }),
      search({ top: true }),
      lintGutter(),
      latexHover,
      flashLineField,
      Prec.high(keymap.of([{ key: 'Enter', run: makeLatexEnter(() => settings) }])),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        { key: 'Mod-/', run: toggleComment },
      ]),
      ...dynamicConfig(settings, path),
      EditorView.updateListener.of(onUpdate),
      // Dropped files are handled by the app (open / insert \includegraphics), not pasted as text.
      EditorView.domEventHandlers({ drop: (e) => (e.dataTransfer?.files?.length || 0) > 0 }),
      ...extraExtensions,
    ],
  });
}

export function reconfigureAll(states, s) {
  // returns effects to apply for the given settings
  return [
    cmp.lineNumbers.reconfigure(s.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    cmp.wrap.reconfigure(s.wrap ? EditorView.lineWrapping : []),
    cmp.tab.reconfigure([indentUnit.of(s.tabSize === 'tab' ? '\t' : ' '.repeat(+s.tabSize || 2)), EditorState.tabSize.of(+s.tabSize || 4)]),
    cmp.closeBrackets.reconfigure(s.autoCloseBrackets ? closeBrackets() : []),
    cmp.spell.reconfigure(s.spellcheck ? [EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }), spellScope] : [EditorView.contentAttributes.of({ spellcheck: 'false' })]),
    cmp.font.reconfigure(fontTheme(s)),
  ];
}
