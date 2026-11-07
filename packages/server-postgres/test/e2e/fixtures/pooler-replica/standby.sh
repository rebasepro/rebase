#!/bin/sh
# A hot standby: a base backup of the primary with `-R`, which writes the
# streaming configuration, then the server in recovery.
set -e
mkdir -p "$PGDATA"
chown postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"
until gosu postgres pg_basebackup -h primary -U replicator -D "$PGDATA" -R -X stream -c fast; do
    echo "standby: waiting for the primary"
    rm -rf "${PGDATA:?}"/*
    sleep 1
done
exec gosu postgres postgres -c hot_standby=on -c max_connections=60
