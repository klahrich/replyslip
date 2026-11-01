-- Site demo: one suggested question per position, stored once per language (en and fr), so the page can show
-- the same three chips in either UI language. Each answer is its own row and is checked (approved) on its own.
-- `position` already exists (import wrote the question's index). This re-derives it per business as 0, 1, 2, ...
-- in a fixed order (position, generated_at, id), which leaves today's rows (0, 1, 2, one language each) as they
-- are and only renumbers a business whose positions repeat. Nothing else changes: answers, languages and
-- checked_at stay as they are, so checked rows stay checked.
-- The table holds a few dozen rows, so a plain CREATE UNIQUE INDEX inside the migrator's transaction is instant.
WITH ordered AS (
	SELECT "id", (row_number() OVER (PARTITION BY "business_id" ORDER BY "position", "generated_at", "id") - 1)::integer AS "new_position"
	FROM "site_suggested_answers"
)
UPDATE "site_suggested_answers" AS "s"
SET "position" = "ordered"."new_position"
FROM "ordered"
WHERE "s"."id" = "ordered"."id" AND "s"."position" IS DISTINCT FROM "ordered"."new_position";
--> statement-breakpoint
DROP INDEX IF EXISTS "site_suggested_answers_question_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "site_suggested_answers_position_language_unique" ON "site_suggested_answers" USING btree ("business_id","position","language");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_suggested_answers_position_check' AND conrelid = 'public.site_suggested_answers'::regclass) THEN
		ALTER TABLE "site_suggested_answers" ADD CONSTRAINT "site_suggested_answers_position_check" CHECK ("position" >= 0) NOT VALID;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "site_suggested_answers" VALIDATE CONSTRAINT "site_suggested_answers_position_check";
