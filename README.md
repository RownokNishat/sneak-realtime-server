# Sneaker Drop - Realtime Server

High-concurrency backend for limited sneaker drops.

**Repo**: [https://github.com/RownokNishat/sneak-realtime-server](https://github.com/RownokNishat/sneak-realtime-server)

## How to Run

1. `npm install`
2. Configure `.env` with `DATABASE_URL` (PostgreSQL).
3. `npx prisma db push`
4. `npm run dev`

## Architecture & Design

### 60-Second Expiration Logic

We handle expiration using a background worker (`stockService.js`):

- Every reservation is created with an `expiresAt` field (`now + 60s`).
- A background process runs every 3 seconds to find `ACTIVE` reservations that have passed their expiry time.
- These are updated to `EXPIRED`, and the stock is returned to the inventory pool atomically using a single database transaction to ensure consistency.

### Concurrency Handling

To prevent multiple users from claiming the same last item, we use **Atomic SQL Updates** instead of standard "Read-then-Write" logic:

```sql
UPDATE "Drop"
SET "availableStock" = "availableStock" - 1
WHERE id = $1 AND "availableStock" > 0;
```

This ensures the database acts as the single source of truth for stock counts. Even under extreme load, the database guarantees that the stock will never go below zero. We also implement transaction retries with exponential backoff to handle write-lock contentions during peak traffic.
