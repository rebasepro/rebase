---
title: Cloud Notifications
sidebar_label: Notifications
description: How Rebase Cloud tells people when a deploy fails, backups stop, a payment is declined or usage passes 80% — signed webhooks to Slack, Discord or any URL, and per-person email.
---

The platform tells people when a deploy fails, a database stops backing up, a
payment is declined, or a project passes 80% and then 100% of its allowance for
the month.
It is part of [Rebase Cloud](/docs/deployment/cloud/), and every command here
is in the [CLI's cloud reference](/docs/cli/cloud/).

## Webhooks

<span class="since-badge" data-since="0.26">Since 0.26</span>

A project can send these events to a Slack or Discord incoming
webhook, or to any https URL, from **Settings → Notifications** in the console
or with the CLI:

```bash
rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX
rebase cloud notifications add https://ops.example.com/rebase --events deploy.failed,backup.unhealthy
rebase cloud notifications test <id>
rebase cloud notifications            # each destination, and how its last delivery went
rebase cloud notifications remove <id>
```

The events are `deploy.failed` (the default), `deploy.succeeded`,
`deploy.rolled_back`, `backup.unhealthy`, `billing.payment_failed` and
`usage.threshold`. Each POST is JSON with a `type`, the `project`, the facts of
the event, a console `url` and a one-line `text`. Slack shows the `text` as the
message, so a Slack incoming-webhook URL works without any setup. For Discord,
add `/slack` to the end of its webhook URL. `--format slack` sends `{ "text" }`
alone, for a receiver that rejects fields it does not know. A build log never
goes into a webhook.

Every POST is signed: `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw
body>`, with the secret shown once when the destination is added. It also
carries `X-Webhook-Event` and an `X-Webhook-Delivery` id that stays the same
across the retries of one delivery. A delivery is tried three times, 1 and 5
seconds apart, 5 seconds each. A 4xx other than 429, a redirect or a refused
address is not retried. The URL must be https. The control plane refuses one that resolves to
a private, loopback, link-local or cloud-metadata address, both when it is
added and on the address each delivery connects to. Any member of the
organization can list a project's destinations, with their URLs masked.
Adding, testing and removing one needs the owner or admin role.

## Email

Each member chooses which emails they get, per organization, under
**Account → Notifications** in the console. Failures are on by default: a
failed deploy goes to whoever started it and to the owners and admins. A
successful deploy is off by default, and when turned on goes only to whoever
started it. A declined payment goes to owners and the billing email, once per
invoice. A broken backup goes to owners and admins at most once a day per
database. Each usage mark is sent once a month per project. A control plane
with no outgoing mail configured sends no email at all, and that page says so.
Webhooks work either way.

Each event reaches each person or destination once, however many times it is
reported. A deploy cancelled by a person, and a platform upgrade that
succeeded, are not reported.

`rebase cloud webhooks` is retired. It never delivered anything, and every
action now exits 1 with code `command_retired`. To get a POST when rows change
in your app's own tables, use a `WebhookDispatcher` in your app's code (see
[the webhook recipe](/docs/recipes/webhooks/)).

