---
sourceHash: 72d2830a213ccda1
title: Desplegar Rebase en Out Plane
description: Despliega un proyecto de rebase init en Out Plane — una app creada a partir de tu repositorio, PostgreSQL administrado de Out Plane y subida de archivos en un bucket de Out Plane.
sidebar_label: Out Plane
---

[Out Plane](https://outplane.com) compila y ejecuta aplicaciones desde un repositorio de GitHub, con PostgreSQL administrado y buckets compatibles con S3 en la misma consola, en Alemania. Un backend de Rebase es un contenedor y un Postgres, por lo que se asigna a tres recursos de Out Plane: una **app**, una **base de datos** y un **bucket**.

Esta página lleva un proyecto recién salido de `rebase init` a una URL activa, en una sola instancia.

**Escrito para Rebase 0.32.0.** La versión está fijada en el Dockerfile en el paso 3; actualizar más adelante solo requiere cambiar esa línea.

**Las subidas de archivos van a un bucket desde el primer día.** El sistema de archivos de una app de Out Plane se reinicia en cada redespliegue, por lo que los archivos escritos en su disco se perderían en el siguiente push. Consulta [Almacenamiento de archivos](#almacenamiento-de-archivos).

## Lo que necesitas

- Una cuenta de Out Plane. El plan **Starter** cubre esta página: una app, una base de datos administrada y un bucket.
- Un repositorio de GitHub para el proyecto.
- Opcionalmente, la [CLI de `outplane`](https://docs.outplane.com). Cada paso a continuación se puede realizar en la consola; se proporcionan los equivalentes de la CLI donde ahorran tiempo.

## 1. Crear el proyecto y hacer push

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Haz commit y push a un repositorio de GitHub. `.env` está en el gitignore, y se mantiene así: la app obtiene sus propios valores en el paso 5.

## 2. Crear la base de datos

En la consola, elige **Create → Database**:

- **Versión:** 17 (por defecto) o 16. Cualquier versión a partir de la 16 funciona.
- **Región:** Fráncfort (Frankfurt), junto a tu app.

```bash
outplane db create my-app-db --region aws-eu-central-1
```

Desde el panel **Connection** de la base de datos, copia la cadena de conexión (el formato `psql`), o imprímela con `outplane db url my-app-db`. Out Plane requiere SSL en cada conexión. Tu `DATABASE_URL` es esa cadena con `sslmode=no-verify` al final, reemplazando cualquier `sslmode` que ya tenga:

```
postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
```

**Usa `no-verify`, no `require`.** Ambos cifran la conexión. Para `psql`, `require` también significa "no verificar el certificado con una autoridad pública", pero el controlador de Postgres sobre el que se ejecuta Rebase lo interpreta como "verifícalo", y un certificado de base de datos que no está firmado públicamente falla en la primera conexión con `self-signed certificate`. `no-verify` es la forma en que el controlador expresa lo que `require` significa en otros lugares. La propia guía de Node.js de Out Plane desactiva la comprobación por el mismo motivo. La misma URL funciona para `rebase db push` desde tu máquina: la CLI la pasa al motor de esquemas Atlas como `sslmode=require`.

### El rol al que cambia Rebase

Rebase aplica la seguridad a nivel de fila cambiando cada petición autenticada a un rol restringido, `rebase_user`. En el primer inicio, el runtime crea ese rol, otorga al rol de tu cadena de conexión el permiso para cambiar a él y comprueba que el cambio funciona antes de servir nada. No hay nada que ejecutar manualmente.

Si el primer inicio se detiene con un error `AppRoleSetupError` mencionando a `rebase_user`, el rol de tu cadena de conexión no tiene permiso para crear roles o para otorgarse el cambio a sí mismo. El error muestra el SQL que debes ejecutar en su lugar: ejecútalo una vez, como un rol en la base de datos que pueda crear roles, y luego vuelve a desplegar.

Si tus tablas declaran una columna `col.vector()`, la base de datos necesita la extensión pgvector. La plantilla inicial no declara ninguna.

## 3. Crear un bucket

En **Buckets → Create bucket**, crea uno y mantenlo **privado** (la opción predeterminada). Rebase sirve cada descarga a través de su propia API, y `storageAuthorize` en `backend/storage.ts` decide quién puede leer, escribir y listar.

Out Plane añade un sufijo aleatorio al nombre. Usa el nombre **completo** que muestra, no el corto que escribiste.

En la pestaña **Access** del bucket, crea una clave con permiso de **Lectura y escritura** (Read and write). El secreto se muestra solo una vez: cópialo ahora.

```bash
outplane bucket create my-app-uploads
outplane bucket key create my-app-uploads
```

Las notas de Out Plane sobre las subidas desde el navegador que necesitan una regla CORS no aplican aquí: el panel de administración de Rebase y el SDK suben a través de la API, y el runtime escribe en el bucket desde el servidor.

## 4. Añadir un Dockerfile

Out Plane compila ya sea desde un Dockerfile o con Buildpacks. Usa un Dockerfile: el proyecto se instala con pnpm, y la imagen compila el bundle por sí misma, para luego entregarlo al runtime publicado. Haz commit de esto en la raíz del proyecto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.38.0
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Tres detalles son importantes aquí:

- **`node:22`, no `node:22-slim`.** Instalar la CLI descarga el motor de esquemas Atlas, que necesita `curl` y certificados CA. La imagen slim no tiene ninguno de los dos y la instalación falla.
- **`--chown=node:node`.** El runtime se ejecuta como `node` y vincula sus propios paquetes dentro del bundle al iniciar. Un bundle propiedad de root seguirá funcionando, pero registrará una advertencia por cada paquete que no pudo vincular.
- **Sin código fuente en la imagen final.** Contiene el runtime y tu bundle compilado, y `dist-bundle/` permanece en el gitignore.

La imagen del runtime escucha en el puerto **8080** y lo declara con `EXPOSE`, por lo que Out Plane precompleta el puerto cuando lee el Dockerfile.

## 5. Crear la app

Crea una aplicación desde la consola, conecta el repositorio y la rama, y configura:

| Campo | Valor |
| --- | --- |
| Método de compilación | **Dockerfile** |
| Directorio raíz | `/` |
| Puerto | `8080`, **HTTP**, **público** |
| Comando de inicio | *(dejar vacío — el propio de la imagen)* |

```bash
outplane app create my-app --repo <owner>/<repo> --branch main --port 8080:http:public
```

En **Settings → Environment**, elige **Edit as .env** y pega:

```env
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app>.outplane.app
FRONTEND_URL=https://<your-app>.outplane.app
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<full bucket name, with its suffix>
S3_REGION=auto
S3_ENDPOINT=https://obj.outplane.dev
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=false
```

Luego pulsa **Save & deploy**. Out Plane aplica los cambios de entorno solo en el siguiente despliegue. Con la CLI, coloca las mismas líneas en un archivo y ejecuta `outplane env push --app my-app --deploy`.

Para qué sirven las líneas menos evidentes:

- **`NODE_ENV=production`.** Out Plane no lo define automáticamente. Sin esto, el runtime se inicia en modo de desarrollo, donde el primer usuario que se registre se convierte en administrador.
- **`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`.** En producción, la primera cuenta en registrarse no es promovida, por lo que estas variables definen al primer administrador. El runtime crea la cuenta una sola vez, mientras la tabla de usuarios esté vacía. Consulta [Tu primer admin](/docs/getting-started/deployment/#your-first-admin).
- **`S3_FORCE_PATH_STYLE=false`.** Rebase se dirige a un endpoint S3 personalizado usando path-style por defecto, ya que MinIO y la mayoría de los almacenamientos autohospedados lo requieren. Los buckets de Out Plane aceptan peticiones virtual-hosted únicamente (`https://<bucket>.obj.outplane.dev/…`), y las peticiones path-style fallan. Esta línea es obligatoria.
- **`S3_REGION=auto`.** Los buckets de Out Plane son globales y los clientes firman con `auto`.

La dirección `outplane.app` de la app aparece una vez que la app ha sido creada. Si difiere de lo que habías previsto, corrige `CORS_ORIGINS` y `FRONTEND_URL` y pulsa **Save & deploy** nuevamente.

## 6. Abrir la app

Abre la URL de la app. Un único contenedor sirve el panel de administración en `/` y la API en `/api`. Inicia sesión con `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`, y luego cambia la contraseña.

El primer inicio crea todas las tablas que necesita, incluidas las tuyas, junto con sus políticas de seguridad a nivel de fila. No hay migraciones que ejecutar primero. Sube un archivo desde el panel de administración para confirmar la configuración del bucket: un error aquí casi siempre significa que al nombre del bucket le falta el sufijo, o que falta `S3_FORCE_PATH_STYLE=false`.

Cada push a la rama vuelve a desplegar. Para usar tu propio dominio, agrégalo en **Domains**, conéctalo al puerto 8080 de la app y crea el CNAME (o, para un dominio raíz, el registro A) que muestra la consola. HTTPS se emitirá una vez que el registro se resuelva. Luego añade el nuevo origen a `CORS_ORIGINS` y `FRONTEND_URL`.

## Una sola instancia

Esta página se ejecuta en **una sola instancia**, que es el valor predeterminado de Out Plane y el límite del plan Starter. Un contenedor sirve la API, el panel de administración, el tiempo real, el cron y la cola de trabajos.

Los trabajos programados seguirían funcionando correctamente con más: cada ejecución de cron se reclama en Postgres antes de comenzar, por lo que un intervalo se ejecuta una sola vez sin importar cuántas instancias se activen para él. Otras cosas funcionan por instancia (limitadores de tasa, cachés de transformación de imágenes, subidas reanudables en progreso), así que lee [Más de una instancia](/docs/deployment/multiple-instances/) antes de aumentar el número en **Settings → Scale**.

## Almacenamiento de archivos

Las subidas residen en el bucket de Out Plane del paso 3, por lo que sobreviven a los redespliegues, y el disco propio de la aplicación no contiene nada de importancia.

Para rotar la clave: crea una nueva en la pestaña **Access** del bucket, establécela como `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY`, pulsa **Save & deploy**, y luego elimina la clave antigua. Out Plane señala que una clave eliminada puede seguir funcionando hasta por 15 minutos.

Quién puede leer, escribir y listar archivos lo decide `storageAuthorize` en `backend/storage.ts`, sin importar qué bucket los contenga. Consulta [Almacenamiento](/docs/backend/storage).

## El esquema

**El runtime crea las tablas faltantes al arrancar, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene el valor predeterminado `ensure`, que es aditivo en todo el esquema. Crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila, de modo que una nueva tabla estará activa en el siguiente despliegue.

`ensure` nunca modifica algo que ya existe. No altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que un despliegue no debe remodelar un esquema como efecto secundario.

Cualquier cambio que no sea puramente aditivo —una columna renombrada, un tipo más restringido, un campo eliminado— necesita `rebase db push`, ejecutado desde una copia local del código:

```bash
pnpm exec rebase db push --dry-run --database-url '<your DATABASE_URL>'
```

Revisa el SQL que imprime la ejecución de prueba (dry run), y luego ejecútalo de nuevo sin `--dry-run`. Un cambio que elimine datos también necesitará `--allow-destructive`.

`db push` planifica cada cambio en una copia temporal del esquema, en una base de datos con el mismo nombre que la tuya pero terminada en `_dev_diff`. Créala una vez en la pestaña **Access** de la base de datos, con el mismo rol propietario que tu base de datos.

Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `pnpm exec rebase db migrate --database-url '<your DATABASE_URL>'` desde una copia local antes de hacer push. Out Plane no tiene un paso de release que se ejecute antes de un despliegue.

## Siguientes pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación de producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.
- [Almacenamiento](/docs/backend/storage) — buckets, reglas de acceso y múltiples fuentes de almacenamiento al mismo tiempo.
