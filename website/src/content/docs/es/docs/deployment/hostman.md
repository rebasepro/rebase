---
sourceHash: 5f650040f2d3d2f9
title: Desplegar Rebase en Hostman
description: Despliega un proyecto rebase init en Hostman — App Platform con PostgreSQL gestionado y almacenamiento S3, o un servidor cloud con el propio archivo Compose de tu proyecto.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) ofrece dos modalidades que se adaptan a un backend de Rebase, con centros de datos en Europa y EE. UU.:

- **App Platform con PostgreSQL gestionado.** Hostman compila y ejecuta tu aplicación desde un repositorio de GitHub y gestiona la base de datos. Sus contenedores se inician limpios en cada despliegue, por lo que **las subidas de archivos necesitan un bucket compatible con S3 desde el primer día**.
- **Un servidor cloud.** Postgres y el runtime en un VPS, bajo el archivo `docker-compose.yml` que ya tiene tu proyecto. **Las subidas pueden permanecer en el disco del servidor.**

Nada en esta página sobre tu proyecto es específico de Hostman. Un despliegue de Rebase consta de dos piezas separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`, y el mismo bundle se ejecuta en un portátil, en Rebase Cloud y aquí.

## App Platform

### 1. Crear la base de datos

En el panel de Hostman, crea un clúster de **Managed PostgreSQL**:

- **Versión:** 16 o posterior.
- **Región:** en la que ejecutarás la aplicación.
- **Red:** una red privada. Coloca la aplicación en la misma red en el paso 4. La red de una aplicación se elige cuando se crea y no se puede cambiar después.

El clúster viene con un usuario, `gen_user`, y una base de datos, `default_db`. Desde la pestaña **Connection**, copia la cadena de conexión para la **IP privada**. Es tu `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Si el clúster requiere TLS, añade `?sslmode=require` al final.

#### Crear el rol al que cambia Rebase

Rebase aplica la seguridad a nivel de fila (row-level security) cambiando cada solicitud autenticada a un rol restringido, `rebase_user`. `gen_user` debe tener permisos para crear ese rol y para cambiar a él.

1. En la pestaña **Users** del clúster, otorga a `gen_user` el privilegio **CREATE ROLE**. La configuración más pequeña de Hostman (1 CPU, 1 GB RAM, 20 GB) no permite añadir usuarios ni bases de datos. Si no te permite conceder el privilegio, elige la siguiente configuración superior.
2. Conéctate una vez como `gen_user` con `psql`, antes del primer despliegue, y ejecuta:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   La base de datos está en una red privada, así que ejecuta esto desde un servidor cloud en la misma red, o activa el acceso público durante ese momento.

La segunda sentencia es la importante. En PostgreSQL 16 y versiones posteriores, un usuario que crea un rol sin ser superusuario pasa a ser miembro de él, pero no puede cambiar a él. Si el runtime crea el rol por sí mismo, el arranque tiene éxito y cada solicitud autenticada falla después con `DB_PERMISSION_DENIED`. Si eso ya ha ocurrido, ejecuta la línea `GRANT` y reinicia la aplicación.

Si tus tablas declaran una columna `col.vector()`, habilita **pgvector** en **Configuration → Extensions**. El scaffold inicial no declara ninguna.

### 2. Crear un bucket

Crea un bucket compatible con S3: el propio almacenamiento S3 de Hostman o cualquier otro proveedor. En la configuración del bucket, anota el endpoint, la región, la clave de acceso y la clave secreta. Mantén el bucket **privado**: Rebase firma cada descarga, y `storageAuthorize` en `backend/storage.ts` decide quién puede leer, escribir y listar.

### 3. Añadir un Dockerfile

App Platform compila desde tu repositorio, y `dist-bundle/` está en el `.gitignore`, por lo que la imagen compila el bundle por sí misma y luego se lo entrega al runtime publicado. Haz commit de esto en la raíz del proyecto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.30.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Tres detalles son importantes aquí:

- **`node:22`, no `node:22-slim`.** La instalación de la CLI descarga el motor de esquemas Atlas, que necesita `curl` y certificados de CA. La imagen slim no tiene ninguno de los dos y la instalación falla.
- **`--chown=node:node`.** El runtime se ejecuta como `node` y vincula sus propios paquetes dentro del bundle al inicio. Un bundle propiedad de root sigue funcionando, pero registra una advertencia por cada paquete que no pudo vincular.
- **Sin código fuente en la imagen final.** Contiene el runtime y tu bundle compilado. Actualizar Rebase más adelante consiste simplemente en cambiar la segunda línea `FROM`.

La imagen de runtime escucha en el puerto 8080 y lo declara con `EXPOSE`, que es el puerto al que enruta App Platform.

### 4. Crear la aplicación

En **App Platform**, crea una aplicación **Backend**:

1. Conecta el repositorio de GitHub y la rama.
2. Establece **Framework** en **Dockerfile**.
3. Elige la misma región que la base de datos y la **red privada** de la base de datos.
4. Elige una configuración con **2 GB de RAM**. El bundle se compila como parte de la imagen y la compilación alcanza un pico de aproximadamente 1 GB, por lo que una configuración de 1 GB puede quedarse sin memoria.
5. Establece la **ruta de health check** en `/livez`. La opción predeterminada, `/`, también funciona, pero `/livez` responde sin tocar la base de datos, por lo que un problema momentáneo en la base de datos no reinicia una aplicación que funciona correctamente.

En **Advanced settings**, añade las variables de entorno:

```env
NODE_ENV=production
DATABASE_URL=postgresql://gen_user:<password>@<private-ip>:5432/default_db
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app-domain>
FRONTEND_URL=https://<your-app-domain>
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ENDPOINT=<endpoint>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=true
```

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` definen al primer administrador. En producción, la primera cuenta en registrarse no se promociona, por lo que nada más creará una. El runtime crea la cuenta una sola vez, mientras la tabla de usuarios esté vacía. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

La dirección de la aplicación no se conoce hasta que existe. Crea la aplicación, consulta su dominio técnico en la pestaña **Dashboard**, y luego establece `CORS_ORIGINS` y `FRONTEND_URL` con ese valor. Guardar la configuración vuelve a desplegar la aplicación.

### 5. Abrirla

Abre el dominio de la aplicación. Un único contenedor sirve el panel de administración en `/` y la API en `/api`. Inicia sesión con `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`, y luego cambia la contraseña.

Cada push a la rama vuelve a desplegar. Para añadir tu propio dominio, usa **Settings → Domains**. Hostman emite el certificado. Añade el nuevo origen a `CORS_ORIGINS` y `FRONTEND_URL`.

## Un servidor cloud

Un servidor cloud de Hostman ejecuta el mismo stack que cualquier VPS: Postgres y el runtime bajo el propio archivo `docker-compose.yml` de tu proyecto, con Caddy al frente para HTTPS. Un servidor con 2 vCPU y 2 GB de RAM es suficiente para empezar.

Créalo con **Ubuntu 24.04** y tu clave SSH, y luego sigue los [pasos para un único servidor en la página de Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Nada en ellos depende de Hetzner.

En un servidor, las subidas se quedan en su disco: el archivo Compose las mantiene en un volumen con nombre y establece `FORCE_LOCAL_STORAGE=true`. Sobreviven a reinicios y redespliegues, pero no a la pérdida del servidor, así que activa las copias de seguridad del servidor de Hostman o muévelas a un bucket cuando empiecen a ser importantes.

## El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que faltan durante el arranque, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, el cual es aditivo en todo el esquema. Crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila, de modo que una nueva colección esté disponible en el siguiente despliegue.

`ensure` nunca cambia algo que ya existe. No altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que un despliegue no debe remodelar un esquema como efecto secundario.

Cualquier cambio que no sea puramente aditivo —una columna renombrada, un tipo más restrictivo, un campo eliminado— requiere `rebase db push`, ejecutado desde una copia local del código:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Revisa el SQL que imprime el dry run y luego ejecútalo de nuevo sin `--dry-run`. Primero hay que preparar dos cosas en Managed PostgreSQL:

- **Accesibilidad.** Una base de datos en una red privada no es accesible desde tu portátil. Habilita el acceso público durante ese tiempo, o ejecuta el comando desde un servidor en la misma red.
- **La base de datos temporal.** `db push` planifica cada cambio en una copia desechable del esquema, en una base de datos con el mismo nombre que la tuya y terminada en `_dev_diff`. Otorga a `gen_user` el privilegio **CREATEDB**, o crea `default_db_dev_diff` una vez desde el panel. Ninguna de las dos opciones es posible en la configuración más pequeña.

Para migraciones con control de versiones, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de la release.

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
- [Almacenamiento](/docs/backend/storage) — buckets, reglas de acceso y múltiples orígenes de almacenamiento a la vez.
