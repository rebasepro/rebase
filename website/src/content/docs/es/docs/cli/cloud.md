---
sourceHash: 98eee42b368266f4
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos de rebase cloud — autenticación, vinculación de proyectos, despliegues, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, webhooks, clústeres y facturación.
---

Todo lo relacionado con Rebase Cloud, que se encuentra en fase beta privada. Consulta la [guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre uno sin necesidad de vincularlo.

Hay tres opciones aplicables en todas partes: `--json` para salida legible por máquina (también la opción predeterminada en tuberías o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Vinculación de proyectos

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Proyectos

```bash
rebase cloud init --claim [--name <name>]   # un backend en vivo sin cuenta y un enlace para reclamarlo en 72 horas
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Despliegue y observabilidad

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sin un nombre de aplicación despliega el backend. El despliegue de un bundle de backend también sube el código fuente del proyecto — lo que git rastrea, nunca un `.env` — para que una actualización de la plataforma pueda recompilarlo; `--no-source` omite esto una vez, y `cloud settings set --platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

## Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

## Organizaciones

```bash
rebase cloud orgs list | create | members
```

## Bases de datos

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint público) hasta que se presione Ctrl-C; `--reveal` añade la contraseña. Solo para propietario (owner) o administrador.

## Recursos

Lo que la plataforma mantiene para el proyecto, en comparación con lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece — eso supondría datos eliminados mediante un push. La mantiene, vincula y factura hasta que alguien la elimine (prune) por su nombre.

## Cómputo

Lo que el proyecto reserva y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`. No hay niveles de planes: todo se tarifica por recurso. Consulta [Rebase Cloud](/docs/deployment/cloud/).

## Almacenamiento, webhooks, clústeres y facturación

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```
