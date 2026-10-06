---
title: Running more than one instance
sidebar_label: More than one instance
description: Every piece of state a Rebase process keeps to itself, and the setting that shares it — what to set before a second replica, a rolling deploy or a split deployment takes traffic.
---

## Overview

Most of a Rebase deployment already lives in the database: rows, users and
sessions, API keys, the job queue, cron claims, idempotency keys, record
history, the MCP OAuth server's tokens. A second process pointed at the same
database sees all of it.

A few things do not. Each is per process by default, because one process is
the default deployment and sharing costs something — a table, a bucket write, a
database connection. Running two processes behind a load balancer, autoscaling
past one, or a rolling deploy that briefly runs the old and new side by side
all put you on this page. So does a [split deployment](/docs/deployment/split-processes/),
which is several processes by definition.

Go through the list below before the second one takes traffic. Nothing on it
fails loudly: each item shows up as a limit enforced three times over, an event
some clients never see, or a page that shows different logs on every refresh.

## The checklist

| What | Per process by default | What shares it |
| --- | --- | --- |
| Signing secrets | Generated per process in development | `JWT_SECRET` and `REBASE_SERVICE_KEY`, set explicitly and **identical** everywhere |
| Rate-limit counters | In memory | `REBASE_RATE_LIMIT_STORE=sql` |
| Client address behind a proxy | `TRUSTED_PROXY_HOPS=0` | The number of proxies in front, the same everywhere |
| Collection subscriptions | Shared through the database when CDC is on | `REALTIME_CDC=auto` (the default) |
| Broadcast channels and presence | In memory | `REALTIME_CHANNEL_BUS=postgres` |
| Uploaded files, `STORAGE_TYPE=local` | The instance's own disk | S3 or GCS, or one shared volume at `STORAGE_PATH` |
| Resumable (TUS) uploads in progress | The instance's memory and disk | Sticky sessions; a restart still loses them |
| Image transforms | An in-process cache | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | A ring of the last 10,000 lines | Nothing — ship stdout to a log aggregator |
| Cron timers | Every process that runs the scheduler | Claimed in the database: one run per slot. `REBASE_CRON_SCHEDULER` picks where timers live |
| Scheduled RLS audit | Every process that owns it | `REBASE_RLS_AUDIT=false` on all but one |
| A static app's `index.html` | Read once per process | Restart every instance when the build changes |
| `/metrics` | Each process counts its own | Scrape every instance |

The sections below say what each one does when it is left per process.

## Signing secrets

`JWT_SECRET` signs every session and `REBASE_SERVICE_KEY` authenticates
server-to-server calls. In development each process generates its own when they
are unset, so a token one process issued is refused by the next. Production
already refuses to boot without them; what matters with several processes is
that every one gets the **same** values — from one secret, not one per replica.

## Rate limits and the client address

The rate limiters — the per-caller budget on the data, storage and functions
APIs, and the auth limiters on sign-in, password reset, one-time codes and MFA
attempts — count in memory by default. A process cannot see how many peers it
has, so three replicas on the default enforce three times every limit. Set
`REBASE_RATE_LIMIT_STORE=sql` and the counters live in the database instead.

Behind a load balancer the limiter also needs the real client address, which
arrives in `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` says how many proxies to look
past; at the default `0` every request appears to come from the load balancer
and every client shares one bucket. See
[Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

**Collection subscriptions** work across instances when database-level change
capture is on, which it is by default (`REALTIME_CDC=auto`): a trigger announces
each committed write, and every instance's listener refetches for its own
subscribers. If CDC is off, or `auto` could not provision it (the boot log says
which), a subscription sees only the writes made through the instance its
socket is connected to. See
[Realtime](/docs/backend/realtime/#database-level-change-capture-cdc).

**Broadcast channels and presence** are in-process unless a bus carries them:
two clients on different instances in the same channel do not hear each other,
and each instance answers "who is here?" with its own half. Set
`REALTIME_CHANNEL_BUS=postgres`. The bus listens on the database, which needs a
direct connection rather than a transaction pooler — set `DATABASE_DIRECT_URL`
when `DATABASE_URL` goes through pgBouncer. See
[Channels and presence across instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Files

With `STORAGE_TYPE=local`, uploads are files on the disk of the instance that
received them, and another instance answers 404 for them. Use S3 or GCS, or
mount one volume at `STORAGE_PATH` on every instance. See
[Self-hosting: file storage](/docs/deployment/self-hosting/#file-storage).

**Resumable uploads** (the TUS endpoint) keep each upload's partial file and its
state on the local disk of the instance that created it, under
`STORAGE_PATH/.tus-uploads` — even when finished files go to S3 or GCS. A chunk
that lands on another instance is answered 404 and the client starts again.
Route a client's upload requests to one instance (sticky sessions on the load
balancer). A shared volume at `STORAGE_PATH` shares the partial files but not
yet the upload state, which is held in the process's memory — so a restart or a
rolling deploy also sends an upload in progress back to byte 0. Ordinary
uploads through `POST /upload` are one request and are not affected.

**Image transforms** (`?width=400&format=webp`) are cached in memory, so every
instance computes every variant once, and a new instance starts cold. Set
`STORAGE_RENDITION_CACHE=true` to write each rendition back to the bucket it
came from, where every instance finds it. That makes a `GET` write to your
bucket, which is why it is off unless asked for. See
[Storage](/docs/backend/storage/).

## Logs Explorer

Studio's Logs Explorer reads a ring of the last 10,000 log lines kept by the
process that serves the request. Behind a load balancer each refresh may show a
different instance's lines, and none of them shows the whole deployment.
<span class="since-badge" data-since="0.24">Since 0.24</span> The explorer names the instance it is showing.
There is no setting that shares the ring: the runtime writes one JSON line per event to
stdout in production, and that is what to collect — your platform's log
service, Loki, or anything that reads container output.

## Cron and the job queue

Every process that runs the cron scheduler arms its own timers, and the run is
claimed in the database first, so a slot runs **once** however many processes
fire for it. Pausing a job, and the lease that keeps a manual trigger off a run
in progress, are shared the same way. Nothing to set, as long as the database
is Postgres. `REBASE_CRON_SCHEDULER` and `REBASE_JOB_WORKERS` decide which
processes run timers and workers at all — see
[Split processes](/docs/deployment/split-processes/).

The scheduled RLS audit is the exception: it is not claimed, so every process
that owns it scans on its own timer. That is redundant rather than unsafe; set
`REBASE_RLS_AUDIT=false` everywhere but one.

## Static apps

A process that serves the frontend or the CMS (`REBASE_SERVE_STATIC`, on by
default) reads each app's `index.html` once and keeps it. Replacing the build
on a shared volume does not reach a running process: it keeps serving the old
document, which names chunks that may no longer exist. Ship a new build by
restarting or rolling every instance — which a new image or bundle does anyway.
With a CDN in front and `REBASE_SERVE_STATIC=false`, this does not apply.

## Metrics

`/metrics` reports the process that answers it. Scrape each instance — a
Prometheus service-discovery job per pod, not one target behind the load
balancer — and sum in the query.

## Boot provisioning

Every instance runs the additive schema pass at boot
(`REBASE_MIGRATE_ON_BOOT=ensure`). Instances of the same role may run it at the
same time: it is written to tolerate a peer creating the same table a moment
earlier. In a split deployment, exactly one role provisions and every other sets
`none` — see [Split processes](/docs/deployment/split-processes/).
