#!/bin/sh
# query the isolated audit DB (meduza_ui_test only)
exec docker exec meduza-db psql -U meduza -d meduza_ui_test -At -F'|' -c "$1"
