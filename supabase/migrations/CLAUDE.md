# Migration conventions
- timestamptz for time-of-event, date for date-only
- Explicit GRANTs to authenticated + service_role (see initial_schema.sql template)
- Realtime tables: add to supabase_realtime publication + REPLICA IDENTITY FULL
- Tables with updated_at: add the updated_at_auto trigger
- Reversibility: prefer additive changes; flag destructive ones in PR description
- ALTER DATABASE / ALTER ROLE on custom GUCs: BLOCKED in Supabase-hosted Postgres.
  Use Vault (vault.create_secret) instead, with a SECURITY DEFINER helper that reads
  vault.decrypted_secrets.
