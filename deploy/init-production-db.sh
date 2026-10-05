#!/bin/sh
set -eu
# Random hexadecimal credentials avoid interpolation ambiguity in this one-time
# initialization. Application connections use a separate, non-superuser role.
case "$APP_DB_PASSWORD" in *[!0-9a-f]*|'') exit 1 ;; esac
psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
CREATE ROLE getirbakim_app LOGIN PASSWORD '$APP_DB_PASSWORD';
ALTER DATABASE getirbakim OWNER TO getirbakim_app;
SQL
