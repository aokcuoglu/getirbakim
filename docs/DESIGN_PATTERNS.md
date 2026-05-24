# Design Patterns & UI Guidelines

> **Version:** 2.0 — Last updated: 2026-05-24
> **Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui (new-york, neutral)
> **Icon Library:** lucide-react · **Animations:** tw-animate-css

---

## 1. Philosophy

- **shadcn/ui-first:** Every UI decision starts from the shadcn/ui catalog. Do not build custom primitives — extend existing ones via composition or className overrides.
- **Tailwind-native:** Styles live in JSX via Tailwind utility classes. No CSS Modules, no styled-components, no separate `.scss` files for components.
- **CSS custom properties for tokens:** Colors, radius, shadows are defined via CSS variables in `app/globals.css`. Never hardcode hex/HSL values in component markup.
- **Server components by default:** Pages are server components. Only add `'use client'` when interactivity (state, effects, event handlers) is required.
- **Composition over configuration:** Compose small, focused components rather than building monolithic, prop-heavy components.

---

## 2. Color System & Design Tokens

### 2.1 Semantic Tokens (always use these)

| Token | Usage | Example |
|-------|-------|---------|
| `bg-background text-foreground` | Page body | `<body>` |
| `bg-card text-card-foreground` | Card surfaces | `Card` |
| `bg-primary text-primary-foreground` | Primary actions | `Button variant="default"` |
| `bg-secondary text-secondary-foreground` | Secondary surfaces | `Button variant="secondary"` |
| `bg-muted text-muted-foreground` | Dimmed text, placeholders | Descriptions, captions |
| `bg-accent text-accent-foreground` | Hover/key highlights | `Button variant="ghost"` |
| `bg-destructive text-destructive-foreground` | Errors, deletes | `Button variant="destructive"` |
| `border-border` | Borders | Default border |
| `ring-ring` | Focus rings | `focus-visible:ring-2 ring-ring` |

### 2.2 Never Hardcode Colors

```tsx
// ❌ BAD
<div className="bg-[#1a1a2e] text-[#e0e0e0]">

// ✅ GOOD
<div className="bg-card text-card-foreground">
```

### 2.3 Opacity Modifiers

Tailwind v4 opacity syntax:
```
bg-primary/90        → 90% opacity
text-muted-foreground/70 → 70% opacity
border-border/50     → 50% opacity
```

### 2.4 Custom Design Tokens (globals.css)

```css
@theme {
  --color-brand-accent: #818cf8;
  --radius-card: var(--radius-lg);
}

/* Usage: */
<div className="bg-brand-accent rounded-card">
```

---

## 3. Typography

```tsx
// Headings: use --font-heading (defined in layout)
<h1 className="text-3xl font-bold tracking-tight lg:text-4xl">Page Title</h1>
<h2 className="text-2xl font-semibold tracking-tight">Section Title</h2>
<h3 className="text-xl font-semibold">Card Title</h3>
<h4 className="text-lg font-medium">Sub Heading</h4>

// Body
<p className="text-base text-foreground">Body text</p>
<p className="text-sm text-muted-foreground">Descriptions, captions</p>
<p className="text-xs text-muted-foreground">Legal, footnotes</p>

// Gradient accent (hero/campaign)
<h1 className="text-gradient text-4xl font-bold">Campaign Headline</h1>
```

### Font Size Scale

| Utility | Size (rem) |
|---------|-----------|
| `text-xs` | 0.75 |
| `text-sm` | 0.875 |
| `text-base` | 1 |
| `text-lg` | 1.125 |
| `text-xl` | 1.25 |
| `text-2xl` | 1.5 |
| `text-3xl` | 1.875 |
| `text-4xl` | 2.25 |
| `text-5xl` | 3 |

---

## 4. Layout & Spacing

### 4.1 Container

```tsx
// Global container (max-w-[1400px] via globals.css utility)
<div className="container mx-auto px-8">
```

### 4.2 Spacing Scale

Use Tailwind's default scale. Prefer multiples of 4:
```
p-2 (8px)   p-4 (16px)   p-6 (24px)   p-8 (32px)   p-12 (48px)
gap-2       gap-4        gap-6        gap-8
space-y-2   space-y-4    space-y-6    space-y-8
```

### 4.3 Page Layout Template

```tsx
// app/[locale]/some-page/page.tsx (Server Component)
import { SomePageClient } from './SomePageClient'

export default async function SomePage() {
  // Data fetching here...
  return <SomePageClient data={data} />
}

// SomePageClient.tsx (Client Component)
'use client'

export function SomePageClient({ data }: Props) {
  return (
    <main className="container mx-auto px-8 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Page Title</h1>
        <p className="text-muted-foreground mt-2">Page description</p>
      </header>
      <section className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {/* Content */}
      </section>
    </main>
  )
}
```

### 4.4 Admin Layout (Glassmorphism)

```tsx
// Admin panels may use glass utilities
<div className="glass-card rounded-2xl p-6">
  <h2 className="text-gradient text-xl font-semibold mb-4">Panel Title</h2>
  {/* content */}
</div>

// Sidebar
<aside className="glass-sidebar w-64 min-h-screen sidebar-scroll">
  {/* nav items */}
</aside>
```

### 4.5 Admin Compact Density (New York)

Admin UI uses shadcn **new-york** style with tighter spacing than storefront pages.

| Token / Pattern | Value |
|-----------------|-------|
| Page section spacing | `space-y-4` |
| Page header | `p-4`, title `text-xl font-semibold` |
| Admin card padding | `p-4` via `AdminCard` wrapper |
| Buttons in admin | prefer `size="sm"` |
| Inputs | default `h-9` |
| Table headers | `text-xs font-medium uppercase tracking-wide text-muted-foreground`, row `h-10` |
| Filter chips | `rounded-full border px-2.5 py-0.5 text-xs font-medium` |
| Sidebar collapsed width | `w-16` (64px) |
| Admin loading | centered **spinner** (`Loader2`), not skeleton |

```tsx
import { AdminCard, AdminCardHeader, AdminCardTitle, AdminCardContent } from '@/components/admin/admin-card'
import { AdminLoadingState } from '@/components/admin/admin-loading-state'

<AdminCard>
  <AdminCardHeader>
    <AdminCardTitle>Section</AdminCardTitle>
  </AdminCardHeader>
  <AdminCardContent>{/* ... */}</AdminCardContent>
</AdminCard>
```

Storefront pages keep skeleton loading patterns; admin pages use spinner loading.

---

## 5. Component Architecture

### 5.1 Server / Client Boundary

```
Rule: Pages are Server Components. Leaf components are Client Components.

app/[locale]/products/page.tsx       → Server (fetch, render skeleton)
components/products/ProductList.tsx  → Client (interactivity, state)
components/ui/button.tsx             → Client (forwardRef, event handlers)
```

```tsx
// Server Component (page.tsx)
import { Suspense } from 'react'
import { ProductList } from '@/components/products/ProductList'
import { ProductListSkeleton } from '@/components/products/ProductListSkeleton'

export default async function ProductsPage() {
  const products = await fetchProducts()

  return (
    <Suspense fallback={<ProductListSkeleton />}>
      <ProductList products={products} />
    </Suspense>
  )
}
```

### 5.2 `"use client"` Boundary Rules

Add `"use client"` **only when** the component uses:
- `useState` / `useReducer`
- `useEffect` / `useLayoutEffect`
- `useContext`
- Event handlers (`onClick`, `onChange`)
- Browser APIs (`window`, `document`)
- Custom hooks with any of the above

If a component only renders children and applies classes, keep it as a server component.

### 5.3 Props & TypeScript

```tsx
// Always use interface for props (project convention)
interface ProductCardProps {
  product: Product
  variant?: 'default' | 'compact'
  onAddToCart?: (id: string) => void
  className?: string      // ← Always include className for composability
}

// NEVER: type ProductCardProps = { ... }
```

### 5.4 Component Composition Pattern

```tsx
// ✅ Prefer compound components (shadcn Card pattern)
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>Content</CardContent>
  <CardFooter>Footer actions</CardFooter>
</Card>

// ❌ Avoid single monolithic component with many props
<Card title="Title" description="Desc" content="..." footer="..." />
```

---

## 6. shadcn/ui Component Catalog & Usage

### 6.1 Available Components (existing in `components/ui/`)

| Component | File | Key Features |
|-----------|------|--------------|
| **Button** | `button.tsx` | CVA variants: default, destructive, outline, secondary, ghost, link. Sizes: default, sm, lg, icon. `asChild` support. |
| **Card** | `card.tsx` | Compound: Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| **Input** | `input.tsx` | forwardRef, default border-input styling |
| **Textarea** | `textarea.tsx` | forwardRef, same styling as Input |
| **Label** | `label.tsx` | Radix Label wrapper, `peer` compatibility |
| **Badge** | `badge.tsx` | CVA: default, secondary, destructive, outline |
| **Dialog** | `dialog.tsx` | Radix Dialog wrapper: DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter |
| **Sheet** | `sheet.tsx` | Radix Dialog-based side panel: SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter |
| **Select** | `select.tsx` | Radix Select: SelectTrigger, SelectValue, SelectContent, SelectItem |
| **DropdownMenu** | `dropdown-menu.tsx` | Radix DropdownMenu: DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, etc. |
| **Command** | `command.tsx` | cmdk-based: CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem |
| **Tabs** | `tabs.tsx` | Radix Tabs: TabsList, TabsTrigger, TabsContent |
| **Checkbox** | `checkbox.tsx` | Radix Checkbox |
| **Switch** | `switch.tsx` | Radix Switch |
| **Tooltip** | `tooltip.tsx` | Radix Tooltip: TooltipProvider, TooltipTrigger, TooltipContent |
| **Table** | `table.tsx` | Compound: Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption, TableFooter |
| **Skeleton** | `skeleton.tsx` | `rounded-md bg-muted animate-pulse` |
| **Alert** | `alert.tsx` | CVA: default, destructive |
| **Sonner** | `sonner.tsx` | Toaster wrapper (sonner) |
| **Pagination** | `Pagination.tsx` | Page navigation |
| **SafeImage** | `SafeImage.tsx` | Next.js Image wrapper with fallback |

### 6.2 Adding New shadcn/ui Components

```bash
# Run the shadcn CLI to add a component
bunx shadcn@latest add accordion
bunx shadcn@latest add avatar
bunx shadcn@latest add calendar
```

The component will be placed in `components/ui/` with the project's conventions already applied.

### 6.3 Extending Components via className

```tsx
// Extend, don't fork. Use className and data-* attributes.
<Button
  variant="outline"
  size="lg"
  className="w-full border-dashed hover:border-primary hover:text-primary"
  data-loading={isLoading}
>
  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  Submit
</Button>
```

### 6.4 Icon Usage (lucide-react)

```tsx
import { Search, ShoppingCart, ChevronRight, Loader2 } from 'lucide-react'

// Standard size classes
<Search className="h-4 w-4" />          // inline with text
<Search className="h-5 w-5" />          // button icon
<Search className="h-6 w-6" />          // standalone icon
<Search className="h-8 w-8" />          // large decorative

// With button
<Button size="icon" variant="ghost">
  <ShoppingCart className="h-5 w-5" />
</Button>
```

---

## 7. Form Patterns

### 7.1 react-hook-form + zod

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const formSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

type FormValues = z.infer<typeof formSchema>

export function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  })

  const onSubmit = async (data: FormValues) => {
    // Server action or API call
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="name@example.com"
          {...register('email')}
          aria-invalid={!!errors.email}
        />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          {...register('password')}
          aria-invalid={!!errors.password}
        />
        {errors.password && (
          <p className="text-sm text-destructive">{errors.password.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign In
      </Button>
    </form>
  )
}
```

### 7.2 Select Field Pattern

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

<Select onValueChange={(v) => field.onChange(v)} value={field.value}>
  <SelectTrigger className="w-full">
    <SelectValue placeholder="Select a vehicle..." />
  </SelectTrigger>
  <SelectContent>
    {vehicles.map((v) => (
      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

### 7.3 Search / Command Pattern

```tsx
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'

<Command className="rounded-lg border shadow-md">
  <CommandInput placeholder="Search parts..." />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      {items.map((item) => (
        <CommandItem key={item.id} onSelect={() => handleSelect(item)}>
          <Search className="mr-2 h-4 w-4" />
          {item.name}
        </CommandItem>
      ))}
    </CommandGroup>
  </CommandList>
</Command>
```

---

## 8. Loading, Empty & Error States

### 8.1 This is Mandatory

Every data-fetching component MUST handle three states:
```tsx
if (status === 'pending')   → <ComponentSkeleton />  // storefront
if (status === 'pending')   → <AdminLoadingState />  // admin panels
if (status === 'error')     → <ComponentError onRetry={refetch} />
if (isEmpty(data))          → <ComponentEmpty />
```

### 8.2 Skeleton Pattern

```tsx
import { Skeleton } from '@/components/ui/skeleton'

function ProductCardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="aspect-square rounded-xl" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

// Usage in parent:
function ProductGrid({ products, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    )
  }
  // ...
}
```

### 8.3 Empty State Pattern

```tsx
import { PackageOpen } from 'lucide-react'

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <PackageOpen className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
```

### 8.4 Error State Pattern

```tsx
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="max-w-lg mx-auto my-12">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>{error.message || 'An unexpected error occurred.'}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="w-fit">
            Try Again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
```

### 8.5 Toast Notifications

```tsx
import { toast } from 'sonner'

// Success
toast.success('Item added to cart')

// Error
toast.error('Failed to add item')

// Promise-based
toast.promise(saveChanges(), {
  loading: 'Saving...',
  success: 'Saved successfully',
  error: 'Failed to save',
})
```

---

## 9. Responsive Design

### 9.1 Mobile-First Breakpoints

```tsx
// Always build mobile-first
<div className="
  grid
  grid-cols-1           // mobile: 1 column
  sm:grid-cols-2        // small: 2 columns
  md:grid-cols-3        // medium: 3 columns
  lg:grid-cols-4        // large: 4 columns
  xl:grid-cols-5        // extra: 5 columns
  gap-4 sm:gap-6
">
```

### 9.2 Responsive Values

| Modifier | Width |
|----------|-------|
| _default_ | < 640px |
| `sm:` | ≥ 640px |
| `md:` | ≥ 768px |
| `lg:` | ≥ 1024px |
| `xl:` | ≥ 1280px |
| `2xl:` | ≥ 1536px |

### 9.3 Navigation Responsiveness

```tsx
// Desktop: full navbar, Mobile: hamburger + Sheet
<>
  {/* Desktop */}
  <nav className="hidden md:flex items-center gap-6">
    <NavLinks />
  </nav>

  {/* Mobile */}
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="ghost" size="icon" className="md:hidden">
        <Menu className="h-5 w-5" />
      </Button>
    </SheetTrigger>
    <SheetContent side="left">
      <SheetHeader>
        <SheetTitle>Menu</SheetTitle>
      </SheetHeader>
      <NavLinks mobile />
    </SheetContent>
  </Sheet>
</>
```

---

## 10. Dark Mode

Dark mode is handled via `next-themes` with the `.dark` class strategy.

```tsx
// globals.css already defines:
// :root { } for light mode
// .dark { } for dark mode

// Toggle button:
import { useTheme } from 'next-themes'

function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
```

---

## 11. Accessibility

- All interactive elements must have accessible labels (aria-label, sr-only, or visible label).
- Focus states: All components use `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`.
- Color contrast: Use semantic tokens (they are already contrast-safe).
- Keyboard navigation: Preserve tab order, use `asChild` on Sheet/Dialog triggers for custom buttons.
- `prefers-reduced-motion`: Use `motion-safe:` / `motion-reduce:` prefixes for animations.

---

## 12. Performance

### 12.1 Image Optimization

```tsx
import { SafeImage } from '@/components/ui/SafeImage'

// SafeImage wraps next/image with fallback
<SafeImage
  src={product.image}
  alt={product.name}
  width={400}
  height={400}
  className="aspect-square rounded-xl object-cover"
/>
```

### 12.2 Dynamic Imports

```tsx
import dynamic from 'next/dynamic'

const HeavyComponent = dynamic(
  () => import('@/components/HeavyComponent').then(mod => mod.HeavyComponent),
  {
    loading: () => <Skeleton className="h-96 w-full" />,
    ssr: false, // if it uses browser APIs
  }
)
```

### 12.3 Server Components for Data Fetching

Keep data fetching in server components. Pass serialized data down as props. This eliminates client-side waterfalls.

---

## 13. File Naming & Folder Conventions

### 13.1 Naming

```
components/
  ui/           → kebab-case files: button.tsx, dropdown-menu.tsx
  products/     → PascalCase component files: ProductCard.tsx, ProductGrid.tsx
  my-feature/   → PascalCase: MyFeatureDialog.tsx, MyFeatureForm.tsx

hooks/          → camelCase: useSearch.ts, useDebounce.ts, useGarage.ts
lib/            → kebab-case: auth-utils.ts, catalog-url.ts
app/            → Next.js convention: page.tsx, layout.tsx, loading.tsx
```

### 13.2 Feature Folder Structure

```
components/checkout/
  CheckoutForm.tsx          # Main checkout component
  CheckoutFormSkeleton.tsx  # Loading state
  AddressStep.tsx           # Sub-step
  PaymentStep.tsx           # Sub-step
  OrderSummary.tsx          # Sidebar
```

### 13.3 Import Convention

```tsx
// Always use @/ alias, never relative paths across directories
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCart } from '@/hooks/use-cart'
import type { Product } from '@/lib/types'

// NEVER:
import { Button } from '../../../components/ui/button'
```

---

## 14. Quick Reference: Common UI Patterns

### Modal / Dialog

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button>Open</Button>
  </DialogTrigger>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
    </DialogHeader>
    {/* Body */}
    <DialogFooter>
      <Button type="submit">Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Side Panel / Sheet

```tsx
<Sheet>
  <SheetTrigger asChild>
    <Button variant="outline">Open</Button>
  </SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Title</SheetTitle>
      <SheetDescription>Description</SheetDescription>
    </SheetHeader>
    {/* Body */}
  </SheetContent>
</Sheet>
```

### Dropdown Menu

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline">Actions</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLabel>My Account</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem>Profile</DropdownMenuItem>
    <DropdownMenuItem>Settings</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem className="text-destructive">Log out</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Data Table

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Price</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {items.map((item) => (
      <TableRow key={item.id}>
        <TableCell className="font-medium">{item.name}</TableCell>
        <TableCell><Badge variant="outline">{item.status}</Badge></TableCell>
        <TableCell className="text-right">${item.price}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

### Tabs

```tsx
<Tabs defaultValue="account" className="w-full">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
    <TabsTrigger value="notifications">Notifications</TabsTrigger>
  </TabsList>
  <TabsContent value="account"><AccountTab /></TabsContent>
  <TabsContent value="password"><PasswordTab /></TabsContent>
  <TabsContent value="notifications"><NotificationsTab /></TabsContent>
</Tabs>
```

---

## 15. Checklist: Before Submitting Code

- [ ] Uses only Tailwind utility classes (no inline styles, no CSS modules, no hardcoded hex colors)
- [ ] Uses shadcn/ui primitives — no custom buttons, inputs, cards
- [ ] Has `className` prop for composability
- [ ] Proper server/client boundary (`'use client'` only where needed)
- [ ] Handles loading, empty, and error states
- [ ] TypeScript: strict, no `any`, proper interfaces
- [ ] Uses `@/` path alias for imports
- [ ] Icons from `lucide-react`
- [ ] Responsive (mobile-first)
- [ ] Accessible (labels, focus, contrast)
- [ ] No comments (remove them)
