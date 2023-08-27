let tree;

let codeInput = `module Button = {
  @react.component
  let make = (~count: int) => {
    let times = switch count {
    | 1 => "once"
    | 2 => "twice"
    | n => Belt.Int.toString(n) ++ " times"
    }
    let msg = "Click me " ++ times

    <button> {msg->React.string} </button>
  }
}`;

let queryInput = `(comment) @comment

; Identifiers
;------------

; Escaped identifiers like \"+."
((value_identifier) @constant.macro
 (#match? @constant.macro "^\\.*$"))

[
  (type_identifier)
  (unit_type)
  (list)
  (list_pattern)
] @type

[
  (variant_identifier)
  (polyvar_identifier)
] @constant

(record_type_field (property_identifier) @property)
(record_field (property_identifier) @property)
(object (field (property_identifier) @property))
(object_type (field (property_identifier) @property))
(member_expression (property_identifier) @property)
(module_identifier) @namespace

; Parameters
;----------------

(list_pattern (value_identifier) @parameter)
(spread_pattern (value_identifier) @parameter)

; String literals
;----------------

[
  (string)
  (template_string)
] @string

(template_substitution
  "$\{" @punctuation.bracket
  "}" @punctuation.bracket) @embedded

(character) @string.special
(escape_sequence) @string.escape

; Other literals
;---------------

[
  (true)
  (false)
] @constant.builtin

(number) @number
(polyvar) @constant
(polyvar_string) @constant

; Functions
;----------

; parameter(s) in parens
[
 (parameter (value_identifier))
 (labeled_parameter (value_identifier))
] @parameter

; single parameter with no parens
(function parameter: (value_identifier) @parameter)

; first-level descructuring (required for nvim-tree-sitter as it only matches direct
; children and the above patterns do not match destructuring patterns in NeoVim)
(parameter (tuple_pattern (tuple_item_pattern (value_identifier) @parameter)))
(parameter (array_pattern (value_identifier) @parameter))
(parameter (record_pattern (value_identifier) @parameter))

; Meta
;-----

(decorator_identifier) @annotation

(extension_identifier) @keyword
("%") @keyword

; Misc
;-----

(subscript_expression index: (string) @property)
(polyvar_type_pattern "#" @constant)

[
  ("include")
  ("open")
] @include

[
  "as"
  "export"
  "external"
  "let"
  "module"
  "mutable"
  "private"
  "rec"
  "type"
  "and"
  "assert"
  "await"
  "with"
  "lazy"
  "constraint"
] @keyword

((function "async" @keyword))

(module_unpack "unpack" @keyword)

[
  "if"
  "else"
  "switch"
  "when"
] @conditional

[
  "exception"
  "try"
  "catch"
] @exception

(call_expression
  function: (value_identifier) @exception
  (#eq? @exception "raise"))

[
  "for"
  "in"
  "to"
  "downto"
  "while"
] @repeat

[
  "."
  ","
  "|"
] @punctuation.delimiter

[
  "++"
  "+"
  "+."
  "-"
  "-."
  "*"
  "**"
  "*."
  "/."
  "<="
  "=="
  "==="
  "!"
  "!="
  "!=="
  ">="
  "&&"
  "||"
  "="
  ":="
  "->"
  "|>"
  ":>"
  "+="
  (uncurry)
] @operator

; Explicitly enclose these operators with binary_expression
; to avoid confusion with JSX tag delimiters
(binary_expression ["<" ">" "/"] @operator)

[
  "("
  ")"
  "{"
  "}"
  "["
  "]"
] @punctuation.bracket

(polyvar_type
  [
   "["
   "[>"
   "[<"
   "]"
  ] @punctuation.bracket)

[
  "~"
  "?"
  "=>"
  ".."
  "..."
] @punctuation.special

(ternary_expression ["?" ":"] @operator)

; JSX
;----------
(jsx_identifier) @tag
(jsx_element
  open_tag: (jsx_opening_element ["<" ">"] @tag.delimiter))
(jsx_element
  close_tag: (jsx_closing_element ["<" "/" ">"] @tag.delimiter))
(jsx_self_closing_element ["/" ">" "<"] @tag.delimiter)
(jsx_fragment [">" "<" "/"] @tag.delimiter)
(jsx_attribute (property_identifier) @tag.attribute)

; Error
;----------

(ERROR) @error`;

(async () => {
  const CAPTURE_REGEX = /@\s*([\w\._-]+)/g;
  const COLORS_BY_INDEX = [
    'gray',
    'blueviolet',
    'darkblue',
    'darkcyan',
    'mediumpurple',
    'darkred',
    'royalblue',
    'green',
    'cyan',
    'indigo',
    'navy',
    'red',
    'sienna',
    'magenta',
    'cornflowerblue',
    'blue',
    'orange',
    'tomato'
  ];

  const codeContainer = document.getElementById("code-container")
  const loggingCheckbox = document.getElementById('logging-checkbox');
  const outputContainer = document.getElementById('output-container');
  const outputContainerScroll = document.getElementById('output-container-scroll');
  const playgroundContainer = document.getElementById('playground-container');
  const queryCheckbox = document.getElementById('query-checkbox');
  const queryContainer = document.getElementById('query-container');
  const updateTimeSpan = document.getElementById('update-time');

  await TreeSitter.init();

  try {
    const url = new URL(window.location.href)
    const params = new URLSearchParams(url.search)
    const code = params.get('code')

    if (code != null) {
      codeInput = decodeURIComponent(code)
    }
  } catch (err) {
    console.log('Failed to decode', code)
    codeInput = code
  }

  const parser = new TreeSitter();
  const codeEditor = CodeMirror(codeContainer, {
    value: codeInput,
    lineNumbers: true,
    showCursorWhenSelecting: true
  });

  const queryEditor = CodeMirror(queryContainer, {
    value: queryInput,
    lineNumbers: true,
    showCursorWhenSelecting: true
  });

  const cluster = new Clusterize({
    rows: [],
    noDataText: null,
    contentElem: outputContainer,
    scrollElem: outputContainerScroll
  });
  const renderTreeOnCodeChange = debounce(renderTree, 50);
  const runTreeQueryOnChange = debounce(runTreeQuery, 50);

  let treeRows = null;
  let treeRowHighlightedIndex = -1;
  let parseCount = 0;
  let isRendering = 0;
  let query;

  codeEditor.on('changes', handleCodeChange);
  codeEditor.on('viewportChange', runTreeQueryOnChange);
  codeEditor.on('cursorActivity', debounce(handleCursorMovement, 150));
  queryEditor.on('changes', debounce(handleQueryChange, 150));

  loggingCheckbox.addEventListener('change', handleLoggingChange);
  queryCheckbox.addEventListener('change', handleQueryEnableChange);
  outputContainer.addEventListener('click', handleTreeClick);

  handleQueryEnableChange();

  playgroundContainer.style.visibility = 'visible';

  const URL_WASM = './tree-sitter-rescript.wasm';
  const ReScript = await TreeSitter.Language.load(URL_WASM);
  parser.setLanguage(ReScript);

  await handleCodeChange();
  handleQueryChange();

  async function handleCodeChange(_editor, changes) {
    const newText = codeEditor.getValue() + '\n';
    const edits = tree && changes && changes.map(treeEditForEditorChange);

    const start = performance.now();
    if (edits) {
      for (const edit of edits) {
        tree.edit(edit);
      }
    }
    const newTree = parser.parse(newText, tree);
    const duration = (performance.now() - start).toFixed(1);

    updateTimeSpan.innerText = `${duration} ms`;
    if (tree) tree.delete();
    tree = newTree;
    parseCount++;
    renderTreeOnCodeChange();
    runTreeQueryOnChange();
  }

  async function renderTree() {
    isRendering++;
    const cursor = tree.walk();

    let currentRenderCount = parseCount;
    let row = '';
    let rows = [];
    let finishedRow = false;
    let visitedChildren = false;
    let indentLevel = 0;

    for (let i = 0; ; i++) {
      if (i > 0 && i % 10000 === 0) {
        await new Promise(r => setTimeout(r, 0));
        if (parseCount !== currentRenderCount) {
          cursor.delete();
          isRendering--;
          return;
        }
      }

      let displayName;
      if (cursor.nodeIsMissing) {
        displayName = `MISSING ${cursor.nodeType}`
      } else if (cursor.nodeIsNamed) {
        displayName = cursor.nodeType;
      }

      if (visitedChildren) {
        if (displayName) {
          finishedRow = true;
        }

        if (cursor.gotoNextSibling()) {
          visitedChildren = false;
        } else if (cursor.gotoParent()) {
          visitedChildren = true;
          indentLevel--;
        } else {
          break;
        }
      } else {
        if (displayName) {
          if (finishedRow) {
            row += '</div>';
            rows.push(row);
            finishedRow = false;
          }
          const start = cursor.startPosition;
          const end = cursor.endPosition;
          const id = cursor.nodeId;
          let fieldName = cursor.currentFieldName();
          if (fieldName) {
            fieldName += ': ';
          } else {
            fieldName = '';
          }
          row = `<div>${'  '.repeat(indentLevel)}${fieldName}<a class='plain' href="#" data-id=${id} data-range="${start.row},${start.column},${end.row},${end.column}">${displayName}</a> [${start.row}, ${start.column}] - [${end.row}, ${end.column}]`;
          finishedRow = true;
        }

        if (cursor.gotoFirstChild()) {
          visitedChildren = false;
          indentLevel++;
        } else {
          visitedChildren = true;
        }
      }
    }
    if (finishedRow) {
      row += '</div>';
      rows.push(row);
    }

    cursor.delete();
    cluster.update(rows);
    treeRows = rows;
    isRendering--;
    handleCursorMovement();
  }

  function runTreeQuery(_, startRow, endRow) {
    if (endRow == null) {
      const viewport = codeEditor.getViewport();
      startRow = viewport.from;
      endRow = viewport.to;
    }

    codeEditor.operation(() => {
      const marks = codeEditor.getAllMarks();
      marks.forEach(m => m.clear());

      if (tree && query) {
        const captures = query.captures(
          tree.rootNode,
          { row: startRow, column: 0 },
          { row: endRow, column: 0 },
        );
        let lastNodeId;
        for (const { name, node } of captures) {
          if (node.id === lastNodeId) continue;
          lastNodeId = node.id;
          const { startPosition, endPosition } = node;
          codeEditor.markText(
            { line: startPosition.row, ch: startPosition.column },
            { line: endPosition.row, ch: endPosition.column },
            {
              inclusiveLeft: true,
              inclusiveRight: true,
              css: `color: ${colorForCaptureName(name)}`
            }
          );
        }
      }
    });
  }

  function handleQueryChange() {
    if (query) {
      query.delete();
      query.deleted = true;
      query = null;
    }

    queryEditor.operation(() => {
      queryEditor.getAllMarks().forEach(m => m.clear());
      if (!queryCheckbox.checked) return;

      const queryText = queryEditor.getValue();

      try {
        query = parser.getLanguage().query(queryText);
        let match;

        let row = 0;
        queryEditor.eachLine((line) => {
          while (match = CAPTURE_REGEX.exec(line.text)) {
            queryEditor.markText(
              { line: row, ch: match.index },
              { line: row, ch: match.index + match[0].length },
              {
                inclusiveLeft: true,
                inclusiveRight: true,
                css: `color: ${colorForCaptureName(match[1])}`
              }
            );
          }
          row++;
        });
      } catch (error) {
        const startPosition = queryEditor.posFromIndex(error.index);
        const endPosition = {
          line: startPosition.line,
          ch: startPosition.ch + (error.length || Infinity)
        };

        if (error.index === queryText.length) {
          if (startPosition.ch > 0) {
            startPosition.ch--;
          } else if (startPosition.row > 0) {
            startPosition.row--;
            startPosition.column = Infinity;
          }
        }

        queryEditor.markText(
          startPosition,
          endPosition,
          {
            className: 'query-error',
            inclusiveLeft: true,
            inclusiveRight: true,
            attributes: { title: error.message }
          }
        );
      }
    });

    runTreeQuery();
  }

  function handleCursorMovement() {
    if (isRendering) return;

    const selection = codeEditor.getDoc().listSelections()[0];
    let start = { row: selection.anchor.line, column: selection.anchor.ch };
    let end = { row: selection.head.line, column: selection.head.ch };
    if (
      start.row > end.row ||
      (
        start.row === end.row &&
        start.column > end.column
      )
    ) {
      let swap = end;
      end = start;
      start = swap;
    }
    const node = tree.rootNode.namedDescendantForPosition(start, end);
    if (treeRows) {
      if (treeRowHighlightedIndex !== -1) {
        const row = treeRows[treeRowHighlightedIndex];
        if (row) treeRows[treeRowHighlightedIndex] = row.replace('highlighted', 'plain');
      }
      treeRowHighlightedIndex = treeRows.findIndex(row => row.includes(`data-id=${node.id}`));
      if (treeRowHighlightedIndex !== -1) {
        const row = treeRows[treeRowHighlightedIndex];
        if (row) treeRows[treeRowHighlightedIndex] = row.replace('plain', 'highlighted');
      }
      cluster.update(treeRows);
      const lineHeight = cluster.options.item_height;
      const scrollTop = outputContainerScroll.scrollTop;
      const containerHeight = outputContainerScroll.clientHeight;
      const offset = treeRowHighlightedIndex * lineHeight;
      if (scrollTop > offset - 20) {
        $(outputContainerScroll).animate({ scrollTop: offset - 20 }, 150);
      } else if (scrollTop < offset + lineHeight + 40 - containerHeight) {
        $(outputContainerScroll).animate({ scrollTop: offset - containerHeight + 40 }, 150);
      }
    }
  }

  function handleTreeClick(event) {
    if (event.target.tagName === 'A') {
      event.preventDefault();
      const [startRow, startColumn, endRow, endColumn] = event
        .target
        .dataset
        .range
        .split(',')
        .map(n => parseInt(n));
      codeEditor.focus();
      codeEditor.setSelection(
        { line: startRow, ch: startColumn },
        { line: endRow, ch: endColumn }
      );
    }
  }

  function handleLoggingChange() {
    if (loggingCheckbox.checked) {
      parser.setLogger((message, lexing) => {
        if (lexing) {
          console.log("  ", message)
        } else {
          console.log(message)
        }
      });
    } else {
      parser.setLogger(null);
    }
  }

  function handleQueryEnableChange() {
    if (queryCheckbox.checked) {
      queryContainer.style.visibility = '';
      queryContainer.style.position = '';
    } else {
      queryContainer.style.visibility = 'hidden';
      queryContainer.style.position = 'absolute';
    }
    handleQueryChange();
  }

  function treeEditForEditorChange(change) {
    const oldLineCount = change.removed.length;
    const newLineCount = change.text.length;
    const lastLineLength = change.text[newLineCount - 1].length;

    const startPosition = { row: change.from.line, column: change.from.ch };
    const oldEndPosition = { row: change.to.line, column: change.to.ch };
    const newEndPosition = {
      row: startPosition.row + newLineCount - 1,
      column: newLineCount === 1
        ? startPosition.column + lastLineLength
        : lastLineLength
    };

    const startIndex = codeEditor.indexFromPos(change.from);
    let newEndIndex = startIndex + newLineCount - 1;
    let oldEndIndex = startIndex + oldLineCount - 1;
    for (let i = 0; i < newLineCount; i++) newEndIndex += change.text[i].length;
    for (let i = 0; i < oldLineCount; i++) oldEndIndex += change.removed[i].length;

    return {
      startIndex, oldEndIndex, newEndIndex,
      startPosition, oldEndPosition, newEndPosition
    };
  }

  function colorForCaptureName(capture) {
    const id = query.captureNames.indexOf(capture);
    return COLORS_BY_INDEX[id % COLORS_BY_INDEX.length];
  }

  function debounce(func, wait, immediate) {
    var timeout;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  }
})();
