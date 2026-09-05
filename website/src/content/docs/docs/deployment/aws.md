---
title: Deploying Rebase on AWS
description: Deploy your Rebase instance securely on Amazon Web Services utilizing RDS and AWS App Runner with a strong European focus.
sidebar_label: AWS
---

Amazon Web Services (AWS) provides incredible scale and enterprise-grade security. For a production Rebase deployment, we recommend decoupling the architecture by using **Amazon RDS** for the PostgreSQL database and **AWS App Runner** (or ECS Fargate) to serve the runtime.

To maintain strict European data compliance, ensure you operate entirely within an EU region, such as **eu-central-1 (Frankfurt)**, **eu-west-1 (Ireland)**, or **eu-west-3 (Paris)**.

Nothing on this page is AWS-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and here. Moving between them is a change of infrastructure, not of application.

## 1. Provision Amazon RDS (PostgreSQL)

1. Navigate to the **RDS** console in your selected EU region.
2. Click **Create database** and select **Standard create**.
3. Choose the **PostgreSQL** engine.
4. Under Templates, choose **Production** or **Free tier/Dev** depending on your load.
5. Create a Master Username (e.g., `rebase_admin`) and securely generate a Master Password.
6. Under Connectivity, ensure the database is placed within a **VPC** that your future App Runner instance can securely access (or make it publicly accessible if strictly controlling ingress IP ranges).
7. Once provisioned, note the **Endpoint address** and assemble your URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

If your collections declare a `vector` property, the instance needs the `pgvector` extension — RDS ships it, but it has to be enabled: `CREATE EXTENSION vector;` against the database, once.

## 2. Build the bundle and bake it into an image

There is **no application image to build from your source**. `rebase build` produces a `dist-bundle` directory with your compiled collections, functions, crons and — if your project declares a static app — your built frontend. The published runtime image runs it:

```bash
rebase build
```

For App Runner, which pulls from a registry, bake the bundle into a derived image. That is three lines and it pins exactly what runs:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

1. Navigate to **Elastic Container Registry** and create a private repository called `rebase-backend`.
2. Grab the push commands AWS shows in the console — they handle Docker authentication.
3. Build and push, from the project root:
   ```bash
   docker build -t rebase-backend .
   ```
4. Tag and push it to your ECR repository.

Upgrading Rebase later is a change to that `FROM` line. Your bundle is untouched, and nothing about your project is rebuilt.

## 3. Deploy via AWS App Runner

<span class="since-badge" data-since="0.18">Since 0.18</span>

App Runner is the simplest way to run containers on AWS without managing orchestrators.

1. Navigate to **AWS App Runner** and click **Create service**.
2. Select **Container registry** and choose **Amazon ECR**.
3. Browse and select your `rebase-backend` image.
4. Under **Service settings**, set the Port to **8080** — the port the runtime image listens on unless `PORT` says otherwise.
5. Set the **health check** path to `/livez`. Not `/health`: that one performs a database round-trip, so a liveness probe on it restarts a perfectly healthy service during a brief database hiccup.
6. Add the environment variables:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your RDS connection string |
| `JWT_SECRET` | A secure randomly generated string (32+ chars) |
| `REBASE_SERVICE_KEY` | A secure randomly generated string (32+ chars) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Your frontend domain (e.g., `https://yourdomain.com`) |
| `FRONTEND_URL` | Your frontend URL (used for email links and CORS fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | The first administrator's address, set **before the first boot** |
| `REBASE_ADMIN_PASSWORD` | At least 12 characters |

The last three are how this deployment gets an administrator at all: in production the first account to register is not promoted, so nothing else produces the first signed-in caller. See [Your first admin](/docs/getting-started/deployment/#your-first-admin). Put the secrets in AWS Secrets Manager and reference them rather than typing them into the console form.

7. (Optional) If your RDS instance is strictly private, configure **Custom VPC** networking in App Runner so the container can reach the database.
8. Click **Create & deploy**.

AWS handles TLS termination, giving you an `https` URL out of the box.

## 4. The schema

**The runtime creates missing tables at boot, including your collections'.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema — it creates missing tables, columns and enum types and applies their row-level security — so the first start against an empty RDS instance comes up serving your collections.

What `ensure` never does is change something that already exists: it does not alter a column type, drop anything, or edit an existing enum's labels, because a container restart must not reshape a schema as a side effect of a deploy.

Two things therefore still need the CLI, run from a checkout or a CI job with `DATABASE_URL` pointed at RDS:

```bash
rebase db push
```

- **Junction-table RLS** for many-to-many relations.
- **Any change that is not purely additive** — a renamed column, a narrowed type, a removed field.

If the instance is private, run it from CI or a bastion host inside the same VPC. The runtime image ships without the CLI, so this never runs inside the App Runner container. For versioned migrations, commit migration files with `rebase db generate` and run `rebase db migrate` as a release step instead.

## File storage

App Runner instances have no durable disk, so local file storage is silent data loss and the runtime refuses it in production. Create an S3 bucket in the same region and set `STORAGE_TYPE=s3` with its bucket and credentials — see [Storage](/docs/backend/storage).

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
