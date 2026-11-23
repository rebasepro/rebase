---
title: Rebase Storage
sidebar_label: Rebase Storage
description: "S3-compatible object storage in Rebase Cloud: the endpoint, buckets and keys, the S3 operations it supports, limits, pricing, where the data is stored, and how to connect aws-cli, rclone, boto3 and the AWS SDK for JavaScript."
---

Rebase Storage is the object storage in Rebase Cloud. It speaks the S3 API, so
any S3 client or SDK works with it once you give it the endpoint and a key. A
Rebase app on Rebase Cloud uses it without any setup; anything else — a script,
a backup job, another service — connects with a key you create.

## Endpoint and region

| | |
|---|---|
| Endpoint | `https://s3.eu-central-1.rebase.pro` |
| Region | `eu-central-1` |
| Path-style URL | `https://s3.eu-central-1.rebase.pro/<bucket>/<key>` |
| Virtual-hosted URL | `https://<bucket>.s3.eu-central-1.rebase.pro/<key>` |

Both URL styles work, so a client can use either.

## Buckets

Create a bucket in the console, or with the CLI:

```bash
rebase cloud storage create my-bucket
rebase cloud storage delete my-bucket
```

Bucket names are global across Rebase Storage: 3 to 63 characters, lowercase
letters, digits and hyphens, no dots.

Buckets are not created through the S3 `CreateBucket` call. `CreateBucket` for
a bucket you already own answers `BucketAlreadyOwnedByYou`.

## Keys

Rebase issues the access keys. Each key is either **read-only** or
**read-write**, and covers either one bucket or every bucket of the project.

```bash
rebase cloud storage keys create
rebase cloud storage keys rotate
rebase cloud storage keys revoke
```

The console does the same. The secret is shown once, when the key is created or
rotated, and is stored encrypted. A revoked key stops working within seconds.

## Rebase apps on Rebase Cloud

A Rebase app deployed to Rebase Cloud gets its bucket and a key automatically.
The platform sets these environment variables on the app:

| Variable | Value |
|---|---|
| `STORAGE_TYPE` | `s3` |
| `S3_ENDPOINT` | The storage endpoint |
| `S3_REGION` | `eu-central-1` |
| `S3_BUCKET` | The project's bucket |
| `S3_ACCESS_KEY_ID` | The app's key |
| `S3_SECRET_ACCESS_KEY` | The app's secret |
| `S3_FORCE_PATH_STYLE` | `true` |

Traffic between the app and Rebase Storage stays inside the cluster. How the
app serves and authorizes files is covered in
[File storage](/docs/backend/storage/) and
[Managed backend runtime](/docs/deployment/managed-runtime/#storage-for-generated-files).

## Supported S3 operations

| Area | Operations |
|---|---|
| Objects | `PutObject`, `GetObject` (ranges, conditional headers, `response-*` overrides), `HeadObject`, `DeleteObject`, `DeleteObjects`, `CopyObject` within the same bucket (up to 5 GB) |
| Listing | `ListObjectsV2`, `ListObjects` |
| Multipart uploads | `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`, `ListMultipartUploads` |
| Buckets | `HeadBucket`, `ListBuckets`, `GetBucketLocation`, `GetBucketCors` |
| Presigned URLs | Valid for up to 7 days |

Requests are signed with **SigV4** only. Uploads with `aws-chunked` encoding and
trailing checksums are accepted, with CRC32, CRC32C, CRC64NVME, SHA1 or SHA256,
so the AWS SDKs' default checksum behaviour works without configuration.

Everything else answers `NotImplemented`. That includes:

- ACLs and bucket policies. Objects are always private; to share a file, give
  out a presigned URL.
- Public buckets.
- Object versions and `versionId`.
- Object tagging, object lock and lifecycle rules.
- Server-side encryption headers.
- `UploadPartCopy` and copying between buckets.
- Browser `POST` uploads (HTML form uploads). Use a presigned `PUT` instead.

### CORS

Set a bucket's CORS rules in the console or with `rebase cloud storage cors`.
Rebase Storage answers preflight requests from those rules, so a browser can
`GET` or `PUT` against a presigned URL from your site.

## Limits

| | Limit |
|---|---|
| Single `PUT` | 5 GB |
| Multipart upload | 10,000 parts, 5 GB per part |
| Object size | 5 TB |
| User metadata | 2 KB per object |
| Buckets | 100 per project |
| Keys | 200 per project |

Each project also has a request rate. Requests above it get `503 SlowDown`,
which S3 clients retry with backoff.

## Pricing

Each project includes **10 GB**. Above that, storage costs **€0.03 per
GB-month**, counted on the current version of each object only.

Deleted and overwritten files are kept for 30 days and can be restored by
support during that time. They are not billed.

**Storage cap.** Each project has a cap that its owner sets: 50 GB by default,
up to 1 TB from the console, more on request. You are alerted at 80% and at
100%. At the cap, uploads are refused with `QuotaExceeded`; reads and deletes
keep working.

**Egress.** Outbound traffic is metered per project and is not billed today.
Fair use is 1 TB per project per month. A rate of €0.01 per GB beyond fair use
is reserved, but it is not charged now, and any change to that would be
announced in advance.

## Where the data is stored

Objects are stored in Germany, in Falkenstein (data centre region eu-central),
on erasure-coded storage operated by our infrastructure provider, Hetzner
Online GmbH. A second copy is made every hour to a separate location in
Nuremberg. That copy exists so Rebase can recover from a disaster; it is not
served.

Rebase Storage has no uptime SLA.

## Encryption

Traffic to Rebase Storage is always encrypted with TLS.

Objects are not encrypted at rest: the provider's object storage does not
apply default server-side encryption, and this version of Rebase Storage does
not add any. For sensitive data, encrypt it on the client before you upload it.

## Importing an existing bucket

`rebase cloud storage import` copies a bucket from any S3-compatible service
into Rebase Storage:

```bash
rebase cloud storage import --from s3://old-bucket --endpoint https://s3.example.com --to my-bucket
```

It copies every object, verifies the copy, and never modifies the source.
With `--switch-app`, it then points your Rebase app at the new bucket and
redeploys it.

For Google Cloud Storage, use its S3 interoperability endpoint
(`https://storage.googleapis.com`) with an HMAC key. `rebase cloud storage
import --help` shows how to pass the source's credentials.

## Connecting a client

The examples below use a key created with `rebase cloud storage keys create`.

### aws-cli

Store the key in a profile:

```bash
aws configure --profile rebase
# AWS Access Key ID:     <your access key>
# AWS Secret Access Key: <your secret>
# Default region name:   eu-central-1
```

Then pass the endpoint on each command:

```bash
aws s3 ls s3://my-bucket --profile rebase --endpoint-url https://s3.eu-central-1.rebase.pro
aws s3 cp ./report.pdf s3://my-bucket/reports/ --profile rebase --endpoint-url https://s3.eu-central-1.rebase.pro
```

### rclone

```ini title="rclone.conf"
[rebase]
type = s3
provider = Other
access_key_id = <your access key>
secret_access_key = <your secret>
endpoint = https://s3.eu-central-1.rebase.pro
region = eu-central-1
```

Both URL styles work, so `force_path_style` can be left at its default.

```bash
rclone ls rebase:my-bucket
```

### Python (boto3)

```python
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="https://s3.eu-central-1.rebase.pro",
    region_name="eu-central-1",
    aws_access_key_id="<your access key>",
    aws_secret_access_key="<your secret>",
    # Optional: both addressing styles work.
    # config=botocore.config.Config(s3={"addressing_style": "path"}),
)

s3.upload_file("report.pdf", "my-bucket", "reports/report.pdf")
url = s3.generate_presigned_url(
    "get_object",
    Params={"Bucket": "my-bucket", "Key": "reports/report.pdf"},
    ExpiresIn=3600,
)
```

### JavaScript (AWS SDK v3)

```js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
    endpoint: "https://s3.eu-central-1.rebase.pro",
    region: "eu-central-1",
    credentials: {
        accessKeyId: "<your access key>",
        secretAccessKey: "<your secret>"
    },
    forcePathStyle: true
});

await s3.send(new PutObjectCommand({
    Bucket: "my-bucket",
    Key: "hello.txt",
    Body: "Hello"
}));
```
