#!/bin/sh
# Brings a fresh checkout up to a running API, then serves it. Every step is skipped
# when it has already been done, so restarts are quick.
set -e
cd /app

[ -f vendor/autoload.php ] || composer install --no-interaction --prefer-dist
# .env is the stack's one settings file (../.env), mounted here by docker compose.
[ -f .env ] || { echo ".env is missing: in the repo, cp .env.example .env" >&2; exit 1; }
grep -q '^APP_KEY=base64:' .env || php artisan key:generate --force
[ -f database/database.sqlite ] || touch database/database.sqlite
php artisan migrate --force

# --no-reload is what lets PHP_CLI_SERVER_WORKERS take effect; restart after editing .env.
exec php artisan serve --host=0.0.0.0 --port=8000 --no-reload
