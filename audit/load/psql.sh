#!/bin/sh
# psql against the isolated load-test database only (never the demo DB `meduza`).
exec docker exec -i meduza-db psql -U meduza -d meduza_load_test -v ON_ERROR_STOP=1 "$@"
