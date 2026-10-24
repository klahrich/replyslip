ALTER TABLE "watcher_keys" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;
