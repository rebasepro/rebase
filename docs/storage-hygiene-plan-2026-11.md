# Bucket hygiene: orphaned files, expiry, metering

Status (2026-11-07): §1's scheduled sweep is built and released in 0.28.0
(`bucket(…, { orphanSweep })`, a cron job per bucket). `deleteWithRow` is not:
see §1. §3's gauge is on saas main and in the control plane images since
2026-11-04 (GCS only), recording without billing until `REBASE_BILL_STORAGE` is
on. §2 is not built, and the recommendation is not to: see its last part.

It came out of SongBuzz moving its voice
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

- *(Not built, on purpose.)* `storage: { ..., deleteWithRow: true }` on a property states that its keys
  belong to that row alone. Only then does an `afterDelete` delete the object.
  The delete is best-effort and logged: it never fails the row delete, and
  anything it misses the sweep catches. Off by default, because the property
  is the only place that can state the ownership. Left out once the sweep
  existed: deleting at once would have to check every other row and history
  entry for the key on every delete, which is exactly the sweep's work, and
  the sweep only adds the grace period.
- *(Built.)* A scheduled orphan sweep, opted into per bucket
  (`bucket("voice", { orphanSweep: { olderThanHours: 168 } })`), running the
  same scan as `rebase storage orphans --delete --older-than`. It is grace-period based, so an
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

**Recommendation (2026-11-07): don't add it yet.** Every case SongBuzz has is
covered without a rule that deletes files by age alone:

- *A cache bucket whose files rows name* (voice clips, thumbnails): expiry
  belongs to the row. The app deletes rows on its own schedule (a cron through
  `rebase.dataAsAdmin`), and `orphanSweep` deletes their files once the grace
  period has passed. A bucket TTL would delete files rows still name, which is
  what §1 refuses to do, and the app would find out on a read.
- *Files no row ever names* (abandoned uploads, a `tmp/` prefix): they are
  orphans, and the sweep removes them after the grace period (24 h floor).

What is left is expiry sooner than a day, or of files rows still name on
purpose. If that is ever wanted, it is control-plane work, not a CLI flag on
`rebase cloud storage create`: the tenant's HMAC service account holds only
`roles/storage.objectAdmin` on its bucket, so it cannot set bucket lifecycle
over the S3 interop API; the control plane would read the declaration from
the deployed resources, write the rules through the JSON API with
`storage.buckets.update` added to `rebaseManagedStorage`, and reconcile them on
every deploy beside the noncurrent-version rules.

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
