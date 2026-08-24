#!/bin/bash
set -e

# Create data directory
mkdir -p /mnt/stateful_partition/minio-data

# Run MinIO via Docker (Container-Optimized OS has Docker pre-installed)
docker run -d \
  --name minio \
  --restart=always \
  -p 9000:9000 \
  -p 9001:9001 \
  -v /mnt/stateful_partition/minio-data:/data \
  -e MINIO_ROOT_USER=${MINIO_ROOT_USER:-rebase-admin} \
  -e MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD must be set} \
  minio/minio:latest server /data --console-address ":9001"

# Wait for MinIO to be ready, then create the default bucket
sleep 15
docker run --rm --network host \
  -e MC_HOST_local=http://${MINIO_ROOT_USER:-rebase-admin}:${MINIO_ROOT_PASSWORD}@localhost:9000 \
  minio/mc mb --ignore-existing local/rebase-storage
