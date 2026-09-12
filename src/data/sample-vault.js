// Sample vault — loaded on first run (and via "Load sample vault").
export const SAMPLE_VAULT_NAME = 'Sample Vault';

function bigMap() {
  const sections = [
    ['Product', ['Vision', 'Roadmap', 'Pricing'], ['define the **core loop**', 'interview 10 users', 'write the one-pager', 'ship a #beta']],
    ['Engineering', ['Frontend', 'Backend', 'Infrastructure'], ['pick the stack', 'set up CI', 'write `unit tests`', 'monitor latency']],
    ['Design', ['Research', 'Wireframes', 'Visual system'], ['map user journeys', 'sketch 3 concepts', 'build a component library', 'test with users']],
    ['Marketing', ['Launch', 'Content', 'Community'], ['draft announcement', 'write 4 blog posts', 'open a Discord', 'collect testimonials']],
    ['Operations', ['Hiring', 'Finance', 'Legal'], ['write job posts', 'set a budget', 'review contracts', 'quarterly review']],
    ['Learning', ['Books', 'Courses', 'Practice'], ['read [[Zettelkasten]]', 'finish [[Learning Rust|the Rust course]]', 'daily 30 min practice', 'write summaries']],
  ];
  let out = `---\ntitle: Big Map\ntags: [demo, performance]\n---\n\n# Big Map\n\nA larger note (about 120 nodes) to exercise layout, collapse, search and virtualization.\n`;
  for (const [h2, h3s, bullets] of sections) {
    out += `\n## ${h2}\n`;
    for (const h3 of h3s) {
      out += `\n### ${h3}\n\n`;
      bullets.forEach((b, i) => {
        out += `- ${b}\n`;
        if (i === 0) out += `  - owner: *team lead*\n  - due: ==next sprint==\n`;
        if (i === 3) out += `  - [ ] follow up\n`;
      });
    }
  }
  return out;
}

export const SAMPLE_VAULT = [
  {
    path: 'Onboarding.md', ageHours: 2,
    content: `---
title: Onboarding
tags: [help, getting-started]
important: true
---

# Welcome to Mind Map

This vault shows everything the app can do. Open any note and its **outline becomes a mind map** in the pane on the right — headings and nested bullets become branches, exactly like the Obsidian *Mind Map* plugin.

## Editing

- Type in the editor on the left; the map updates live
- Click a node in the map to jump to its line
- Press \`Enter\` on a selected node to add a child, \`Tab\` for a sibling
- \`F2\` or double-click renames a node, \`Delete\` removes its subtree
- Drag a node onto another node to re-parent it
- Undo with Mod+Z, redo with Mod+Shift+Z

## Navigating

- [[Projects/Mind Map App|The app project]] tracks the roadmap
- Wikilinks like [[Zettelkasten]] open notes; hover a node with a link to see it
- Tags such as #help and #getting-started show up in the tag pane and the graph
- The **Graph view** (ribbon icon or Mod+G) shows every link in the vault
- **Local graph** shows only the neighbours of the current note

## Panes

- Left sidebar: Files, Search, Tags, Bookmarks
- Right sidebar: Backlinks, Outgoing links, Outline, History
- Status bar: word count, backlinks, node count, sync state

## Export & import

- Export the map as PNG, SVG, PDF, Markdown, OPML or FreeMind
- Import XMind, MindMeister, OPML, FreeMind or JSON Canvas files
- Copy a screenshot straight to the clipboard

## Tips

- [ ] Open the command palette with Mod+P
- [ ] Open the quick switcher with Mod+O
- [x] Read the [[Big Map]] note to see a large map
- [ ] Try the [[Ideas.canvas|Ideas canvas]]
`,
  },
  { path: 'Big Map.md', ageHours: 30, content: bigMap() },
  {
    path: 'Projects/Mind Map App.md', ageHours: 5,
    content: `---
title: Mind Map App
tags: [project, app]
status: active
aliases: [The App, MMA]
---

# Mind Map App

A standalone clone of the Obsidian *Mind Map* plugin with **graph view**, **canvas** and editing gestures. See [[Onboarding]] for a tour and [[Resources/Obsidian Tips|Obsidian tips]] for conventions.

## Goals

- Pixel-faithful Obsidian UI #design
- Live sync between editor and map
- Work offline, no build step
- Open a real folder with the File System Access API

## Roadmap

### v1

- [x] Editor with line numbers
- [x] Mind map pane with toolbar
- [x] Graph view with filters and groups
- [ ] Canvas with groups and colors
- [ ] Plugin API #dev

### v2

- Collaboration
- Mobile layout polish
- Sync via [[Areas/Career|work]] accounts

## Architecture

- \`src/core\` — store, links, history, commands, settings, plugins
- \`src/mindmap\` — renderer, layout, graph, canvas
- \`src/ui\` — workspace, editor, components

## Risks

- Large maps: virtualization keeps 1000+ nodes smooth; see [[Big Map]]
- Browser support: Safari needs 16.4+ for \`DecompressionStream\`

## Team notes

Weekly sync every Monday, tracked in [[Daily/2026-09-11|today's daily note]]. Budget in [[Areas/Finance]].
`,
  },
  {
    path: 'Projects/Website Redesign.md', ageHours: 60,
    content: `---
tags: [project, design, web]
status: planning
---

# Website Redesign

Refresh the marketing site before the [[Mind Map App]] launch. Design language should match [[Resources/Obsidian Tips|the app]].

## Pages

- Home
  - Hero with an animated map
  - Feature grid
  - Testimonials
- Docs
  - Getting started (link to [[Onboarding]])
  - Hotkeys
  - Plugin API
- Pricing
  - Free
  - Pro

## Timeline

| Phase | Owner | Due |
| --- | --- | --- |
| Wireframes | Ana | Sep 20 |
| Visual design | Ben | Oct 4 |
| Build | Chris | Oct 25 |

## Open questions

- Static site or app router? #dev
- Where does the blog live?
- Reuse the [[Ideas.canvas|ideas canvas]] illustrations?
`,
  },
  {
    path: 'Projects/Learning Rust.md', ageHours: 100,
    content: `---
tags: [project, learning, rust]
aliases: [Rust course]
---

# Learning Rust

Notes from the Rust book, part of my [[Areas/Career]] plan. Method: [[Zettelkasten]].

## Ownership

- Each value has a single owner
- Moves transfer ownership; \`Copy\` types are duplicated
- Borrowing: \`&T\` shared, \`&mut T\` exclusive
- Lifetimes tie references to scopes

## Error handling

- \`Result<T, E>\` for recoverable errors
- \`panic!\` for unrecoverable ones
- The \`?\` operator propagates errors

\`\`\`rust
fn read(path: &str) -> Result<String, std::io::Error> {
    let text = std::fs::read_to_string(path)?;
    Ok(text)
}
\`\`\`

## Traits

- Define shared behaviour
- Generic bounds \`T: Display + Clone\`
- Trait objects \`Box<dyn Trait>\` for dynamic dispatch

## Progress

- [x] Chapters 1-4
- [x] Chapter 5 structs
- [ ] Chapter 6 enums
- [ ] Build a CLI tool #practice
`,
  },
  {
    path: 'Areas/Health.md', ageHours: 200,
    content: `---
tags: [area, health]
---

# Health

Long-term area. Reviewed in [[Daily/2026-09-10]].

## Sleep

- Lights out by 23:00
- No screens after 22:30
- Track with the ring

## Movement

- Strength ×3 per week
- Walk 8k steps
- Stretch after long editing sessions #habit

## Food

- Protein first
- Cook on Sundays
- Limit caffeine after 14:00
`,
  },
  {
    path: 'Areas/Finance.md', ageHours: 300,
    content: `---
tags: [area, finance]
important: true
---

# Finance

Budget owner for [[Projects/Mind Map App|The App]] and [[Projects/Website Redesign]].

## Monthly review

- Reconcile accounts
- Update the runway sheet
- Move 20% to savings

## Budgets

| Item | Monthly |
| --- | --- |
| Hosting | $40 |
| Design tools | $60 |
| Contractors | $1200 |

## Questions

- Annual vs monthly billing? #decision
- When to hire a bookkeeper?
`,
  },
  {
    path: 'Areas/Career.md', ageHours: 400,
    content: `---
tags: [area, career]
---

# Career

## This year

- Ship [[Projects/Mind Map App]]
- Finish [[Projects/Learning Rust|Learning Rust]]
- Give one conference talk #goal

## Skills

- Systems design
- Writing
  - Weekly essay
  - Read [[Resources/Reading List|the reading list]]
- Public speaking

## Network

- Monthly coffee with a mentor
- Answer questions in the community
`,
  },
  {
    path: 'Resources/Markdown Cheatsheet.md', ageHours: 500,
    content: `---
tags: [resource, markdown, reference]
---

# Markdown Cheatsheet

Everything the mind map understands. See also [[Obsidian Tips]].

## Inline

- **bold**, *italic*, ~~strike~~, ==highlight==, \`code\`
- [[Onboarding]] wikilink, [[Onboarding|with alias]], [[Onboarding#Editing]] heading link
- External [link](https://example.com)
- Tags: #reference #markdown/inline

## Lists

- Bulleted
  - Nested with two spaces
    - Three levels deep
1. Ordered
2. Items
- [ ] Task
- [x] Done task

## Blocks

> Quote blocks become a single node.

\`\`\`js
const map = parseMarkdown(note);
\`\`\`

| Syntax | Result |
| --- | --- |
| \`# H1\` | Heading level 1 |
| \`- item\` | Bullet |

## Colors

- Blue branch <!-- color: #4f8ef7 -->
- Green branch {color:#4fd6a2}
`,
  },
  {
    path: 'Resources/Reading List.md', ageHours: 700,
    content: `---
tags: [resource, books]
---

# Reading List

## Non-fiction

- *How to Take Smart Notes* — the origin of [[Zettelkasten]]
- *The Design of Everyday Things*
- *Thinking in Systems* #systems

## Technical

- *The Rust Programming Language* — see [[Projects/Learning Rust]]
- *Designing Data-Intensive Applications*
- *Refactoring UI* — informs [[Projects/Website Redesign]]

## Fiction

- *Piranesi*
- *The Left Hand of Darkness*
`,
  },
  {
    path: 'Resources/Zettelkasten.md', ageHours: 800,
    content: `---
tags: [resource, method, pkm]
aliases: [Slip box]
---

# Zettelkasten

A note-taking method built on small, linked notes. Referenced from [[Onboarding]], [[Projects/Learning Rust]] and [[Reading List]].

## Principles

- One idea per note
- Write in your own words
- Link generously
  - Backlinks reveal structure
  - Unlinked mentions hint at missing links
- Review the graph weekly

## Note types

- Fleeting notes → capture in [[Daily/2026-09-11|daily notes]]
- Literature notes
- Permanent notes #pkm

## Workflow

1. Capture
2. Process
3. Connect
4. Publish
`,
  },
  {
    path: 'Resources/Obsidian Tips.md', ageHours: 900,
    content: `---
tags: [resource, obsidian]
---

# Obsidian Tips

Conventions this app copies from Obsidian. Cheat sheet: [[Markdown Cheatsheet]].

## Hotkeys

- Mod+P command palette
- Mod+O quick switcher
- Mod+E toggle reading view
- Mod+G graph view
- Mod+M preview as mind map

## Panes

- Sidebars collapse with the toggles in the title bar
- Drag the divider between editor and map
- Right-click a tab for more options

## Graph

- Groups color nodes by search query, e.g. \`tag:#project\`
- Forces sliders change the layout
- Filters hide tags, attachments and unresolved links #graph
`,
  },
  {
    path: 'Daily/2026-09-09.md', ageHours: 50,
    content: `---
tags: [daily]
---

# 2026-09-09

## Log

- Sketched the graph settings panel for [[Projects/Mind Map App]]
- Read two chapters for [[Projects/Learning Rust]]
- Walked 9k steps ([[Areas/Health]])

## Tomorrow

- [ ] Write the export menu
- [ ] Review [[Projects/Website Redesign|redesign]] wireframes
`,
  },
  {
    path: 'Daily/2026-09-10.md', ageHours: 26,
    content: `---
tags: [daily]
---

# 2026-09-10

## Log

- Export menu done: PNG, SVG, PDF, OPML, FreeMind #shipped
- Health review — sleep improving ([[Areas/Health]])
- Budget check with [[Areas/Finance]]

## Ideas

- Color nodes by tag automatically (see the bundled plugin)
- Timeline of link changes in the History pane

## Tomorrow

- [ ] Onboarding tutorial
- [ ] Canvas colors
`,
  },
  {
    path: 'Daily/2026-09-11.md', ageHours: 1,
    content: `---
tags: [daily]
---

# 2026-09-11

## Log

- Weekly sync for [[Projects/Mind Map App|The App]]
- Fleeting notes for [[Zettelkasten]] processing
- Tried the [[Ideas.canvas|ideas canvas]]

## Inbox

- Ask Ana about the [[Projects/Website Redesign]] hero animation
- Look up \`DecompressionStream\` support in Safari
- Book a mentor coffee ([[Areas/Career]])

## Tomorrow

- [ ] Publish the plugin API docs
- [ ] Test import of an XMind file #import
`,
  },
  {
    path: 'Ideas.canvas', ageHours: 10,
    content: JSON.stringify({
      nodes: [
        { id: 'n1', type: 'text', x: -420, y: -160, width: 260, height: 90, color: '1', text: '# Launch ideas\nBrainstorm for the [[Mind Map App]] launch' },
        { id: 'n2', type: 'file', x: -80, y: -220, width: 300, height: 140, file: 'Projects/Mind Map App.md' },
        { id: 'n3', type: 'text', x: 300, y: -180, width: 220, height: 80, color: '4', text: 'Demo video with the Big Map' },
        { id: 'n4', type: 'text', x: 300, y: -60, width: 220, height: 80, color: '2', text: 'Blog post: why mind maps?' },
        { id: 'n5', type: 'link', x: -80, y: 20, width: 300, height: 90, url: 'https://jsoncanvas.org' },
        { id: 'n6', type: 'text', x: -420, y: 40, width: 260, height: 80, color: '5', text: 'Community launch on Discord' },
        { id: 'g1', type: 'group', x: 270, y: -220, width: 290, height: 280, label: 'Content', color: '3' },
        { id: 'n7', type: 'file', x: 300, y: 60, width: 220, height: 90, file: 'Projects/Website Redesign.md' },
      ],
      edges: [
        { id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left', label: 'tracks' },
        { id: 'e2', fromNode: 'n2', fromSide: 'right', toNode: 'n3', toSide: 'left' },
        { id: 'e3', fromNode: 'n2', fromSide: 'right', toNode: 'n4', toSide: 'left' },
        { id: 'e4', fromNode: 'n1', fromSide: 'bottom', toNode: 'n6', toSide: 'top' },
        { id: 'e5', fromNode: 'n6', fromSide: 'right', toNode: 'n5', toSide: 'left', color: '6' },
        { id: 'e6', fromNode: 'n4', fromSide: 'bottom', toNode: 'n7', toSide: 'top' },
      ],
    }, null, 2),
  },
];
