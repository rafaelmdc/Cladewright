# Frontend image: build the Vite SPA, serve it with nginx (Brotli + gzip). nginx also
# reverse-proxies /api and /accounts to the Django web Service, so the SPA is same-origin in
# prod (mirrors the dev Vite proxy) — Django sees the public Host and builds first-party
# OAuth callbacks.

# ── 1. Build the SPA, then precompress the static assets to .br + .gz ────────────────────
FROM node:20-alpine AS build
WORKDIR /app
# Build stamp (CI passes the git version + UTC build time). Vite only inlines env vars
# prefixed VITE_, so re-export them before the build; they end up in the bundle and surface
# in the site footer. Default to "dev" for local builds.
ARG APP_VERSION=dev
ARG BUILD_TIME=
ENV VITE_APP_VERSION=$APP_VERSION \
    VITE_APP_BUILT=$BUILD_TIME
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Precompress the hashed assets at max effort so nginx serves them via brotli_static/
# gzip_static with zero per-request CPU. (The proxied API is compressed dynamically instead.)
RUN apk add --no-cache brotli gzip \
    && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' \) \
        -exec brotli -kfq 11 {} \; -exec gzip -kf9 {} \;

# ── 2. Compile the Brotli dynamic modules against THIS nginx version ─────────────────────
# The official nginx image is built --with-compat, so a module compiled --with-compat from
# the matching source loads into it. (nginx ships no brotli module, hence this stage.)
FROM nginx:1.27-alpine AS modules
RUN apk add --no-cache build-base cmake git linux-headers pcre-dev zlib-dev openssl-dev brotli-dev
WORKDIR /src
RUN NGINX_VERSION="$(nginx -v 2>&1 | sed -E 's#.*nginx/##')" \
    && wget -q -O nginx.tar.gz "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" \
    && tar -xf nginx.tar.gz \
    && git clone --depth=1 --recurse-submodules https://github.com/google/ngx_brotli.git \
    && cd "nginx-${NGINX_VERSION}" \
    && ./configure --with-compat --add-dynamic-module=../ngx_brotli \
    && make -j"$(nproc)" modules \
    && cp objs/ngx_http_brotli_filter_module.so objs/ngx_http_brotli_static_module.so /tmp/

# ── 3. Final image: nginx + the SPA + the brotli modules ─────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=modules /tmp/ngx_http_brotli_filter_module.so /tmp/ngx_http_brotli_static_module.so /usr/lib/nginx/modules/
# load_module must live in the MAIN context — prepend it to nginx.conf (the template is
# included down in http{}, too deep for load_module).
RUN sed -i '1i load_module modules/ngx_http_brotli_filter_module.so;\nload_module modules/ngx_http_brotli_static_module.so;' /etc/nginx/nginx.conf \
    && nginx -t
# Template (not a final conf): the image envsubst's it at start, filling the backend
# upstream from env. See default.conf.template.
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
