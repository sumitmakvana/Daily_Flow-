# Daily Flow UI Consistency & Design Rules

Always follow these rules when developing or modifying frontend components in Daily Flow:

1. **Dark-First Theme Tokens**:
   - Never use raw light-mode classes like `bg-white`, `text-black`, `border-gray-200`.
   - Always use theme tokens:
     - `bg-background` for pages/screens
     - `bg-card` for cards/panels/containers
     - `bg-popover` for modals/menus
     - `bg-muted` for chips/wells
     - `text-foreground` for primary headings & text (oklch 0.96)
     - `text-muted-foreground` for sub-text, secondary details (oklch 0.68)
     - `border-border` / `border-border/50` for crisp boundaries
     - `text-primary` / `bg-primary` for brand accents

2. **Typography**:
   - Always use `font-mono` on task codes (`task_code`), hours, durations, timestamps, and numeric metrics.
   - Headers: `text-sm font-semibold tracking-tight text-foreground` or `text-base font-semibold`.
   - Body/Labels: `text-xs font-medium`.
   - Secondary: `text-xs text-muted-foreground`.

3. **Status & Priority Badges**:
   - Always reuse existing badges (`StatusBadge`, `PriorityBadge`, `WorkItemTypeBadge`, `StreakChip`).
   - If custom badges are needed, use standard opacity styling: `bg-[color]-500/10 text-[color]-400 border-[color]-500/30`.

4. **Component Density**:
   - Keep cards, modals, tables, and buttons compact and dense (`p-2.5` / `p-3`, `h-7` / `h-8` buttons) for an operational executive feel.
