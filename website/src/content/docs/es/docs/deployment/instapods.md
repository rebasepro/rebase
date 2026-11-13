---
sourceHash: 00f5a2af4d9eec17
title: Desplegar Rebase en InstaPods
description: Lleva un proyecto recién creado con rebase init a una URL HTTPS en vivo en un único pod de InstaPods — Node, PostgreSQL y subida de archivos en la misma máquina, sin Docker.
sidebar_label: InstaPods
---

[InstaPods](https://instapods.com) ejecuta tu aplicación en un contenedor persistente —un *pod*— con Node.js, un servicio opcional de PostgreSQL en `localhost`, HTTPS automático y despliegues desde un repositorio de GitHub. Un backend de Rebase consiste en un único proceso de Node y un Postgres, por lo que todo encaja en un solo pod: la API, la autenticación, el tiempo real, cron, el panel de administración y el almacenamiento de archivos.

Esta página lleva un proyecto recién salido de `rebase init` a una URL en producción. Todo se ejecuta en el propio pod; no hay ninguna imagen de Docker ni nada más que aprovisionar.

**La subida de archivos puede empezar en el propio disco del pod.** El sistema de archivos de un pod sobrevive a reinicios y redespliegues, por lo que el almacenamiento local es seguro allí, y puedes migrar a un bucket compatible con S3 más adelante sin cambiar el código. Consulta [Almacenamiento de archivos](#almacenamiento-de-archivos).

## Lo que necesitas

- El plan **Build** o superior ($7/mes: 2 vCPU, 2 GB RAM, 25 GB de disco). El plan Launch no puede ejecutar el servicio de PostgreSQL.
- Un repositorio de GitHub para el proyecto.
- La [CLI de InstaPods](https://docs.instapods.com/), para los pasos de base de datos y entorno. El panel de control hace las mismas funciones.

## 1. Crear el proyecto y subirlo

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Haz un commit y súbelo a un repositorio de GitHub. `.env` está en el gitignore y se queda así: el pod recibe sus propios valores en el paso 4.

## 2. Crear el pod

En el panel de control de InstaPods, crea un pod con la configuración predeterminada de **Node.js** en el plan **Build**.

El scaffolding declara Node `>=22.22.0` y no se instalará en versiones anteriores. Comprueba la versión del pod y cámbialo a Node 24 si su Node 22 no está al día:

```bash
instapods exec my-app -- node -v
instapods pods node-version my-app 24 --wait
```

## 3. Añadir PostgreSQL

```bash
instapods services add my-app -s postgresql -w
instapods services creds my-app -s postgresql
```

El segundo comando muestra las credenciales: host `localhost`, puerto `5432`, usuario y base de datos `instapod`, y una contraseña generada. Tu cadena de conexión es:

```
postgresql://instapod:<password>@localhost:5432/instapod
```

Luego crea el rol bajo el cual Rebase ejecuta las solicitudes autenticadas. Rebase aplica la seguridad a nivel de fila (row-level security) cambiando cada solicitud a un rol restringido, `rebase_user`, y el usuario `instapod` necesita permisos para cambiar a él. Créalo una sola vez como superusuario de Postgres, antes del primer despliegue:

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

El runtime se encarga del resto en el primer inicio: los permisos y políticas sobre tus tablas pertenecen a `instapod`, que es el propietario de su base de datos.

Haz esto incluso si el runtime pudiera crear el rol por sí mismo. En PostgreSQL 16 y versiones posteriores, a un usuario al que se le permite crear roles pero que no es superusuario se le asigna una pertenencia en el rol que creó que no le permite cambiar a él. El arranque se completará con éxito, pero cada solicitud autenticada fallará con `DB_PERMISSION_DENIED`. Si eso ya ha ocurrido, ejecuta `GRANT rebase_user TO instapod WITH SET TRUE;` de la misma manera y reinicia la aplicación.

## 4. Configurar el entorno

Genera los dos secretos con `openssl rand -hex 32` (una vez para cada uno), y luego define todo en una sola llamada:

```bash
instapods env set my-app \
  DATABASE_URL='postgresql://instapod:<password>@localhost:5432/instapod' \
  ALLOW_LOCALHOST_IN_PRODUCTION=true \
  JWT_SECRET=<first-secret> \
  REBASE_SERVICE_KEY=<second-secret> \
  CORS_ORIGINS=https://my-app.nbg1-1.instapods.app \
  FRONTEND_URL=https://my-app.nbg1-1.instapods.app \
  DISABLE_SELF_REGISTRATION=true \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=<at-least-12-characters> \
  STORAGE_TYPE=local \
  STORAGE_PATH=/home/instapod/app/uploads \
  FORCE_LOCAL_STORAGE=true
```

Usa la propia URL de tu pod para `CORS_ORIGINS` y `FRONTEND_URL`: el panel de control la muestra, y es la dirección en la que abrirás el panel de administración. Añade un dominio personalizado más adelante e indícalo en ambos.

Para qué sirven las líneas menos evidentes:

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** En producción, el runtime rechaza un `DATABASE_URL` que apunte a `localhost`, porque dentro de un contenedor esa dirección suele ser un error. En un pod, la base de datos realmente está en la misma máquina, y esta línea lo confirma.
- **`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`.** En producción, la primera cuenta en registrarse no se convierte en administrador, por lo que estas variables definen al primero. El runtime crea la cuenta una sola vez, mientras la tabla de usuarios esté vacía. Inicia sesión con ella y cambia la contraseña. Consulta [Tu primer admin](/docs/getting-started/deployment/#your-first-admin).
- **Las tres líneas de almacenamiento.** Explicadas en [Almacenamiento de archivos](#almacenamiento-de-archivos).

`instapods env set` escribe `/home/instapod/app/.env`, que es el archivo que lee `rebase start`. InstaPods define `PORT` automáticamente, y el runtime se vincula a él.

## 5. Conectar el repositorio

En la pestaña **Git** del pod, conecta el repositorio y la rama, y luego define los comandos:

| Campo | Valor |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(dejar vacío)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

Por qué cada uno está configurado de esa manera:

- **Install** ejecuta pnpm a través de `npx`, porque el proyecto incluye un `pnpm-lock.yaml` y es posible que el pod no tenga pnpm instalado. `--prod=false` mantiene las dependencias de desarrollo —la CLI de Rebase y TypeScript, que la compilación necesita— incluso si `NODE_ENV` ya está establecido en `production` durante la instalación.
- **Build** ejecuta `rebase build`. Compila tus tablas, funciones y crons en `dist-bundle/`, y compila el panel de administración en el mismo paquete. Alcanza un pico de aproximadamente 1 GB de memoria.
- **Start** ejecuta el bundle compilado. `NODE_ENV=production` se define en el propio comando, por lo que el runtime nunca se inicia en modo de desarrollo —donde el primer desconocido en registrarse se convertiría en administrador.

Despliega. Cualquier push posterior a la rama volverá a desplegar la aplicación.

## 6. Abrir la aplicación

Abre la URL del pod. Un único proceso sirve el panel de administración en `/` y la API en `/api`. Inicia sesión con `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`.

El primer inicio crea todas las tablas necesarias, incluidas las tuyas, junto con sus políticas de seguridad a nivel de fila. No hay ninguna migración que deba ejecutarse antes.

Si el log muestra `Failed to create the "rebase_user" role`, se omitió el paso al final de [Añadir PostgreSQL](#3-añadir-postgresql): ejecútalo y luego corre `instapods pods restart my-app`.

## Almacenamiento de archivos

Las subidas se almacenan en el disco del pod bajo `/home/instapod/app/uploads`, un directorio que el `.gitignore` del scaffolding ya excluye del repositorio.

En producción, el runtime rechaza el almacenamiento local a menos que indiques que el disco es duradero, porque en la mayoría de las plataformas de contenedores no lo es: el sistema de archivos se reemplaza en cada despliegue, y cada archivo subido se pierde con él. Un pod es diferente, ya que sus archivos persisten a través de reinicios y despliegues. `FORCE_LOCAL_STORAGE=true` le indica esto al runtime.

Mantener el directorio dentro de `/home/instapod/app` también lo incluye en la copia de seguridad diaria del pod que hace InstaPods, la cual cubre ese directorio y realiza un volcado de la base de datos junto a él.

Lo que el almacenamiento local no permite:

- **Servir desde más de una máquina.** Los archivos existen únicamente en este pod. Una segunda instancia, o una CDN delante de los archivos, requiere un bucket.
- **Crecer más allá del disco del plan.** Las subidas comparten los 25 GB con la base de datos y la aplicación.

Cuando se te quede pequeño, conecta cualquier bucket compatible con S3 y elimina las tres líneas de configuración local:

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

Los archivos que ya están en el pod no se moverán por sí solos: cópialos al bucket manteniendo sus claves. Quién puede leer, escribir y listar archivos lo decide `storageAuthorize` en `backend/storage.ts`, independientemente del backend que los almacene. Consulta [Almacenamiento](/docs/backend/storage).

## El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que falten al arrancar, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema. Crea tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila, de modo que una nueva tabla esté disponible en el siguiente despliegue.

`ensure` nunca modifica algo que ya existe. No altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que un despliegue no debe remodelar un esquema como efecto secundario.

Cualquier cambio que no sea puramente aditivo —una columna renombrada, un tipo más restringido, un campo eliminado— requiere `rebase db push`, ejecutado desde tu máquina.

`db push` planifica cada cambio en una copia temporal del esquema, en una base de datos con el mismo nombre que la tuya pero terminada en `_dev_diff`, y el usuario `instapod` no tiene permisos para crear bases de datos. Créala una sola vez como superusuario:

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

El Postgres del pod solo escucha en `localhost`, así que conéctate mediante un túnel SSH y luego ejecuta el push:

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Revisa el SQL que imprime la ejecución de prueba (dry run) y luego ejecútalo de nuevo sin `--dry-run`. Un cambio que elimine datos también requiere `--allow-destructive`.

Para migraciones versionadas, haz un commit de los archivos de migración con `rebase db generate` e introduce `node_modules/.bin/rebase db migrate` en el campo **Release**, el cual InstaPods ejecuta en cada despliegue.

Si tus tablas declaran una columna `col.vector()`, el Postgres del pod necesita la extensión pgvector: instalada en el pod, y luego creada por el superusuario con `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"`. El scaffolding no declara ninguna.

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador comunes a todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
- [Almacenamiento](/docs/backend/storage) — buckets, reglas de acceso y múltiples fuentes de almacenamiento simultáneas.
