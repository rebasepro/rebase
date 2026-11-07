#!/bin/sh
# The standby's replication login. Runs once, from the image's init hook.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator';"
echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
