import {
  File, FilePlus, FolderOpen, Folder, FolderPlus, Save, Play, Square, ListTree, Search, Sigma, Settings, Sun, Moon,
  PanelLeft, PanelRight, PanelBottom, ChevronRight, ChevronDown, ChevronUp, X, ZoomIn, ZoomOut, Maximize, MoveHorizontal,
  RefreshCw, ExternalLink, Crosshair, Italic, Underline, Heading1, Quote, Tag, List, ListOrdered, Image, Table,
  Superscript, Subscript, Radical, Divide, BookOpen, FileText, Undo2, Redo2, CircleAlert, TriangleAlert, Info, Check,
  Trash, Pencil, Command, Hash, Eraser, Type, Braces, Code, Files, FileCode, AtSign, Bookmark, Copy, Scissors,
  ClipboardPaste, TextWrap, Keyboard, CircleStop, ArrowUp, ArrowDown, Grid3x3, Pi, Omega, SquareFunction, LoaderCircle,
  Sparkles, Minus, Plus, WandSparkles, LayoutTemplate, ScanSearch, CaseSensitive, WholeWord, Regex, Replace, SunMoon,
  LocateFixed, Columns2, FileType, Link, Star, Box,
} from 'lucide';

const MAP = {
  file: File, 'file-plus': FilePlus, 'folder-open': FolderOpen, folder: Folder, 'folder-plus': FolderPlus, save: Save,
  play: Play, square: Square, outline: ListTree, search: Search, sigma: Sigma, settings: Settings, sun: Sun, moon: Moon,
  'panel-left': PanelLeft, 'panel-right': PanelRight, 'panel-bottom': PanelBottom, 'chevron-right': ChevronRight,
  'chevron-down': ChevronDown, 'chevron-up': ChevronUp, x: X, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut, maximize: Maximize,
  'fit-width': MoveHorizontal, refresh: RefreshCw, external: ExternalLink, crosshair: Crosshair, italic: Italic,
  underline: Underline, heading: Heading1, quote: Quote, tag: Tag, list: List, 'list-ordered': ListOrdered, image: Image,
  table: Table, superscript: Superscript, subscript: Subscript, radical: Radical, divide: Divide, book: BookOpen,
  'file-text': FileText, undo: Undo2, redo: Redo2, error: CircleAlert, warning: TriangleAlert, info: Info, check: Check,
  trash: Trash, pencil: Pencil, command: Command, hash: Hash, eraser: Eraser, type: Type, braces: Braces, code: Code,
  files: Files, 'file-code': FileCode, cite: AtSign, bookmark: Bookmark, copy: Copy, cut: Scissors, paste: ClipboardPaste,
  wrap: TextWrap, keyboard: Keyboard, stop: CircleStop, 'arrow-up': ArrowUp, 'arrow-down': ArrowDown, grid: Grid3x3,
  pi: Pi, omega: Omega, function: SquareFunction, loader: LoaderCircle, sparkles: Sparkles, minus: Minus, plus: Plus,
  wand: WandSparkles, template: LayoutTemplate, 'scan-search': ScanSearch, case: CaseSensitive, word: WholeWord,
  regex: Regex, replace: Replace, theme: SunMoon, locate: LocateFixed, columns: Columns2, 'file-type': FileType,
  link: Link, star: Star, box: Box,
};

const cache = new Map();
function toSvg(node, size, stroke) {
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="ico" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export function iconHtml(name, size = 16, stroke = 1.75) {
  const key = `${name}|${size}|${stroke}`;
  if (!cache.has(key)) {
    const node = MAP[name];
    cache.set(key, node ? toSvg(node, size, stroke) : '');
  }
  return cache.get(key);
}

export function icon(name, size = 16, stroke = 1.75) {
  const t = document.createElement('template');
  t.innerHTML = iconHtml(name, size, stroke);
  return t.content.firstChild || document.createElement('span');
}
