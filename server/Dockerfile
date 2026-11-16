FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
# runs as uid 1000; /srv/media on the host must be writable by it (see infra/README.md)
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
