// Completion data. Signatures use {arg} for required and [arg] for optional placeholders.

export const COMMANDS = `
\\documentclass[options]{class}
\\documentclass{class}
\\usepackage{package}
\\usepackage[options]{package}
\\RequirePackage{package}
\\begin{env}
\\end{env}
\\part{title}
\\chapter{title}
\\chapter*{title}
\\section{title}
\\section*{title}
\\subsection{title}
\\subsection*{title}
\\subsubsection{title}
\\subsubsection*{title}
\\paragraph{title}
\\subparagraph{title}
\\appendix
\\frontmatter
\\mainmatter
\\backmatter
\\title{text}
\\author{name}
\\date{date}
\\today
\\maketitle
\\tableofcontents
\\listoffigures
\\listoftables
\\abstract
\\thanks{text}
\\and
\\label{key}
\\ref{key}
\\eqref{key}
\\pageref{key}
\\autoref{key}
\\nameref{key}
\\cref{key}
\\Cref{key}
\\cite{key}
\\cite[page]{key}
\\citep{key}
\\citet{key}
\\citeauthor{key}
\\citeyear{key}
\\parencite{key}
\\textcite{key}
\\autocite{key}
\\footcite{key}
\\nocite{key}
\\bibliography{file}
\\bibliographystyle{style}
\\addbibresource{file.bib}
\\printbibliography
\\footnote{text}
\\footnotemark
\\footnotetext{text}
\\marginpar{text}
\\input{file}
\\include{file}
\\includeonly{file}
\\subfile{file}
\\includegraphics{file}
\\includegraphics[width=\\linewidth]{file}
\\includegraphics[width=0.8\\textwidth]{file}
\\includepdf[pages=-]{file}
\\caption{text}
\\caption[short]{text}
\\centering
\\raggedright
\\raggedleft
\\textbf{text}
\\textit{text}
\\textsl{text}
\\textsc{text}
\\texttt{text}
\\textsf{text}
\\textrm{text}
\\textup{text}
\\textmd{text}
\\textnormal{text}
\\emph{text}
\\underline{text}
\\uline{text}
\\sout{text}
\\textcolor{color}{text}
\\color{color}
\\colorbox{color}{text}
\\fcolorbox{frame}{bg}{text}
\\highlight{text}
\\hl{text}
\\textsuperscript{text}
\\textsubscript{text}
\\bfseries
\\itshape
\\slshape
\\scshape
\\ttfamily
\\sffamily
\\rmfamily
\\normalfont
\\tiny
\\scriptsize
\\footnotesize
\\small
\\normalsize
\\large
\\Large
\\LARGE
\\huge
\\Huge
\\item
\\item[label]
\\newline
\\linebreak
\\pagebreak
\\newpage
\\clearpage
\\cleardoublepage
\\noindent
\\indent
\\par
\\hspace{length}
\\hspace*{length}
\\vspace{length}
\\vspace*{length}
\\hfill
\\vfill
\\quad
\\qquad
\\smallskip
\\medskip
\\bigskip
\\hline
\\cline{i-j}
\\toprule
\\midrule
\\bottomrule
\\cmidrule{i-j}
\\multicolumn{n}{align}{text}
\\multirow{n}{width}{text}
\\newcommand{\\name}{definition}
\\newcommand{\\name}[n]{definition}
\\renewcommand{\\name}{definition}
\\providecommand{\\name}{definition}
\\newenvironment{name}{begin}{end}
\\renewenvironment{name}{begin}{end}
\\DeclareMathOperator{\\name}{text}
\\newtheorem{name}{title}
\\newtheorem{name}{title}[counter]
\\setlength{\\length}{value}
\\addtolength{\\length}{value}
\\setcounter{counter}{value}
\\addtocounter{counter}{value}
\\stepcounter{counter}
\\arabic{counter}
\\roman{counter}
\\Roman{counter}
\\alph{counter}
\\Alph{counter}
\\value{counter}
\\thepage
\\pagestyle{style}
\\thispagestyle{style}
\\pagenumbering{style}
\\geometry{options}
\\hypersetup{options}
\\url{url}
\\href{url}{text}
\\hyperref[key]{text}
\\definecolor{name}{model}{spec}
\\linespread{factor}
\\baselinestretch
\\textwidth
\\linewidth
\\textheight
\\columnwidth
\\paperwidth
\\parindent
\\parskip
\\LaTeX
\\TeX
\\ldots
\\dots
\\verb|text|
\\mbox{text}
\\makebox[width]{text}
\\fbox{text}
\\framebox[width]{text}
\\parbox{width}{text}
\\raisebox{lift}{text}
\\rule{width}{height}
\\phantom{text}
\\hphantom{text}
\\vphantom{text}
\\newpage
\\resizebox{width}{height}{content}
\\scalebox{factor}{content}
\\rotatebox{angle}{content}
\\graphicspath{{dir/}}
\\subcaption{text}
\\subfloat[caption]{content}
\\lstinputlisting{file}
\\inputminted{lang}{file}
\\mintinline{lang}{code}
\\lstinline|code|
\\todo{text}
\\frac{num}{den}
\\dfrac{num}{den}
\\tfrac{num}{den}
\\cfrac{num}{den}
\\binom{n}{k}
\\sqrt{x}
\\sqrt[n]{x}
\\sum
\\sum_{i=1}^{n}
\\prod_{i=1}^{n}
\\int
\\int_{a}^{b}
\\iint
\\iiint
\\oint
\\lim_{x \\to \\infty}
\\limsup
\\liminf
\\max
\\min
\\sup
\\inf
\\arg\\max
\\arg\\min
\\argmax
\\argmin
\\det
\\exp
\\log
\\ln
\\sin
\\cos
\\tan
\\cot
\\sec
\\csc
\\arcsin
\\arccos
\\arctan
\\sinh
\\cosh
\\tanh
\\mathbf{x}
\\mathrm{x}
\\mathit{x}
\\mathsf{x}
\\mathtt{x}
\\mathcal{X}
\\mathbb{R}
\\mathfrak{g}
\\mathscr{L}
\\boldsymbol{x}
\\bm{x}
\\operatorname{name}
\\text{text}
\\hat{x}
\\widehat{x}
\\bar{x}
\\overline{x}
\\underline{x}
\\tilde{x}
\\widetilde{x}
\\vec{x}
\\dot{x}
\\ddot{x}
\\check{x}
\\breve{x}
\\acute{x}
\\grave{x}
\\overrightarrow{AB}
\\overleftarrow{AB}
\\overbrace{x}^{text}
\\underbrace{x}_{text}
\\stackrel{top}{rel}
\\overset{top}{x}
\\underset{bottom}{x}
\\left(
\\right)
\\left[
\\right]
\\left\\{
\\right\\}
\\left|
\\right|
\\left.
\\right.
\\big(
\\big)
\\Big(
\\Big)
\\bigg(
\\bigg)
\\Bigg(
\\Bigg)
\\langle
\\rangle
\\lfloor
\\rfloor
\\lceil
\\rceil
\\lvert
\\rvert
\\lVert
\\rVert
\\middle|
\\displaystyle
\\textstyle
\\scriptstyle
\\limits
\\nolimits
\\tag{text}
\\notag
\\nonumber
\\intertext{text}
\\substack{a \\\\ b}
\\pmod{n}
\\bmod
\\mod
\\cdot
\\cdots
\\vdots
\\ddots
\\ldots
\\times
\\div
\\pm
\\mp
\\ast
\\star
\\circ
\\bullet
\\oplus
\\ominus
\\otimes
\\odot
\\cap
\\cup
\\setminus
\\wedge
\\vee
\\neg
\\leq
\\geq
\\le
\\ge
\\neq
\\ne
\\approx
\\equiv
\\sim
\\simeq
\\cong
\\propto
\\ll
\\gg
\\subset
\\supset
\\subseteq
\\supseteq
\\in
\\notin
\\ni
\\forall
\\exists
\\nexists
\\emptyset
\\varnothing
\\infty
\\partial
\\nabla
\\Delta
\\prime
\\top
\\bot
\\mid
\\parallel
\\perp
\\angle
\\triangle
\\rightarrow
\\leftarrow
\\Rightarrow
\\Leftarrow
\\leftrightarrow
\\Leftrightarrow
\\to
\\gets
\\mapsto
\\implies
\\iff
\\uparrow
\\downarrow
\\longrightarrow
\\Longrightarrow
\\hookrightarrow
\\rightleftharpoons
\\xrightarrow{text}
\\xleftarrow{text}
\\alpha
\\beta
\\gamma
\\delta
\\epsilon
\\varepsilon
\\zeta
\\eta
\\theta
\\vartheta
\\iota
\\kappa
\\lambda
\\mu
\\nu
\\xi
\\pi
\\varpi
\\rho
\\varrho
\\sigma
\\varsigma
\\tau
\\upsilon
\\phi
\\varphi
\\chi
\\psi
\\omega
\\Gamma
\\Delta
\\Theta
\\Lambda
\\Xi
\\Pi
\\Sigma
\\Upsilon
\\Phi
\\Psi
\\Omega
\\ell
\\hbar
\\Re
\\Im
\\aleph
\\wp
\\mathbb{E}
\\mathbb{P}
\\mathbb{N}
\\mathbb{Z}
\\mathbb{Q}
\\mathbb{C}
\\checkmark
\\ding{51}
\\textdegree
\\SI{value}{unit}
\\si{unit}
\\num{number}
\\qty{value}{unit}
\\ang{angle}
\\degree
\\celsius
\\percent
\\usetikzlibrary{library}
\\tikz
\\draw
\\node
\\fill
\\path
\\coordinate
\\foreach
\\addplot
\\pause
\\frametitle{title}
\\framesubtitle{text}
\\titlepage
\\usetheme{theme}
\\usecolortheme{theme}
\\institute{text}
\\only<n>{text}
\\onslide<n>{text}
\\uncover<n>{text}
\\alert{text}
\\column{width}
\\ctexset{options}
\\songti
\\heiti
\\kaishu
\\fangsong
\\setmainfont{font}
\\setsansfont{font}
\\setmonofont{font}
\\setCJKmainfont{font}
\\IEEEauthorblockN{name}
\\IEEEauthorblockA{affiliation}
\\IEEEPARstart{A}{text}
\\IEEEoverridecommandlockouts
\\IEEEpeerreviewmaketitle
\\keywords{text}
\\acknowledgments
\\lipsum
\\blindtext
`.trim().split('\n');

export const ENVIRONMENTS = [
  'document', 'abstract', 'itemize', 'enumerate', 'description', 'figure', 'figure*', 'table', 'table*', 'tabular',
  'tabular*', 'tabularx', 'longtable', 'array', 'equation', 'equation*', 'align', 'align*', 'aligned', 'gather', 'gather*',
  'gathered', 'multline', 'multline*', 'split', 'cases', 'dcases', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix',
  'Vmatrix', 'smallmatrix', 'subequations', 'flalign', 'alignat', 'eqnarray', 'center', 'flushleft', 'flushright',
  'quote', 'quotation', 'verse', 'verbatim', 'lstlisting', 'minted', 'minipage', 'subfigure', 'subtable', 'wrapfigure',
  'theorem', 'lemma', 'proof', 'definition', 'corollary', 'proposition', 'remark', 'example', 'assumption', 'problem',
  'algorithm', 'algorithmic', 'algorithm2e', 'thebibliography', 'tikzpicture', 'axis', 'scope', 'frame', 'block',
  'alertblock', 'exampleblock', 'columns', 'column', 'titlepage', 'appendix', 'appendices', 'landscape', 'comment',
  'small', 'footnotesize', 'tcolorbox', 'IEEEkeywords', 'IEEEbiography', 'IEEEeqnarray', 'keywords', 'acknowledgements',
  'threeparttable', 'tablenotes', 'adjustbox', 'resizebox', 'multicols', 'spacing', 'singlespace', 'onehalfspace',
];

// Snippet bodies for \begin{env}; "|" marks the cursor.
export const ENV_BODIES = {
  itemize: '\t\\item |',
  enumerate: '\t\\item |',
  description: '\t\\item[|] ',
  figure: '\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{|}\n\t\\caption{}\n\t\\label{fig:}',
  'figure*': '\t\\centering\n\t\\includegraphics[width=\\textwidth]{|}\n\t\\caption{}\n\t\\label{fig:}',
  table: '\t\\centering\n\t\\caption{|}\n\t\\label{tab:}\n\t\\begin{tabular}{cc}\n\t\t\\hline\n\t\t &  \\\\\n\t\t\\hline\n\t\\end{tabular}',
  tabular: '\t|',
  frame: '\t\\frametitle{|}\n\t',
  cases: '\t| & \\\\\n\t & ',
};
export const ENV_ARGS = {
  figure: '[htbp]', 'figure*': '[t]', table: '[htbp]', 'table*': '[t]', tabular: '{cc}', tabularx: '{\\linewidth}{XX}',
  minipage: '{0.48\\linewidth}', subfigure: '{0.48\\linewidth}', array: '{cc}', wrapfigure: '{r}{0.4\\linewidth}',
  multicols: '{2}', column: '{0.5\\textwidth}', tcolorbox: '[title=]', alignat: '{2}',
};

export const PACKAGES = [
  'amsmath', 'amssymb', 'amsthm', 'amsfonts', 'mathtools', 'bm', 'graphicx', 'xcolor', 'color', 'hyperref', 'cleveref',
  'geometry', 'fancyhdr', 'booktabs', 'multirow', 'multicol', 'tabularx', 'longtable', 'array', 'makecell', 'threeparttable',
  'caption', 'subcaption', 'subfig', 'float', 'wrapfig', 'placeins', 'tikz', 'pgfplots', 'pgf', 'circuitikz', 'listings',
  'minted', 'algorithm', 'algorithmic', 'algpseudocode', 'algorithm2e', 'natbib', 'biblatex', 'cite', 'url', 'xurl',
  'enumitem', 'setspace', 'parskip', 'titlesec', 'titletoc', 'tocloft', 'appendix', 'lipsum', 'blindtext', 'siunitx',
  'physics', 'cancel', 'esint', 'mathrsfs', 'dsfont', 'upgreek', 'ctex', 'xeCJK', 'fontspec', 'inputenc', 'fontenc',
  'babel', 'csquotes', 'microtype', 'lmodern', 'times', 'newtxtext', 'newtxmath', 'mathptmx', 'palatino', 'helvet',
  'courier', 'textcomp', 'gensymb', 'ulem', 'soul', 'tcolorbox', 'mdframed', 'framed', 'adjustbox', 'rotating', 'pdflscape',
  'pdfpages', 'epstopdf', 'standalone', 'subfiles', 'import', 'xparse', 'etoolbox', 'ifthen', 'calc', 'xspace', 'todonotes',
  'comment', 'verbatim', 'fancyvrb', 'lineno', 'footmisc', 'datetime', 'chngcntr', 'nomencl', 'glossaries', 'acronym',
  'makeidx', 'imakeidx', 'balance', 'stfloats', 'dblfloatfix', 'flushend', 'IEEEtrantools', 'pifont', 'bbding', 'marvosym',
  'fontawesome5', 'tabu', 'diagbox', 'colortbl', 'dcolumn', 'arydshln', 'hhline', 'enumerate', 'paralist', 'changes',
  'xr', 'xr-hyper', 'bookmark', 'zref', 'refcount', 'lastpage', 'everypage', 'eso-pic', 'background', 'draftwatermark',
];

export const CLASSES = ['article', 'report', 'book', 'beamer', 'letter', 'ctexart', 'ctexrep', 'ctexbook', 'ctexbeamer', 'IEEEtran', 'elsarticle', 'revtex4-2', 'llncs', 'acmart', 'memoir', 'scrartcl', 'scrreprt', 'scrbook', 'standalone', 'amsart', 'moderncv', 'tufte-book', 'tufte-handout'];

// Ref / cite command detection
export const REF_RE = /\\(?:[a-zA-Z]*ref|cref|Cref|autoref|nameref|labelcref|crefrange|Crefrange|vref|Vref)\*?\{([^{}]*)$/;
export const CITE_RE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|Cite[a-zA-Z]*|nocite|footfullcite)\*?(?:\[[^\]]*\]){0,2}\{([^{}]*)$/;
export const FILE_RE = /\\(input|include|subfile|includegraphics|includepdf|bibliography|addbibresource|lstinputlisting|includeonly|includestandalone)\*?(?:\[[^\]]*\])?\{([^{}]*)$/;
export const PKG_RE = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^{}]*)$/;
export const CLASS_RE = /\\documentclass(?:\[[^\]]*\])?\{([^{}]*)$/;
export const BEGIN_RE = /\\(begin|end)\{([a-zA-Z*]*)$/;
