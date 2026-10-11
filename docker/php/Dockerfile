# PHP for the Laravel API. Composer is baked in so every artisan/composer command
# runs here and nothing has to be installed on the host.
FROM php:8.4-cli

RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip ffmpeg libpng-dev \
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
