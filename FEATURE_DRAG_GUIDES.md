# Feature: enhanced drag-and-drop (directional arrows + auto-scroll)  — requested 2026-09-11

Implement as `src/mindmap/drag-guides.js`, attached by MindMapView (and CanvasView) around node drag.

DIRECTIONAL ARROW GUIDANCE
- On drag start show 4 semi-transparent arrows (up/down/left/right) at equal distance from node center.
- The arrow matching the drag direction becomes more opaque + slightly larger, with a subtle glow (placement intent).
- Fade-in on drag start, fade-out on drop.

AUTO-SCROLL
- Within 50px of a viewport edge start auto-scrolling that direction; speed proportional to overshoot
  (minimum at the edge, increasing further out); diagonal corners scroll X and Y; rAF-driven, no jumps.
- Dragged node keeps its position relative to the cursor while the view scrolls; stops instantly when back inside.

VISUAL FEEDBACK
- Cursor change while auto-scrolling; boundary indicator near edges; "safe zone" indicator (inner rect where no
  auto-scroll triggers); temporary placement guides when hovering a potential drop target (parent highlight + insertion line).

PERFORMANCE: rAF loop, arrows as a single reusable SVG/HTML overlay, no per-frame DOM creation, 60fps.
INTEGRATION: works with existing node:move re-parenting, links, hotkeys, gestures; original styling preserved.
