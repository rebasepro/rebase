---
title: Deploying Rebase on AWS
description: Deploy your Rebase instance securely on Amazon Web Services utilizing RDS and AWS App Runner with a strong European focus.
sidebar_label: AWS
---

Amazon Web Services (AWS) provides incredible scale and enterprise-grade security. For a production Rebase deployment, we recommend decoupling the architecture by using **Amazon RDS** for the PostgreSQL database and **AWS App Runner** (or ECS Fargate) to serve the Node.js backend. 

To maintain strict European data compliance, ensure you operate entirely within an EU region, such as **eu-central-1 (Frankfurt)**, **eu-west-1 (Ireland)**, or **eu-west-3 (Paris)**.

## 1. Provision Amazon RDS (PostgreSQL)

1. Navigate to the **RDS** console in your selected EU region.
2. Click **Create database** and select **Standard create**.
3. Choose the **PostgreSQL** engine.
4. Under Templates, choose **Production** or **Free tier/Dev** depending on your load.
5. Create a Master Username (e.g., `rebase_admin`) and securely generate a Master Password.
6. Under Connectivity, ensure the database is placed within a **VPC** that your future App Runner instance can securely access (or make it publicly accessible if strictly controlling ingress IP ranges).
7. Once provisioned, note the **Endpoint endpoint address** and assemble your URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

## 2. Push Image to ECR (Elastic Container Registry)

AWS App Runner pulls directly from ECR. Build your Docker image locally and push it.

1. Navigate to **Elastic Container Registry** and create a new private repository called `rebase-backend`.
2. Grab the push commands provided by AWS in the console (which handle Docker authentication).
3. Build your image locally **from the project root** — the backend Dockerfile needs the whole workspace as its build context (it copies `pnpm-workspace.yaml`, `backend/`, and `config/`), so `./backend` as the context will fail:
   ```bash
   docker build -t rebase-backend -f backend/Dockerfile .
   ```
4. Tag and push it to your newly created ECR repository.

## 3. Deploy via AWS App Runner

App Runner is the simplest way to run containers on AWS without managing orchestrators.

1. Navigate to **AWS App Runner** and click **Create service**.
2. Select **Container registry** and choose **Amazon ECR**.
3. Browse and select your `rebase-backend` image.
4. Under **Service settings**, set the Port to **3001**.
5. Add the necessary Environment Variables under the configuration tab:
   
| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your RDS Connection String |
| `JWT_SECRET` | A secure randomly generated hash (32+ chars) |
| `REBASE_SERVICE_KEY` | A secure randomly generated hash (32+ chars) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Your frontend domain (e.g., `https://yourdomain.com`) |
| `FRONTEND_URL` | Your frontend URL (used for email links and CORS fallback) |
| `ALLOW_REGISTRATION` | `false` (set to `true` only during initial setup) |

6. (Optional) If your RDS instance is strictly private, configure **Custom VPC** networking in App Runner so the container can securely talk to the database.
7. Click **Create & deploy**.

AWS will handle TLS termination (providing an `https` URL out of the box) and spin up the Rebase server.

## Create the Database Schema

The service is running, but Rebase only auto-creates the **auth** tables on boot — the tables for your own collections are **not** created automatically. Run this once against the production database, or every collection returns a "missing table" error:

```bash
pnpm run db:push
```

Run it from a checkout of your project (or your CI job) with `DATABASE_URL` set to your RDS endpoint. If the instance is private, run it from CI or a bastion host inside the same VPC. The deployed image doesn't include the CLI, so this doesn't run inside the App Runner container. For versioned migrations, commit migration files with `pnpm run db:generate` and run `pnpm run db:migrate` instead.

## Related

- [Deployment Guide](/docs/getting-started/deployment/) — the build, the artifacts and the boot sequence every platform shares
- [Environment & Configuration](/docs/getting-started/configuration/) — every variable the runtime reads, and which ones production refuses to start without
- [Self-Hosting](/docs/deployment/self-hosting/) — running it on a machine you own
