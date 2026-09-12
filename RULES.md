# Mind map interaction rules (as implemented)

Updated 2026-09-12. Every rule below is implemented in `src/mindmap/mindmap-input.js`, `src/mindmap/renderer.js`,
`src/mindmap/drag-guides.js`, `src/ui/components/mindmap-pane.js` and `src/core/markdown.js`, and is covered by the
in-browser checks described at the end.

## 1. Structure and source of truth
1.1 A note's markdown is the single source of truth. Headings nest by level; list items nest by indent under the nearest
    heading; paragraphs, blockquotes, code fences and tables are leaf nodes. Every map edit rewrites the markdown, and
    the map re-renders from it (undo/redo through the note history).
1.2 Node ids are stable across text edits (hash of ancestry + position), so selection and collapse state survive edits.
1.3 The root node is the note title. It cannot be deleted, dragged or renamed from the map.

## 2. Opening and view modes
2.1 Clicking a note in the explorer asks: Open as Mind Map, Open as Markdown, Open editor + Mind Map (or a fixed default
    from Settings → General → "Open notes as"). Default view for a note is the full-width mind map.
2.2 The markdown pane is hidden until asked for (document icon in the map header, Mod+M, or the view commands).
2.3 Narrow windows stack the map under the editor; sidebars never take more than 26% of the width each.

## 3. Pointer (Auto tool, default)
3.1 On blank space the pointer is an arrow. Over a node it is a hand.
3.2 Press-and-drag on blank space pans the whole page (hand) until the button is released; release adds a short
    momentum glide. Wheel zooms around the cursor with easing; pinch and one-finger pan work on touch.
3.3 Shift+drag on blank space draws a selection rectangle. The Select tool (V) makes plain drag draw the rectangle;
    the Hand tool (H) makes plain drag always pan. Shift-click adds a node to the selection; plain click or Escape clears it.
3.4 Click selects a node (accent ring). Double-click on a node edits its text inline.

## 4. Creating nodes
4.1 Selected existing node: Enter creates a child; Tab creates a child. F2 edits; Delete/Backspace deletes the subtree.
4.2 While typing in a brand-new node: Enter saves and creates the next sibling; Tab saves and creates a child.
    While typing in an existing node: Enter or Tab saves and creates a child. Escape cancels.
4.2a New file: a new note starts with one heading named "new <d-mon-yyyy> <h:mm am/pm>" (creation time), and that
    heading is the main node of the map, with every rule below applying to it from the first moment.
4.2b Naming rule: a new node is named "new <A> <L>" where A is the number of adjacent nodes above it among its
    siblings (an appended child of a node with 16 children is "new 16 …") and L is its level counted from the main
    node (root = 0, so a direct child of the root is level 1).
4.3 New nodes are inserted at the right place in the markdown (same type and level as their siblings), laid out
    automatically, faded in, selected, and opened for typing.
4.4 Double-click on blank space:
    a. The strip beside a node's box (same height as the box, up to ~10 cm from its tip) is that node's child area and
       has priority over every other area: double-clicking there always creates a child of THAT node. Once the node has
       children, its child area is the gap between the node and its children (spanning the children's height).
    b. Only when the point is in no node's child area: directly above a node (within the node's horizontal span, in the
       blank gap up to the next node above) → new sibling above it; directly below → new sibling below it.
    A point inside a node is never treated as blank (it edits the node instead).

## 5. Drag and drop
5.1 Dragging a node drags its whole subtree. A ghost label follows the pointer; the source stays dimmed.
5.2 Dropping a node anywhere on another node makes it (with its children) the last child of that node.
    Dropping on its own descendant or on itself is ignored.
5.3 Dropping in the blank space between siblings reorders the node among them (above the target's midpoint = before,
    below = after). A thin accent line on the neighbour shows where it will land. No arrows and no text labels are shown.
5.4 With several nodes selected, dragging any of them and dropping on a node moves all selected nodes under that node,
    keeping their document order.
5.5 Dragging near the edge of the map view auto-scrolls the view (speed grows with distance past the 50 px edge band);
    a dashed "safe zone" frame shows where auto-scroll does not trigger. Drop targets stay in sync while scrolling.
5.6 A very fast release still applies the last pointer position (no lost drops).

## 6. Collapse and expand
6.1 The circle at a node's tip toggles its children; a filled circle means collapsed. Space toggles the selected node.
6.2 Collapse state is remembered per node for the session and across edits; the toolbar has expand-all, collapse-all,
    and expand-to-level 1/2/3.
6.3 Collapsing or expanding animates (default 320 ms, honours reduced-motion) and keeps other nodes in place.

## 7. Layout and appearance
7.1 Links are curved branches by default; straight or angled are available from the toolbar. With one or more nodes
    selected, the line-style menu applies to those nodes only (stored on each node as `{line:…}`); with nothing selected
    it changes the whole map. "Use map default for selected" removes the per-node style.
7.1b Expand level control: [−] [levels icon] [+] next to expand/collapse-all. − collapses one level, + expands one
    more, the icon shows all levels. Each press shows a bottom-right notice "Expand level: N of M" (or "Expanded all").
7.1c The minimap label shows zoom relative to fit-to-view (100% = the map fitted to the pane) and updates on every
    zoom, pan, fit and animation step.
7.2 Colors follow depth (color 1/2/3/default with per-level thickness, freeze level) or tags; node shape text/box/rounded/pill.
7.3 Vertical spacing between nodes is a setting applied to every node; the toolbar has −, cycle and + buttons.
7.4 Unread, recent and important notes get indicators; tags appear as pills; badges mark todo/done/link/embed/image/code/quote.
7.5 A minimap in the bottom-right shows the whole map and the viewport; click or drag it to move, fit and collapse buttons.
7.6 Maps with many nodes cull off-screen nodes and use a lighter rendering when zoomed far out (1500 nodes < 200 ms).

## 7b. Task strip (per node)
7b.1 Every node except the root can carry a task strip of exactly five fields, edited in a popup opened from the
     toolbar task icon (next to the spacing − / + buttons), the T key, the node's context menu, or by clicking the strip.
7b.2 The five fields, in order, shown as chips on the node: deadline (date until which the task accepts inputs),
     assignee (a person or an AI agent), budget (joining fee / budget), category (decides the minimum required fields;
     never more than five inputs), people counter (joined / needed).
7b.3 The counter shows "joined/needed"; "+1 join" increments it; once joined ≥ needed the chip reads "joined" and the
     strip turns green. Example strip: 16-sep-2026 · ram singh · 10 · real-estate · 0/90.
7b.4 The strip is stored in the note on the node's own line as `{task: deadline | assignee | budget | category | count}`,
     so it survives renames, moves, export and sharing.

## 8. Navigation, search, links
8.1 Arrow keys move the selection between nodes; Home selects the root; Escape clears.
8.2 Search in map highlights matches, dims the rest, and steps with next/previous.
8.3 [[wikilinks]] in a node open that note; #tags open a tag search; URLs open in a new tab.

## 9. Sharing
9.1 Share creates a link that carries the note inside the URL (nothing is uploaded).
    Public: anyone with the link opens it. Private: AES-256 encrypted with a password entered by the reader.
    Read-only: the receiver can view but not edit. Opening a link adds the note under Shared/ and shows the map.

## 10. Import / export
10.1 Export: PNG, SVG, PDF (print), Markdown, OPML, FreeMind, copy screenshot. Import: XMind, MindMeister, OPML,
     FreeMind, JSON Canvas, tab-indented outline, Markdown.

## Verification
`test/engine.test.html` (58 checks) plus headless Playwright runs of the rules above; see README for how to run.
