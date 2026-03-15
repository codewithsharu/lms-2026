# lms-2026

## Backend startup schema setup (no manual migration step)

Schema rule: keep a single source of truth in `backend/database/schema.sql`.
Do not create separate migration files for new tables/features; append all new DB objects to `schema.sql` (idempotent style).

Use these environment variables in `backend/.env` (or your hosting provider env settings):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_DB_URL`
- `AUTO_SCHEMA_SYNC_ON_START=true`

Optional:

- `SCHEMA_SQL_PATH=database/schema.sql`
- `REQUIRED_SCHEMA_TABLES=users,classes,sections,student_details,teacher_details,teacher_assignments,audit_logs,assessment_templates,hosted_assessments`

When backend starts, it now:

1. Checks required schema tables.
2. If any table is missing, applies `database/schema.sql` automatically.
3. Triggers PostgREST schema reload.
4. Starts server only after schema check/sync finishes.

## Next-time deployment checklist

1. Set all backend env values (especially `SUPABASE_DB_URL`).
2. Keep `AUTO_SCHEMA_SYNC_ON_START=true` in server environment.
3. Deploy/restart backend normally.
4. Verify `GET /api/db-status` returns `status: connected` with no missing tables.
5. Run app flow (template create + host assessment) to confirm functional readiness.
