---
title: What the Rebase Cloud beta does not include
sidebar_label: Cloud Beta Limits
description: What Rebase Cloud's private beta does not do yet — regions, self-serve access, an SLA, branch deploys, machine identities, a public database endpoint — and what deploying with production secrets means.
---

[Rebase Cloud](/docs/deployment/cloud/) is in private beta. Stated plainly, because finding out later is worse:

- **No region choice.** Everything runs in one region today. The placement model
  exists in the platform, but a project cannot pick a region.
  `projects create --provider` and `--region` are not the exception they look
  like: they record which of the control plane's registered deploy targets a
  project belongs to, and there is one, so both default to it and neither moves a
  project anywhere else. `rebase cloud projects create --help` says the same.
- **Not self-serve.** Access is granted in batches; there is no sign-up-and-pay.
- **No published SLA**, and no SOC 2. If you need either, say so when you request
  access rather than assuming.
- **No branch deploys**, and no first-party GitHub App. Deploy hooks — secret URLs
  you point a repository webhook at — are the supported automation. [Preview
  deploys](/docs/deployment/cloud/#preview-a-change) are rolling out and are started from the CLI.
- **Tokens act as a person.** A [token](/docs/deployment/cloud-agents/#ci-and-agents) is minted by an account
  and acts as it; there is no organization-owned machine identity yet. If you
  sign in from CI instead, pass `REBASE_CLOUD_EMAIL` and `REBASE_CLOUD_PASSWORD`
  from a secret store — `--password` puts the password in your shell history and
  in the process table, and says so before it signs you in. If the repository's
  `.rebase/cloud.json` names a control plane other than the platform's own, pass
  it as `--url` too: without a terminal, `login` refuses to send a password to a
  host that only the checked-out file named.
- **No public database endpoint.** A managed database is not exposed to the
  internet, so the host the console shows is your backend's address for it and
  resolves to nothing on your machine. `rebase cloud db connect` opens a local
  port that is that database, tunnelled through the control plane, for as long
  as you leave it running — but there is no permanent hostname a third-party
  service can connect to. To run SQL without a local Postgres client,
  `rebase cloud db query "<sql>"` or `rebase cloud db query --file file.sql` opens the
  same tunnel for one query, runs the text as one script (stopping at the first
  error) and prints what each statement answered (`--json` for a script). That tunnel, and the password behind
  `rebase cloud db info --reveal`, both need the organization's owner or admin
  role: the same one Studio's SQL editor asks for, because all three end at a
  session on your production data.
- **Deploying is running code with the production secrets.** The app's
  environment holds `REBASE_SERVICE_KEY` (admin on its own API),
  `DATABASE_URL` and `JWT_SECRET`, so code a member deploys can read them,
  even though only owners and admins can reveal them in the console. Invite
  as a member only someone you would trust with those values.
- **The service key can be replaced.** The project's **Settings**
  (or `rebase cloud service-key rotate`) issue a new `REBASE_SERVICE_KEY`
  and restart the app onto it. The old key works until the restart has
  finished, and nothing after, so anything that copied it is refused from
  then on. Claiming a project does the same.

## Next

- [Rebase Cloud](/docs/deployment/cloud/): linking, deploying and the rest of the surface.
- [Self-hosting](/docs/deployment/self-hosting/): the same image and bundle, run by you.
