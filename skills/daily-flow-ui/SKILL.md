---
name: daily-flow-ui
description: >-
  Design system and UI consistency guidelines for Daily Flow.
  Use whenever creating, editing, or styling UI components, pages, dialogs, badges,
  cards, forms, buttons, colors, typography, or dark/light mode elements.
---

# Daily Flow — UI & Design System Skill

This skill enforces strict visual consistency, typography standards, color tokens, dark mode rules, and component patterns across the Daily Flow application.

---

## 1. Design Philosophy

- **Execution OS Aesthetic**: Linear-inspired, dense, operational, high-contrast, distraction-free.
- **Dark-First Architecture**: Dark mode is the primary native interface (`oklch` palette). Never introduce raw light-mode defaults (e.g. `bg-white`, `text-black`, `border-gray-200`) without proper theme tokens.
- **Micro-Interactions & Dense Layouts**: Compact padding (`p-2.5`, `p-3`, `gap-2`, `gap-3`), tight typography, crisp 1px borders, subtle transitions (`transition-colors duration-150`).
- **Semantic Token Usage**: Always use semantic Tailwind classes mapped to CSS variables (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`).

---

## 2. Color Palette & Token Map

All colors are defined via `@theme inline` and CSS variables in `src/styles.css`:

### Core Surfaces & Layout
| Semantic Token | Tailwind Class | OKLCH / CSS Variable | Usage |
|---|---|---|---|
| **Background** | `bg-background` | `oklch(0.16 0.012 264)` | Global canvas / page background |
| **Card Surface** | `bg-card` | `oklch(0.20 0.012 264)` | Cards, list containers, panels |
| **Popover / Modal**| `bg-popover` | `oklch(0.21 0.014 264)` | Dropdowns, dialogs, popovers, tooltips |
| **Muted Surface** | `bg-muted` | `oklch(0.24 0.012 264)` | Secondary wells, chips, disabled states |
| **Secondary** | `bg-secondary` | `oklch(0.26 0.014 264)` | Sub-buttons, interactive inactive states |
| **Accent / Hover** | `bg-accent` | `oklch(0.28 0.018 264)` | Hover highlight states (`hover:bg-accent/40`) |
| **Input Surface** | `bg-input` / `bg-input/40` | `oklch(0.26 0.014 264)` | Form inputs, search fields, textareas |

### Text & Foregrounds
| Token | Tailwind Class | Tone / Meaning |
|---|---|---|
| **Foreground** | `text-foreground` | High contrast primary text (`oklch(0.96)`) for titles, main labels |
| **Muted Foreground** | `text-muted-foreground` | Secondary/subtle text (`oklch(0.68)`) for descriptions, timestamps |
| **Primary Accent** | `text-primary` | Indigo accent (`oklch(0.72 0.18 268)`) for active tabs, links, focal points |
| **Destructive** | `text-destructive` | Red warning text (`oklch(0.62 0.22 25)`) for errors, delete actions |

### Borders & Outlines
| Token | Tailwind Class | Usage |
|---|---|---|
| **Border** | `border-border` / `border-border/50` | Dividers, card borders, table lines |
| **Ring** | `ring-ring` / `ring-primary` | Focus rings (`focus-visible:ring-1 focus-visible:ring-ring`) |

### Status Colors
| Status | Tailwind / Variable | Color | Standard Badge Style |
|---|---|---|---|
| **Todo** | `var(--status-todo)` | Slate / Muted (`oklch 0.68`) | `bg-muted/40 text-muted-foreground border-border` |
| **In Progress** | `var(--status-progress)` | Blue (`oklch 0.70 0.16 235`) | `bg-blue-500/10 text-blue-400 border-blue-500/30` |
| **In Review** | `var(--status-review)` | Purple (`oklch 0.70 0.18 310`) | `bg-purple-500/10 text-purple-400 border-purple-500/30` |
| **Blocked** | `var(--status-blocked)` | Deep Red (`oklch 0.55 0.22 22`) | `bg-rose-500/15 text-rose-400 border-rose-500/40` |
| **On Hold** | `var(--status-hold)` | Amber / Gold (`oklch 0.78 0.15 75`) | `bg-amber-500/10 text-amber-400 border-amber-500/30` |
| **Completed** | `var(--status-completed)`| Green / Emerald (`oklch 0.72 0.18 152`)| `bg-emerald-500/10 text-emerald-400 border-emerald-500/30` |

### Priority Colors
| Priority | Color | Token Class |
|---|---|---|
| **High** | Crimson Red | `border-priority-high/40 text-rose-400 bg-rose-500/10` |
| **Medium** | Orange / Gold | `text-amber-400 bg-amber-500/10 border-amber-500/20` |
| **Low** | Cyan / Sky Blue| `text-sky-400 bg-sky-500/10 border-sky-500/20` |

---

## 3. Typography Rules

1. **Font Family**:
   - Primary: System sans-serif with OpenType features (`font-feature-settings: "cv11", "ss01"` enabled globally).
   - Monospace: `font-mono` for all Task IDs (`TSK-001`), logged hours (`4.5h`), counts, timestamps, and commit/hash references.

2. **Type Scale**:
   - **Page Title**: `text-lg font-semibold tracking-tight text-foreground`
   - **Section / Modal Header**: `text-sm font-semibold tracking-tight text-foreground`
   - **Body Text**: `text-xs font-medium text-foreground` or `text-sm`
   - **Subtext / Descriptions**: `text-xs text-muted-foreground leading-normal`
   - **Metadata / Badges / Chips**: `text-[11px]` or `text-xs font-medium`
   - **Code / Mono Badges**: `text-[11px] font-mono text-muted-foreground`

---

## 4. Component Patterns & Guidelines

### A. Cards & Containers
```tsx
<Card className="p-3 bg-card hover:bg-accent/30 border border-border/60 rounded-lg transition-colors shadow-sm">
  {/* Header */}
  <div className="flex items-center justify-between gap-2">
    <span className="font-mono text-xs text-muted-foreground">TSK-102</span>
    <StatusBadge status={task.status} />
  </div>
  {/* Content */}
  <div className="mt-1 font-medium text-xs text-foreground truncate">{task.name}</div>
</Card>
```

### B. Badges & Chips
- Use pill/rounded-full badges with subtle 10-15% opacity background and matching 30% opacity border:
```tsx
<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-blue-500/10 text-blue-400 border-blue-500/30">
  <Play className="w-3 h-3" />
  In Progress
</span>
```

### C. Dialogs & Modals
- Dialog content must use `bg-card` or `bg-popover` with `border border-border shadow-2xl rounded-xl`.
- Header: `DialogHeader` with `DialogTitle className="text-base font-semibold text-foreground"` and `DialogDescription className="text-xs text-muted-foreground"`.
- Footer: `DialogFooter` with `Button variant="outline"` for cancel and `Button variant="default"` for primary submit.

### D. Inputs & Form Elements
- Inputs should always have subtle borders, dark background, and clean focus states:
```tsx
<Input
  className="h-8 text-xs bg-input/40 border-border text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary rounded-md"
  placeholder="Enter task name..."
/>
```
- Date inputs automatically invert calendar icons via CSS (`filter: invert(1)`). Do not add custom conflicting filters.
- Number inputs have spin buttons hidden globally.

### E. Buttons & Micro-Actions
- Standard Button Sizes:
  - Mini / Icon Button: `h-7 w-7 p-0` with `lucide-react` icon `w-3.5 h-3.5`.
  - Compact Action: `h-7 px-2.5 text-xs`.
  - Default: `h-8 px-3 text-xs font-medium`.
- Variants:
  - Primary: `bg-primary text-primary-foreground hover:bg-primary/90`
  - Outline: `border border-border bg-transparent hover:bg-accent hover:text-accent-foreground`
  - Ghost: `hover:bg-accent hover:text-accent-foreground text-muted-foreground`
  - Destructive: `bg-destructive text-destructive-foreground hover:bg-destructive/90`

---

## 5. Strict DOs & DON'Ts

### ❌ NEVER:
1. **Never use hardcoded Tailwind light colors without dark variants**: e.g., `bg-white`, `bg-gray-100`, `text-gray-900`, `border-gray-200`.
2. **Never use hardcoded hex/rgb colors in inline styles**: e.g., `style={{ color: '#333' }}`.
3. **Never make oversized padding or buttons in operational views**: Avoid `p-6`, `p-8`, `h-12` in dense task boards and table views.
4. **Never omit `font-mono` on task codes, hours, and counters**.

###  ALWAYS:
1. **Always use semantic variables**: `bg-card`, `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`.
2. **Always ensure high readability contrast**: Main text should be crisp `text-foreground` (`oklch 0.96`), subtext `text-muted-foreground`.
3. **Always reuse existing badge components**: Use `StatusBadge`, `PriorityBadge`, `WorkItemTypeBadge`, `StreakChip`, `CarryForwardBadge`.
4. **Always support keyboard focus and smooth transitions**: Use `focus-visible:ring-1 focus-visible:ring-primary` and `transition-colors`.
