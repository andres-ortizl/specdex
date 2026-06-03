# Port and project name assignment (Phase 0.5)

Find the lowest available port offset by checking which offsets are in use by active specs across ALL projects:

1. Read every `~/.spec/*/*/logbook.md` — if status is NOT `COMPLETE`, that spec is active
2. Read every active spec's `env.md` to find its offset (derive from any port, e.g., `BACKEND_PORT - 8080`)
3. Pick the lowest multiple of 10 (starting at 10) not used by any active spec

Offset 0 is reserved for the user's own dev stack (default ports).

```
offset = lowest unused multiple of 10, starting at 10
```

## Append to the worktree's `.env`

```env
COMPOSE_PROJECT_NAME=spec-<spec-name>
FRONTEND_PORT=$((5173 + offset))
BACKEND_PORT=$((8080 + offset))
API_PORT=$((8081 + offset))
POSTGRES_PORT=$((5432 + offset))

# URL overrides — without these, the backend's OAuth server and the frontend's
# baked-in API base URL still point at the default ports (8080/5173) even though
# the containers listen on the offset ports. OAuth login from the worktree
# frontend will redirect to the wrong backend (and the dev OAuth client may not
# exist there). Always set these alongside the port assignments.
BASE_URL=http://localhost:$((8080 + offset))
VITE_BASE_URL=http://localhost:$((8080 + offset))/
OAUTH2_REDIRECT_URIS=http://localhost:$((5173 + offset))/callback
FRONTEND_URL=http://localhost:$((5173 + offset))
```

`FRONTEND_URL` drives `CORS_ALLOWED_ORIGINS` in `backend/config/settings.py` — without it the backend rejects cross-origin requests from the worktree frontend with an empty `Access-Control-Allow-Origin`, and the browser-visible failure mode is "Failed to fetch" right after the OAuth redirect.

**Note:** Vite env vars (`VITE_*`) are baked at build time. After changing
`VITE_BASE_URL`, the frontend container must be rebuilt or restarted with the
new value — a hot reload won't pick it up.

**OAuth client seeding:** the worktree backend gets its own database, which
means the dev OAuth `Application` row (`client_id=dev_...`) may not exist there
yet. After `docker compose up`, verify with:
```bash
docker compose exec backend python manage.py shell -c \
  "from oauth2_provider.models import Application; \
   print(list(Application.objects.values_list('client_id', flat=True)))"
```
If empty, run whichever seed command the project uses (look for a
`create_oauth_application` management command or a data migration like
`0xxx_oauth_application_seed`).

## Log the assigned ports

Write `~/.spec/<project-name>/<spec-name>/env.md`:

```markdown
# Environment: <spec-name>

Worktree: .claude/worktrees/spec/<spec-name>
Branch: spec/<spec-name>
COMPOSE_PROJECT_NAME: spec-<spec-name>

| Service   | Port  |
|-----------|-------|
| Frontend  | <port> |
| Backend   | <port> |
| API       | <port> |
| Postgres  | <port> |
```
