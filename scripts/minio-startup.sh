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
  -e MINIO_ROOT_USER=rebase-admin \
  -e MINIO_ROOT_PASSWORD=rebase-minio-secret-2026 \
  minio/minio:latest server /data --console-address ":9001"

# Wait for MinIO to be ready, then create the default bucket
sleep 15
docker run --rm --network host \
  -e MC_HOST_local=http://rebase-admin:rebase-minio-secret-2026@localhost:9000 \
  minio/mc mb --ignore-existing local/rebase-storage
