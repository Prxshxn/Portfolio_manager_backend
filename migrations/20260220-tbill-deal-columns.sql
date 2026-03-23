-- Optional manual migration: expand `tbill` for T-bill transaction storage.
-- The application also auto-adds missing columns on first POST via tbillModel.ensureSchema().
-- Run only if you prefer DB changes applied before deploy.

-- If your `tbill` table is empty/minimal, you can instead rely on the app's CREATE TABLE path.
