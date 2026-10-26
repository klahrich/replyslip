ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wants_sharing" boolean NOT NULL DEFAULT false;
