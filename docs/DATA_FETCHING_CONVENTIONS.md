# Data Fetching Conventions

This document defines the standard approach for database queries in the v0-only catalog project.

## Rule of Thumb

> **Simple queries → Prisma ORM (`findMany`, `findUnique`, etc.)**
> **Complex queries → Raw SQL (`$queryRaw` with `Prisma.sql`)**

---

## 1. Prisma ORM (findMany / findUnique)

Use Prisma ORM when:
- Querying a **single table** with simple filters
- No joins or only simple `include`/`select` relations
- Code clarity and type safety are the priority
- The result set is small (< 1000 rows)

```ts
import { db } from '@/lib/db'

const brands = await db.ptbrands.findMany({
  where: { name: { contains: query, mode: 'insensitive' } },
  orderBy: { name: 'asc' },
  take: 50
})
```

```ts
const product = await db.ptproducts.findUnique({
  where: { id: productId }
})
```

### When NOT to use Prisma ORM

- Multi-table joins with 3+ tables
- Aggregate queries (SUM, COUNT with complex GROUP BY)
- Queries using PostgreSQL-specific features (ILIKE, JSONB operations, array functions)
- Performance-critical hot paths (see performance note below)

---

## 2. Raw SQL ($queryRaw)

Use raw SQL when:
- Querying **multiple joined tables** (especially 3+)
- Using **PostgreSQL-specific syntax** (ILIKE, JSONB, window functions)
- **Performance-critical** paths (brand pages, search, product detail)
- Aggregation queries with complex grouping

```ts
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

const rows = await db.$queryRaw<Array<{ id: number; name: string }>>(
  Prisma.sql`
    SELECT p.id, p.title AS name
    FROM v0.ptproducts p
    JOIN v0.ptbrands b ON b.id = p.ptbrands_id
    WHERE b.name ILIKE ${'%' + query + '%'}
    ORDER BY p.title
    LIMIT ${limit} OFFSET ${offset}
  `
)
```

### SQL Fragments

Reusable fragments for raw SQL are in `lib/sql/`:

```ts
import { dproductBrandNameExpr } from '@/lib/sql/dproduct-catalog'
import { dproductDetailsJoin } from '@/lib/sql/dproduct-details'

const rows = await db.$queryRaw(...Prisma.sql`
  SELECT ${dproductBrandNameExpr} AS brand
  FROM v0.dproducts d
  ${dproductDetailsJoin}
`)
```

---

## 3. Performance Comparison

**Prisma ORM (`findMany`)** adds overhead:
- Query engine parses and validates the query
- Result rows are mapped to typed JS objects
- Each `include` generates separate SQL queries (N+1 risk)

**Raw SQL (`$queryRaw`)** is faster because:
- No query engine overhead — SQL goes directly to PostgreSQL
- Single query for complex joins (no N+1)
- Full control over the query plan

### Measured Difference

For the v0 catalog's main query (dpmatch + dproducts + dbrands + dproduct_details + ptproducts + ptbrands — 6 tables joined), raw SQL is approximately **2-5x faster** than the equivalent Prisma ORM query.

### Recommendation

| Query Type | Method | Reason |
|---|---|---|
| Single table lookup by ID | `findUnique` | Simple, type-safe |
| Simple list with 1-2 filters | `findMany` | Clear, maintainable |
| Multi-table join (3+ tables) | `$queryRaw` | Performance |
| Aggregation / GROUP BY | `$queryRaw` | Flexibility |
| Full-text search | `$queryRaw` + `ILIKE` / `tsvector` | PostgreSQL features |
| Paginated list with filters | `$queryRaw` | Single round-trip |

---

## 4. Type Safety with Raw SQL

Always type the result:

```ts
type BrandRow = {
  id: number
  name: string
  logo_url: string | null
}

const rows = await db.$queryRaw<BrandRow[]>(
  Prisma.sql`SELECT id, name, logo_url FROM v0.ptbrands`
)
```

For parameters, always use `Prisma.sql` tagged template literals — never concatenate strings:

```ts
// GOOD - safe from SQL injection
Prisma.sql`SELECT * FROM v0.ptproducts WHERE title ILIKE ${'%' + query + '%'}`

// BAD - SQL injection risk
Prisma.sql`SELECT * FROM v0.ptproducts WHERE title ILIKE '%${query}%'`
```

---

## 5. Caching Strategy

- Use `unstable_cache` from Next.js for data that changes infrequently (brand lists, category trees)
- Set appropriate `revalidate` times based on data freshness requirements
- For real-time data (stock levels, prices), bypass cache or use short TTLs
