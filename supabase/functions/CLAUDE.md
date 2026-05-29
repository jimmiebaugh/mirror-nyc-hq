# Edge function conventions
- Self-invoking functions: verify_jwt = false in config.toml; pick the internalAuth helper by surface: requireInternalOrAdminUser for admin-only / service-role surfaces (Talent Scout), requireInternalOrUserAuth only for machine-only / cron surfaces (canon: docs/auth-model.md)
- Anthropic: callClaude('talent_scout' | 'venue_scout' | 'hq', ...); never raw fetch
- Email: _shared/sendEmail.ts (general) or _shared/packetRender.ts sendPacketEmail (packet path)
- Service-account Google: _shared/gmailServiceAccount.ts is the template
- DO NOT pipe `supabase gen types --linked` directly into types.ts; use /tmp + test -s + mv
