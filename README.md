# Sneaker Drop - Realtime Server

The backend API for the Sneaker Drop system, handling atomic reservations and real-time synchronization.

**Repo:** [https://github.com/RownokNishat/sneak-realtime-server](https://github.com/RownokNishat/sneak-realtime-server)

## Setup
1. `npm install`
2. Set `DATABASE_URL` in `.env`:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/sneaker_drop"
   ```
3. `npx prisma db push`
4. `npm run dev`

## Architecture Choices

### Atomic Concurrency
This server prevents overselling by using atomic SQL updates:
```sql
UPDATE "Drop" SET "availableStock" = "availableStock" - 1 WHERE id = $1 AND "availableStock" > 0;
```
This ensures that the database handles the race condition at the row level, making it impossible to reserve more items than are available.

### Stock Recovery
A background worker (`stockService.js`) polls every 3 seconds to find expired reservations and restores their stock to the available pool atomically.
