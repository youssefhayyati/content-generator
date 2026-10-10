# PHP for the Laravel API. Composer is baked in so every artisan/composer command
# runs here and nothing has to be installed on the host.
FROM php:8.4-cli

RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip ffmpeg yt-dlp libpng-dev \
 && docker-php-ext-install opcache gd \
 && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
COPY php.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY start.sh /usr/local/bin/start-api
RUN sed -i 's/\r$//' /usr/local/bin/start-api && chmod +x /usr/local/bin/start-api

WORKDIR /app
