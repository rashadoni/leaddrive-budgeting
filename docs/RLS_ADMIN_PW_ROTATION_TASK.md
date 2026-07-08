# TASK for Codex — (A) unblock prod deploys + (B) rotate the prod admin password

Two independent prod-server jobs. **You have prod access; the other agent is
classifier-blocked from SSH + credential changes, which is why this is handed to
you.** Self-contained — no prior chat context needed.

Host: `ssh root@46.225.60.142`, app dir `/opt/budgetpro`, env file
`.env.production`, compose services `db` (container `budgetpro-db`) + `app`
(container `budgetpro-app`), compose invoked as
`docker compose --env-file .env.production …`.

---

## Part A — unblock deploys (prod git working tree is dirty)

During the earlier S6 RLS flip you edited `scripts/sql/create-app-role.sql` and
`create-bypass-role.sql` directly on prod and left `*.bak-*` backups. That dirty
working tree now makes `git push` to the prod repo fail with
`remote rejected … Working directory has unstaged changes`, blocking ALL deploys.

**The SQL fix is already upstream** (committed to origin as `9f56aa2d`, identical
to your prod edit), so the prod working-tree copies can be safely discarded.

```bash
cd /opt/budgetpro
git status                                   # inspect first
git checkout -- scripts/sql/create-app-role.sql scripts/sql/create-bypass-role.sql
rm -f scripts/sql/*.bak-*                     # remove the S6 backups
git status                                    # expect: clean (ignore gitignored .env.production)
```
Do NOT touch `.env.production` (it holds the live DATABASE_URL_APP/_ADMIN from
S6). After this, the maintainer can `bash deploy/update-prod.sh` from their
machine normally.

## Part B — rotate the demo admin password (`Admin123!`)

The prod admin still logs in with the demo password `Admin123!`. Rotate it to a
strong secret BEFORE the 2nd tenant (Mars Overseas) gets access.

### B.1 — identify the real admin account (do NOT guess the org)
```bash
docker compose --env-file .env.production exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c \
  "select u.email, u.role, u.\"isActive\", o.slug as org_slug, o.name as org_name
     from users u join organizations o on o.id = u.\"organizationId\"
    where u.role='admin' and u.\"isActive\"=true order by u.email;"
```
(First `set -a && . ./.env.production && set +a` so `$POSTGRES_USER`/`$POSTGRES_DB`
are set.) Note the exact `email`, `org_slug`, `org_name` of the admin the human
actually logs in with (likely `admin@fo.az` or `admin@budgetpro.com`). **The org
slug matters** — see B.2.

### B.2 — rotate

The already-deployed `scripts/create-admin.ts` upserts keyed by
`(organizationId, email)` off `ADMIN_ORG_SLUG` (default `demo`). **If the slug
doesn't match the admin's real org it will CREATE A DUPLICATE admin in the wrong
org instead of rotating** — so you MUST pass the exact `ADMIN_ORG_SLUG` +
`ADMIN_ORG_NAME` from B.1. It runs `prisma.user.upsert({ update: { passwordHash }})`
→ for an existing user only the hash changes (org/role/active untouched).

Generate a strong password and rotate (replace the three `<…>` from B.1; the
password is generated into a shell var, never typed as a literal):
```bash
NEW_PW=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)   # URL-safe, 24 chars
# NEW_PW below is a shell VARIABLE (unquoted is fine — it's URL-safe alnum), not a literal.
docker compose --env-file .env.production exec -T \
  -e ADMIN_EMAIL="<admin_email>" \
  -e ADMIN_ORG_SLUG="<org_slug>" \
  -e ADMIN_ORG_NAME="<org_name>" \
  -e ADMIN_PASSWORD=$NEW_PW \
  app npx tsx scripts/create-admin.ts
echo "NEW ADMIN PASSWORD (save it in the vault NOW, shown once): $NEW_PW"
```
Confirm the script printed the SAME `User:` email and `Organization:` you
identified in B.1 (not a freshly-created demo org). If it printed a NEW/`demo`
org → you passed the wrong slug: STOP, the account was forked — delete the
stray user and retry with the correct slug.

> Once Part A is done and the maintainer redeploys, prefer the safer
> `scripts/rotate-admin-password.ts` (finds the user by email alone, updates the
> hash by id, no org-slug footgun) for any FUTURE rotation:
> `docker compose … exec -T -e ADMIN_EMAIL=<email> -e ADMIN_PASSWORD=$NEW_PW app npx tsx scripts/rotate-admin-password.ts` (NEW_PW = the shell var, not a literal)

### B.3 — verify
```bash
# old password now rejected (expect a 302 to /login?error=… and session null):
BASE=http://localhost
J=$(mktemp); CSRF=$(curl -s -c "$J" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -s -c "$J" -b "$J" -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=<admin_email>" \
  --data-urlencode "password=Admin123!" --data-urlencode "json=true"
curl -s -b "$J" "$BASE/api/auth/session"     # expect: null  (old pw rejected)

# new password works (expect a session with the admin email):
J2=$(mktemp); CSRF2=$(curl -s -c "$J2" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -s -c "$J2" -b "$J2" -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF2" --data-urlencode "email=<admin_email>" \
  --data-urlencode "password=$NEW_PW" --data-urlencode "json=true"
curl -s -b "$J2" "$BASE/api/auth/session"    # expect: JSON with the admin email
```

## Report back
- Part A: `git status` clean confirmation.
- Part B: the admin email + org rotated, and the two B.3 results (old=null,
  new=session). **Give the new password to the human out-of-band (vault/DM) —
  do NOT commit it or leave it in any tracked file.** The human should also
  change it to something memorable via the UI if preferred, and delete
  `Admin123!` from any doc/notes.
