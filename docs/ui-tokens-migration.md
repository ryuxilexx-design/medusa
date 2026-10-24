# UI tokens: migration map (for the codemod pass)

The design-system pass of 2026-10-24 added named tokens (`apps/web/tailwind.config.ts`, values in `globals.css :root`)
and converted `components/ui.tsx`, the shell and every file outside the page set listed at the end. The files in that
list still use the old arbitrary values; replace them with the tokens below. Every mapping is visually identical unless a
note says otherwise. 1 rem = 18 px.

## Text sizes

| Old | New | px | Note |
|---|---|---|---|
| `text-[0.8125rem]` | `text-small` | 14.6 | identical (no line-height in the token) |
| `text-[0.9375rem]` | `text-body` | 16.9 | identical |
| `text-[0.875rem]` | `text-sm` | 15.75 | Tailwind sets line-height 1.25rem (was inherited 1.5) |
| `text-[0.75rem]` | `text-xs` | 13.5 | line-height 1rem |
| `text-[0.6875rem]`, `text-[0.625rem]` | `text-2xs` | 12.4 | tags only; line-height 0.875rem; `0.625rem` grows 1 px |
| `text-[1rem]` | `text-base` | 18 | identical |
| `text-[1.375rem]` | `text-stat` | 24.75 | identical |
| `text-[1.5rem]` | `text-2xl` | 27 | line-height 2rem |
| `text-[1.75rem]` (page h1) | `text-title` | 31.5 | line-height 1.25 — page titles: use `PageHeader` or `text-title font-bold tracking-tight` |
| print-only sizes (`print/**`, `print-doc.tsx`) | keep | | paper, not screen |

Shell/phone tab bar labels are `text-xs` (13.5 px) now; nothing in the app UI should go below `text-xs` except `text-2xs` tags.

## Colours, focus, radius, shadow, z-index

| Old | New |
|---|---|
| `#2d64bd`, `#0a58ca`, `rgba(10,88,202,…)` | `brand-600` / `accent` (both are `--brand-600` = #0a58ca) |
| `shadow-[inset_4px_0_0_#2d64bd]` (selected list row) | `shadow-selected` (or `RowButton selected`) |
| `focus-visible:ring-amber-300`, `focus:ring-amber-300` | `…:ring-focus` (same colour); whole focus recipe: `FOCUS_RING` / `FOCUS_RING_INSET` from `ui.tsx` |
| `#1a2233`, `text-slate-900` on body text | `text-slate-900` (= `ink`) |
| `rounded-[1.375rem]`, `rounded-[22px]` | `rounded-surface` |
| `rounded-[1.75rem]` | `rounded-panel` |
| `rounded-xl` / `rounded-lg` on a field-like box or hand-made alert | `rounded-field` (0.75rem) |
| `shadow-[0_24px_48px_-16px_rgba(10,30,70,0.4)]`, popovers | `shadow-popover` |
| `shadow-[0_30px_60px_-20px_…]` | `shadow-modal` |
| SlidingPill shadows `shadow-[0_2px_8px_rgba(15,23,42,0.12)]`, `shadow-[0_4px_10px_-4px_rgba(10,30,70,0.4)]` | `shadow-pill` (better: use `Segmented`/`Tabs`) |
| `shadow` / `shadow-lg` on a floating card | `shadow-popover`; cards use `.surface` (`shadow-card`) |
| `z-[1]` | `z-raised` |
| `z-10` sticky bars | `z-sticky` |
| `z-20`/`z-30` in-content popovers | `z-dropdown` |
| `z-[5]`, `z-[6]` (schedule grid layers) | keep local, or `z-raised` + DOM order |
| `max-w-[1440px]` | `max-w-[80rem]` |
| SVG chart `#25519c` / `#4a86d6` / `#475569` / `#e2e8f0` / `#94a3b8` | `rgb(var(--brand-700))`, `rgb(var(--brand-500))`, or `currentColor` with a `text-*` class |

## Control heights

| Old | New |
|---|---|
| `min-h-12` on Button/LinkButton md | the component (`size="md"` = `min-h-control`, 2.75rem = 49.5 px) |
| `min-h-10` (Button sm) | `size="sm"`/`"compact"` = `min-h-control-sm` (2.5rem = 45 px) |
| `h-11` Input/Select | default (`h-control`); dense row: `<Input size="sm">` |
| `h-9`, `h-10`, `min-h-9`, `min-h-8`, `p-1`/`p-2` icon buttons | `Button size="icon"` / `"icon-sm"` (aria-label required) or `min-h-control-sm` |
| `!px-2.5` on an icon-only Button | `size="icon"` |
| `!min-h-8` | remove (never below `control-sm`) |

## Components to swap in

| Hand-built pattern | Use |
|---|---|
| segmented control (`role=tablist`/`group` of buttons + SlidingPill) — dashboard:41, schedule:93, finance-extra:41 | `Segmented` (`size="md"` in a toolbar row, `compact` in dense rows; `role="tablist"` when it switches the content below) |
| filter / topic / slot chips with `aria-pressed` | `Chip` |
| `<label><input type=checkbox|radio …>` | `Checkbox` / `Radio` (`rowClassName`, `rowProps` for `data-*`, `hint`) |
| `className="… text-brand-700 hover:underline"` buttons/links | `TextLink` (`tone="ink"` for a slate-900 name, `"danger"`, `"muted"`) |
| list row buttons with a selected state | `RowButton selected` |
| `<a>` that copies Button classes (CsvLink finance-extra:28, print toolbar print/shift:34) | `buttonClass(variant, size)` |
| `text-[0.8125rem] font-bold uppercase tracking-wide text-slate-600` headings | `SectionTitle` |
| `<p className="… text-red-700">` error lines outside Field | `FieldError` |
| dashed-box `<p>` empty states | `EmptyState compact` |
| `animate-pulse` | `motion-safe:animate-pulse` (globals.css stops pulse/spin under reduced motion anyway) |
| `scrollIntoView({ behavior: 'smooth' })` | `behavior: scrollBehavior()` from `ui.tsx` |

## Files not migrated in this pass (owned by the page pass)

`app/(app)/doctor/**`, `app/(app)/patients/[id]/**`, `app/(app)/lab/**`, `app/(app)/diagnostics/**`, `app/(app)/queue/**`,
`app/(app)/cashier/[id]/**`, `app/(app)/dashboard/**`, `app/(app)/schedule/**`, `app/(app)/finance/**`,
`components/manager-ai.tsx`, `components/date-range.tsx`, `components/finance-extra.tsx`, `components/print-doc.tsx`,
`app/print/**`, `components/no-access.tsx`. Known items there: schedule:187 animates `box-shadow` (use opacity/transform
or no transition); dashboard chart SVG text scales to ~5 px on a phone (measure the width or show the table under `sm`);
StatCard grids should drop to one column under ~400 px (`grid-cols-1 min-[400px]:grid-cols-2`).
