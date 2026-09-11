# HoldPose API — Cloud Run (keeps Vercel deploy intact)
FROM node:20-bookworm-slim

# ffmpeg required for dual-video top/bottom stitch
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Firebase credentials come from Cloud Run env/secret: FIREBASE_SERVICE_ACCOUNT
CMD ["node", "src/server.js"]
