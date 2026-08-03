@AGENTS.md

# Deployment target: EasyPanel

This project is deployed via [EasyPanel](https://easypanel.io) using
the repo's multi-stage `Dockerfile` (Next.js `standalone` output,
non-root user, native `HEALTHCHECK`) — see [docs/docker.md](./docs/docker.md)
for the general Docker setup.

EasyPanel-specific notes:

- **Build-time vs runtime env vars matter.** `NEXT_PUBLIC_*` vars are
  inlined into the client bundle at build time. In the EasyPanel
  service's Build settings, each `NEXT_PUBLIC_*` var must be marked
  "available at build time" (passed as `--build-arg`) — the `ARG`
  names in the `Dockerfile` (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_LOCALE`) must match exactly.
  Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, `AUTOMATION_CRON_SECRET`, ...) stays runtime-only
  — never add those as build args.
- **Changing a `NEXT_PUBLIC_*` value requires a rebuild**, not just a
  restart — EasyPanel's "redeploy without rebuild" won't pick it up.
- **Port**: the container listens on `$PORT` (defaults to `3000`);
  EasyPanel injects its own `PORT` and proxies to it, so don't hardcode
  a different port in the service config.
- **Health checks**: EasyPanel reads the Dockerfile's `HEALTHCHECK`
  natively for the service status indicator and to gate traffic during
  zero-downtime deploys.
- Cron-driven features (automation/flow "Wait" steps) still need an
  external scheduler hitting `GET /api/automations/cron` and
  `GET /api/flows/cron` with the `x-cron-secret` header — EasyPanel
  doesn't run anything inside the container on its own.
