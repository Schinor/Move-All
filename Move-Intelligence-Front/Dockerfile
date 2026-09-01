# Build Stage
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY Move-Intelligence-Front/package*.json ./
RUN npm ci
COPY Move-Intelligence-Front/ ./
RUN npm run build

# Production Runtime Stage
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist/move-front/browser /usr/share/nginx/html
COPY Move-Intelligence-Front/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
