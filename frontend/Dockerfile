# Frontend image: build the Vite SPA, serve it with nginx. nginx also reverse-proxies
# /api and /accounts to the Django web Service, so the SPA is same-origin in prod (mirrors
# the dev Vite proxy) — Django sees the public Host and builds first-party OAuth callbacks.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Template (not a final conf): the image envsubst's it at start, filling the cluster DNS
# resolver + the backend upstream from env. See default.conf.template.
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
