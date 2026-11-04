# Bucket hygiene: orphaned files, expiry, metering

Status: design, not built (2026-11-04). It came out of SongBuzz moving its voice
recordings into its managed bucket, which raised three gaps. None was built in
the same change. Each one either destroys a customer's files on a rule the
platform infers, or starts billing for something it has never billed. Those
calls are Francesco's to make, not a side effect of a fix.

## 1. Deleting a row leaves its file behind

**Today.** A `storage` property holds an object key. Deleting the row deletes
the row, and the object stays in the bucket for good. The only cleanup is
manual. `rebase storage orphans` (CLI → `GET /api/admin/storage/orphans`)
scans every collection's storage properties, lists the stored objects no row
names, and `--delete` removes them after a prompt. Files newer than
`--older-than` hours (24 by default) are left out.

**Why not delete with the row.** A key is not owned by one row:

- Two rows can name the same key (a duplicated record, a default image, a
  file several entities share).
- Entity history keeps old versions of a row that still name the key, and a
  restore from history would then point at nothing.
- A delete can be undone at the app level (a soft delete that is only a flag)
  or at the database level (PITR, a branch merge). The object delete can't.
- Not every reference is a `storage` property. App code can store keys in
  plain strings and JSON.

**Proposal.** Keep deletion a sweep, not a hook, and make the sweep automatic
for those who ask for it:

- `storage: { ..., deleteWithRow: true }` on a property states that its keys
  belong to that row alone. Only then does an `afterDelete` delete the object.
  The delete is best-effort and logged: it never fails the row delete, and
  anything it misses the sweep catches. Off by default, because the property
  is the only place that can state the ownership.
- A scheduled orphan sweep, opted into per source in `rebase.json` (`storage[]
  .orphanSweep: { olderThanHours: 168 }`), running the same scan as `rebase
  storage orphans --delete --older-than`. It is grace-period based, so an
  upload whose row hasn't been written yet is never swept. Sources with
  unscannable collections (the scan already reports `unscanned`) refuse to
  sweep rather than guess.

## 2. No expiry or lifecycle per bucket

**Today.** Managed GCS buckets carry one fixed lifecycle: noncurrent versions
go after 30 days, or past 20 newer versions (`managed-storage-gcp.ts`). Nothing
expires live objects. A cache-like bucket (TTS clips, thumbnails, exports)
grows without bound, and on managed storage that is our bill until metering
exists.

**Proposal.** Declare it with the bucket, where topology already lives:

```jsonc
// rebase.json
"storage": [{ "key": "voice", "lifecycle": [{ "prefix": "tmp/", "expireAfterDays": 7 }] }]
```

- **Managed GCS**: the control plane renders it as bucket lifecycle rules
  (`Delete` with `age` and `matchesPrefix`) on deploy, next to the
  noncurrent-version rules it already sets. That needs `storage.buckets.update`
  added to `rebaseManagedStorage`, and the rules are reconciled on each deploy
  so removing one removes it.
- **Garage, BYOS, local**: no native rule to rely on, so the runtime runs the
  same rules as a daily cron over `listObjects`. That's slower and costs list
  operations, but it is the same declaration everywhere.
- `rebase status` / the console show the effective rules per source, and which
  side enforces them.

## 3. Storage is not metered

**Today.** `runUsageRollup` (saas `backend/src/metering/rollup.ts`) takes an
optional `storageBytes(projectId)`, and `crons/usage-rollup.ts` never supplies
one. So `usage_daily.storage_bytes` is 0, the storage quota never trips, and
`overage-report` bills managed buckets as 0 GB.

**Options for the gauge, managed rows only** (a customer's own bucket is on
their own bill):

| Source | Cost | Needs |
|---|---|---|
| Cloud Monitoring `storage.googleapis.com/storage/total_bytes` per bucket | One API call per project per day, independent of object count | `monitoring.timeSeries.list` on the tenant-storage project, a read-only grant. Lags up to a day, which is fine for a daily gauge. GCS only. |
| `ListObjectsV2` with the row's own HMAC/Garage key, summing `Size` | One list call per 1,000 objects | No new IAM: the key is already on the row. Works on Garage too. Linear in object count. |

Recommend Cloud Monitoring for GCS and listing for Garage, both behind one
`storageBytes` dep. **Switching it on changes invoices.** Overage billing is
live, so the first rollup with a real gauge bills every managed bucket over the
included quota. Ship the gauge with billing for storage held off (record, don't
bill) for one cycle, so the numbers can be checked against the GCS bill before
anyone is charged.
