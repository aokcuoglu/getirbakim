# Design Patterns & UI Guidelines

> **Version:** 3.0 — Last updated: 2026-05-24  
> **Reference:** [shadcn/ui Components](https://ui.shadcn.com/docs/components)  
> **Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (new-york, neutral)  
> **Fonts:** Geist Sans / Geist Mono · **Icons:** lucide-react · **Animations:** tw-animate-css + shadcn/tailwind.css

---

## 1. Philosophy

The project's visual language must match [shadcn/ui](https://ui.shadcn.com/docs/components) **exactly** — same typography scale, component sizes, spacing, focus rings, shadows, and semantic tokens. Do not invent parallel design systems.

| Rule | Detail |
|------|--------|
| **shadcn/ui-first** | Every UI primitive comes from `components/ui/`. Extend via `className` or composition — never fork. |
| **Registry sync** | Update components with `bunx shadcn@latest add <name> --overwrite`. Do not hand-edit primitives unless the CLI cannot cover a hotfix. |
| **Tailwind-native** | Styles live in JSX via utility classes. No CSS Modules or component-scoped `.scss`. |
| **Semantic tokens** | Colors, radius, and shadows come from CSS variables in `app/globals.css`. Never hardcode hex/HSL/OKLCH in markup. |
| **Server by default** | Pages are Server Components. Add `'use client'` only for state, effects, or event handlers. |
| **Composition** | Prefer compound components (`Card` + `CardHeader` + …) over monolithic prop bags. |

---

## 2. Design Tokens (`app/globals.css`)

Tokens follow the shadcn/ui Tailwind v4 template:

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import 'shadcn/tailwind.css';
```

### 2.1 Semantic color tokens

| Token | Usage |
|-------|-------|
| `bg-background text-foreground` | Page body |
| `bg-card text-card-foreground` | Card surfaces |
| `bg-primary text-primary-foreground` | Primary actions (`Button variant="default"`) |
| `bg-secondary text-secondary-foreground` | Secondary surfaces |
| `bg-muted text-muted-foreground` | Captions, placeholders, dimmed text |
| `bg-accent text-accent-foreground` | Hover highlights (`Button variant="ghost"`) |
| `bg-destructive` | Errors, destructive actions |
| `text-success` / `bg-success` | In-stock, positive status |
| `text-warning` / `bg-warning` | Low stock, caution |
| `bg-footer text-footer-foreground` | Footer dark section |
| `border-border` | Default borders |
| `ring-ring` | Focus rings |

### 2.2 Radius scale (shadcn)

| Utility | Formula |
|---------|---------|
| `rounded-sm` | `calc(var(--radius) * 0.6)` |
| `rounded-md` | `calc(var(--radius) * 0.8)` |
| `rounded-lg` / `rounded-xl` | `var(--radius)` (= `0.625rem`) |
| `rounded-2xl` | `calc(var(--radius) * 1.8)` |

Base: `--radius: 0.625rem`

Extended tokens in `globals.css`:
- `--success` / `--success-foreground` — stock, positive states
- `--warning` / `--warning-foreground` — caution states
- `--footer` / `--footer-foreground` / `--footer-muted` / `--footer-border` — footer section

### 2.3 Never hardcode colors

```tsx
// ❌ BAD
<div className="bg-[#1a1a2e] text-slate-500">

// ✅ GOOD
<div className="bg-card text-muted-foreground">
```

### 2.4 Opacity modifiers

```
bg-primary/90
text-muted-foreground/70
border-border/50
```

---

## 3. Typography

### 3.1 Font stack

Exo 2 is the sole UI font — configured in `app/[locale]/layout.tsx`:

```tsx
import { Exo_2 } from 'next/font/google'

const exo2 = Exo_2({ variable: '--font-exo-2', subsets: ['latin', 'latin-ext'] })
```

`globals.css` maps `--font-sans: var(--font-exo-2)`. All text inherits via `html { @apply font-sans antialiased; }`.

Do **not** introduce secondary heading fonts or inline `fontFamily` overrides.

### 3.2 Type scale (matches shadcn docs)

| Element | Classes |
|---------|---------|
| Page title | `text-2xl font-semibold tracking-tight` |
| Section title | `text-lg font-semibold` |
| Card title | `font-semibold leading-none` (via `CardTitle`) |
| Body | `text-sm` (default UI copy) |
| Description / caption | `text-sm text-muted-foreground` |
| Label | `text-sm font-medium` (via `Label`) |
| Table header | `text-sm font-medium text-muted-foreground` |
| Badge / meta | `text-xs font-medium` |

### 3.3 Font size utilities

| Utility | rem |
|---------|-----|
| `text-xs` | 0.75 |
| `text-sm` | 0.875 |
| `text-base` | 1 |
| `text-lg` | 1.125 |
| `text-xl` | 1.25 |
| `text-2xl` | 1.5 |
| `text-3xl` | 1.875 |
| `text-4xl` | 2.25 |

Use `text-sm` as the default for interactive UI. Reserve `text-base` for mobile input legibility (Input uses `text-base md:text-sm` per shadcn).

---

## 4. Component Sizing (shadcn new-york)

These are the **canonical** sizes from `components/ui/`. Do not override with custom heights unless a shadcn size variant exists.

### 4.1 Button

| Size | Height | Notes |
|------|--------|-------|
| `default` | `h-9` | Standard action |
| `sm` | `h-8` | Compact toolbar |
| `lg` | `h-10` | Prominent CTA |
| `xs` | `h-6` | Dense UI |
| `icon` | `size-9` | Icon-only |
| `icon-sm` | `size-8` | |
| `icon-lg` | `size-10` | |

Focus: `focus-visible:ring-[3px] focus-visible:ring-ring/50` — not `ring-2 ring-offset-2`.

### 4.2 Input / Textarea / Select

| Component | Height | Text |
|-----------|--------|------|
| Input | `h-9` | `text-base md:text-sm` |
| Textarea | min `h-16` | `text-sm` |
| Select trigger (default) | `h-9` | `text-sm` |
| Select trigger (sm) | `h-8` | `text-sm` |

Do **not** add `className="h-10"` on inputs or selects — use default or `size="sm"`.

### 4.3 Tabs

Use stock `Tabs`, `TabsList`, `TabsTrigger` without custom height/padding overrides.

| Part | Size |
|------|------|
| TabsList | `h-8`, `p-[3px]`, `rounded-lg`, `bg-muted` |
| TabsTrigger | `text-sm`, `px-1.5 py-0.5` |

```tsx
<Tabs defaultValue="brands" className="gap-4">
  <TabsList>
    <TabsTrigger value="brands">Markalar</TabsTrigger>
    <TabsTrigger value="products">Ürünler</TabsTrigger>
  </TabsList>
  <TabsContent value="brands">...</TabsContent>
</Tabs>
```

### 4.4 Card

```tsx
<Card>                    {/* rounded-xl border shadow-sm py-6 */}
  <CardHeader />          {/* px-6, gap-2 */}
  <CardTitle />           {/* font-semibold leading-none */}
  <CardDescription />     {/* text-sm text-muted-foreground */}
  <CardContent />         {/* px-6 */}
  <CardFooter />          {/* px-6 */}
</Card>
```

`AdminCard` is a thin alias over `Card` — no custom padding overrides.

### 4.5 Table

Default row height follows shadcn Table (`h-10` for head cells). Use the stock `Table`, `TableHead`, `TableCell` without custom density classes.

### 4.6 Badge

`text-xs font-medium`, icon size `size-3`, focus ring `ring-[3px]`.

### 4.7 Icons (lucide-react)

Button icons auto-size to `size-4` via `[&_svg:not([class*='size-'])]:size-4`.

```tsx
<Search className="size-4" />   // inline with text / button
<Package className="size-5" />  // standalone decorative
```

---

## 5. Layout & Spacing

### 5.1 Container

```tsx
<div className="container mx-auto px-8">
```

Max width: `1400px` (custom `@utility container` in globals.css).

### 5.2 Spacing scale

Use Tailwind defaults. Page sections: `space-y-6`. Form fields: `space-y-4` / field groups `space-y-2`.

### 5.3 Page template

```tsx
<main className="container mx-auto px-8 py-8">
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Page Title</h1>
      <p className="text-sm text-muted-foreground">Description</p>
    </div>
    {/* content */}
  </div>
</main>
```

### 5.4 Admin layout

Admin uses the **same** shadcn sizing as storefront — no compact density mode.

```tsx
import { AdminPageShell, AdminPageHeader } from '@/components/admin/admin-page-shell'
import { AdminCard, AdminCardHeader, AdminCardTitle, AdminCardContent } from '@/components/admin/admin-card'

<AdminPageShell>
  <AdminPageHeader title="Products" description="Manage catalog" />
  <AdminCard>
    <AdminCardHeader>
      <AdminCardTitle>Section</AdminCardTitle>
    </AdminCardHeader>
    <AdminCardContent>{/* ... */}</AdminCardContent>
  </AdminCard>
</AdminPageShell>
```

Admin loading states use `AdminLoadingState` (spinner). Storefront uses `Skeleton`.

---

## 6. Component Architecture

### 6.1 Server / client boundary

```
app/[locale]/page.tsx          → Server (data fetch)
components/feature/Widget.tsx  → Client (interactivity)
components/ui/button.tsx       → Client (Radix / events)
```

### 6.2 `"use client"` rules

Add only when using: `useState`, `useEffect`, `useContext`, event handlers, browser APIs, or hooks that depend on them.

### 6.3 Props

```tsx
interface WidgetProps {
  data: Data
  className?: string   // always include for composability
}
```

Use `interface`, not `type`, for props.

### 6.4 Updating shadcn components

```bash
bunx shadcn@latest add button input card select dialog sheet --overwrite
```

After registry updates, fix any renamed props (e.g. `hideDefaultClose` → `showCloseButton` on `SheetContent`).

---

## 7. Available Components (`components/ui/`)

| Component | Notes |
|-----------|-------|
| **Button** | Variants: default, destructive, outline, secondary, ghost, link. Sizes: default, sm, lg, xs, icon, icon-sm, icon-lg |
| **Card** | Compound: Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction |
| **Input / Textarea / Label** | h-9, ring-[3px] focus |
| **Select** | `size="default" \| "sm"` on SelectTrigger |
| **Dialog / Sheet** | SheetContent: `showCloseButton` prop |
| **DropdownMenu / Command / Tabs** | Radix-based, stock shadcn |
| **Table / Badge / Alert / Tooltip** | Stock shadcn |
| **Checkbox / Switch / Skeleton / Sonner** | Stock shadcn |
| **Pagination / SafeImage** | Project-specific extensions |

Add new primitives:

```bash
bunx shadcn@latest add accordion avatar calendar
```

---

## 8. Form Patterns

```tsx
<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="email">Email</Label>
    <Input id="email" type="email" placeholder="name@example.com" {...register('email')} />
    {errors.email && (
      <p className="text-sm text-destructive">{errors.email.message}</p>
    )}
  </div>
  <Button type="submit" disabled={isSubmitting}>Sign In</Button>
</form>
```

Select:

```tsx
<Select onValueChange={field.onChange} value={field.value}>
  <SelectTrigger className="w-full">
    <SelectValue placeholder="Select..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Option A</SelectItem>
  </SelectContent>
</Select>
```

---

## 9. Loading, Empty & Error States

Every data-fetching view handles:

| State | Storefront | Admin |
|-------|------------|-------|
| Loading | `<Skeleton />` | `<AdminLoadingState />` |
| Empty | Custom empty component | Custom empty component |
| Error | `<Alert variant="destructive">` | Same |

Toasts via `sonner`:

```tsx
import { toast } from 'sonner'
toast.success('Saved')
```

---

## 10. Focus, Accessibility & Dark Mode

- Focus rings: `focus-visible:ring-[3px] focus-visible:ring-ring/50` (shadcn default)
- All interactive elements need visible labels (`Label`, `aria-label`, or `sr-only`)
- Dark mode: `.dark` class via `next-themes` — tokens auto-switch in `globals.css`
- Reduced motion: `motion-safe:` / `motion-reduce:` prefixes

---

## 11. File Conventions

```
components/ui/           → kebab-case (button.tsx) — shadcn primitives
components/my-feature/   → PascalCase (MyWidget.tsx)
hooks/                   → camelCase (useSearch.ts)
lib/                     → kebab-case
```

Imports always use `@/` alias.

---

## 12. Quick Reference

### Dialog

```tsx
<Dialog>
  <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogHeader>
    <DialogFooter><Button type="submit">Confirm</Button></DialogFooter>
  </DialogContent>
</Dialog>
```

### Sheet

```tsx
<SheetContent side="left" showCloseButton={false}>
  {/* custom close if needed */}
</SheetContent>
```

### Data table

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead className="text-right">Price</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell className="text-right">{item.price}</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

---

## 13. Checklist

- [ ] Uses shadcn/ui primitives — no custom buttons, inputs, cards
- [ ] Component sizes match defaults (h-9 buttons/inputs, no h-10 overrides)
- [ ] Semantic color tokens only — no hardcoded palette
- [ ] Geist Sans via `font-sans` — no custom font overrides
- [ ] Typography: `text-2xl` page titles, `text-sm` body, `text-muted-foreground` descriptions
- [ ] Focus rings: `ring-[3px] ring-ring/50`
- [ ] `className` prop for composability
- [ ] Correct server/client boundary
- [ ] Loading, empty, and error states handled
- [ ] Icons from `lucide-react` at `size-4` in buttons
- [ ] Mobile-first responsive layout
- [ ] Accessible labels and keyboard navigation
