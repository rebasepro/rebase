#!/bin/sh
set -eu

version=0.27.0
case "$(uname -m)" in
  x86_64|amd64)
    arch=amd64
    checksum=7a512984b3e73d5b02055b2b0d5e2d5c3f02fd91c661361154968717de2b26a9
    ;;
  aarch64|arm64)
    arch=arm64
    checksum=785e17208245f2b286672187a27bd552ff5c9277e38d0882b1766b71db08fef3
    ;;
  *)
    echo "Unsupported Ptah architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
curl -fsSL "https://github.com/stokaro/ptah/releases/download/v${version}/ptah_${version}_linux_${arch}.tar.gz" -o "$tmp_dir/ptah.tar.gz"
echo "$checksum  $tmp_dir/ptah.tar.gz" | sha256sum -c -
tar -xzf "$tmp_dir/ptah.tar.gz" -C "$tmp_dir" ptah ptah-compat
install -m 0755 "$tmp_dir/ptah" "${PTAH_INSTALL_DIR:-/usr/local/bin}/ptah"
install -m 0755 "$tmp_dir/ptah-compat" "${PTAH_INSTALL_DIR:-/usr/local/bin}/ptah-compat"
