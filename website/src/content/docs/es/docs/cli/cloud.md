---
sourceHash: a31629385c88f416
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, vinculación de proyectos, despliegues, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, webhooks, clústeres y facturación.
---

Todo lo relacionado con Rebase Cloud, que está en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin vincularlo.

Hay tres opciones aplicables en todas partes: `--json` para salida legible por máquina (también la opción predeterminada en tuberías, salvo para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projects

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deploy and observe

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sin un nombre de aplicación despliega el backend. El despliegue de un bundle
de backend también sube el código fuente del proyecto —lo que git rastrea, nunca un `.env`— para que una
actualización de la plataforma pueda reconstruirlo; `--no-source` omite esto una vez, y `cloud settings set
--platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Un `deploy` seguido termina con un resumen: cada aplicación desplegada con su URL, el id del despliegue, cuánto tardó y si la nueva versión responde allí. Espera hasta `--live-timeout` segundos (60 por defecto; `0` omite la comprobación) a que respondan el `/api/health` del backend y la dirección de cada aplicación estática. Un despliegue fallido termina con una línea que nombra la aplicación y el motivo, y sale con un código distinto de cero. El resumen se imprime también en tuberías; `--json` (o `REBASE_JSON=1`) imprime en su lugar un objeto con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`.

Antes de subir nada, `deploy` analiza el JavaScript de cada aplicación estática que publica: los archivos `.js`/`.mjs`/`.cjs` de su `output` y los bloques `<script>` en línea de su HTML. Un error de sintaxis detiene el despliegue con `file:line:column` (código `syntax_error` con `--json`), y `--no-verify` omite la comprobación. Un despliegue exitoso termina con el camino de vuelta, `rebase cloud rollback`. Una aplicación estática desplegada por separado todavía no admite rollback; consulta [Rollback](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
deja la producción intacta. La previsualización de una aplicación estática llama al backend de producción.
La previsualización del backend ejecuta su propio backend, sobre una base de datos vacía y propia.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

## Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

La previsualización de un backend parte de las variables de producción, claves reales incluidas.
`env set KEY=VALUE --preview` da a las previsualizaciones su propio valor, `env unset KEY
--preview` deja la variable fuera de ellas, `env reset KEY --preview` devuelve
el valor de producción, y `env list --preview` muestra las diferencias.
Ninguno de ellos modifica la producción.

## Organizations

```bash
rebase cloud orgs list | create | members
```

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos administrada (sin
endpoint público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo propietario o administrador.

## Resources

Lo que la plataforma contiene para el proyecto, en comparación con lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece;
eso implicaría borrar datos mediante un push. La mantiene, la vincula y la factura hasta que
alguien la purgue por su nombre.

## Compute

Lo que el proyecto reserva y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por lo
que `true` se rechaza y `false` se ignora con una advertencia. No hay
niveles de planes: todo se tarifa por recurso. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, webhooks, clusters and billing

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
