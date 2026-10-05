# 8i11

Personal Next.js app: On This Day stories, text tools, health dashboards (Oura / Ride with GPS / COROS), F1 predictions, games, and weather.

**Live:** https://8i11.vercel.app

## Deployment

This app deploys via **Vercel** — pushes to `main` go live automatically, and PRs get preview deployments. No local server is needed for normal development; the development VM is not a runtime environment.

## Local verification (pre-PR gate)

```bash
npm run build    # Must pass before opening a PR
npm run lint     # Must pass before opening a PR
npx vitest       # Run tests
```

If you ever need a local server, use `npm run build && npm start`. Avoid `npm run dev` on the development VM — it thrashes in a Fast Refresh reload loop there (Turbopack-in-sandbox quirk).

See `CLAUDE.md` for the full tech stack, project structure, and workflow.
