# PHP for the Laravel API. Composer is baked in so every artisan/composer command
# runs here and nothing has to be installed on the host.
FROM php:8.4-cli

ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6
ARG DENO_VERSION=2.9.7
ARG DENO_SHA256=c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip ffmpeg python3 libpng-dev \
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" -o /usr/local/bin/yt-dlp \
 && echo "${YT_DLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/yt-dlp \
 && curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o /tmp/deno.zip \
 && echo "${DENO_SHA256}  /tmp/deno.zip" | sha256sum -c - \
 && unzip -q /tmp/deno.zip -d /usr/local/bin \
 && chmod 0755 /usr/local/bin/deno \
 && rm /tmp/deno.zip \
 && docker-php-ext-install opcache gd \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp for Creative Lab's YouTube nodes, and Deno, the JavaScript runtime current yt-dlp needs for YouTube.
# Kept current with `yt-dlp -U` (scheduled: lab:update-ytdlp); YouTube changes often.
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && curl -fsSL -o /tmp/deno.zip https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip \
 && unzip -o /tmp/deno.zip -d /usr/local/bin && chmod a+rx /usr/local/bin/deno && rm /tmp/deno.zip

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
COPY php.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY start.sh /usr/local/bin/start-api
RUN sed -i 's/\r$//' /usr/local/bin/start-api && chmod +x /usr/local/bin/start-api

WORKDIR /app
