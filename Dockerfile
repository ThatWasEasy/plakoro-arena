# The API server only. The frontend is a static build served from somewhere else (GitHub Pages
# today), so none of it belongs in this image.
#
# A Dockerfile rather than letting the host platform guess: this repo looks like a Vite frontend
# from the outside — `npm run build` is `vite build` and there is no root-level server entry — so
# buildpack auto-detection reaches for the wrong thing. With this file the platform stops
# guessing, and the same build works on Railway, Render, Zeabur or Fly without being re-described
# in each one's dashboard.
FROM node:22-alpine

WORKDIR /app

# Copied before the source so a change to server/ doesn't invalidate the dependency layer.
COPY package.json package-lock.json ./

# --omit=dev leaves out vite and @vitejs/plugin-vue, which are only needed to build the frontend.
# What's left is express, pg, and Node's own modules.
RUN npm ci --omit=dev

COPY server ./server
COPY db ./db

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Migrations run on every boot, not as a separate deploy step someone has to remember. They are
# idempotent — db/migrate.mjs skips anything schema_migrations already lists — so a redeploy that
# changes nothing applies nothing. A fresh database gets the whole schema on first start.
#
# `&&` rather than `;`: if a migration fails the container must not come up serving an API
# against a half-migrated database.
CMD ["sh", "-c", "node db/migrate.mjs && node server/index.mjs"]
