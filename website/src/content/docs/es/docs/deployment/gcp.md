---
sourceHash: 0632063aadcff623
title: Despliegue de Rebase en Google Cloud Platform
description: Despliegue su instancia de Rebase de forma segura en GCP utilizando Cloud SQL y Cloud Run, con foco en las regiones de centros de datos de la UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) ofrece una experiencia de desarrollo fluida para aplicaciones contenerizadas. Para una configuración de producción robusta, utilice **Cloud SQL** para la base de datos y **Cloud Run** para el runtime.

Para mantener un cumplimiento estricto de la normativa europea de datos, opere completamente dentro de una región de la UE como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** o **europe-west1 (Belgium)**.

Nada en esta página es específico de GCP respecto a su proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen del runtime publicada y el **bundle** que genera `rebase build`. El mismo bundle se ejecuta bajo Docker Compose en una portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar Cloud SQL (PostgreSQL)

1. Navegue a la consola de **Cloud SQL** en su región preferida de la UE.
2. Haga clic en **Create Instance** y seleccione **PostgreSQL**.
3. Establezca su Instance ID y genere una contraseña segura para el usuario `postgres`.
4. Despliegue **Configuration Options** para elegir un tipo de máquina (dos vCPU es un buen punto de partida).
5. Configure la IP privada o una red pública autorizada, dependiendo de cómo Cloud Run se conectará a ella.
6. Arme su URI de conexión:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si sus tablas declaran una columna `col.vector()`, habilite la extensión una vez: `CREATE EXTENSION vector;` en la base de datos.

## 2. Compilar el bundle e integrarlo en una imagen

**No hay ninguna imagen de aplicación que compilar desde su código fuente**. `rebase build` genera un directorio `dist-bundle` con sus tablas, funciones y tareas cron compiladas y, si su proyecto declara una app estática, su frontend compilado. La imagen de runtime publicada se encarga de ejecutarlo:

```bash
rebase build
```

Cloud Run descarga imágenes desde un registro, por lo que debe incorporar el bundle en una imagen derivada. Tres líneas bastan para fijar con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Create an Artifact Registry repository (one-time)
gcloud artifacts repositories create rebase --repository-format=docker --location=europe-west3

# Authenticate Docker to Artifact Registry (one-time)
gcloud auth configure-docker europe-west3-docker.pkg.dev

# Build from the project root and push
docker build -t europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest .
docker push europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest
```

Actualizar Rebase más adelante consiste simplemente en cambiar esa línea `FROM`. Su bundle no se modifica.

## 3. Desplegar en Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inyecta `PORT` y el runtime se vincula a él, por lo que no hay ningún puerto que configurar. Apunte la prueba de inicio (startup probe) a `/livez` en lugar de `/health`: esta última realiza un viaje de ida y vuelta a la base de datos, por lo que una prueba de liveness sobre ella reiniciará una revisión en buen estado durante una breve interrupción en la base de datos.

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` son el medio por el cual este servicio obtiene un administrador: en producción, la primera cuenta en registrarse no es promovida, por lo que ninguna otra acción generará el primer usuario autenticado. Configúrelas antes de que la primera revisión sirva tráfico; consulte [Su primer administrador](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` reemplaza el bloque de entorno **completo** en cada despliegue, por lo que un despliegue posterior que omita una variable la eliminará silenciosamente. Mantenga la lista completa en su script de despliegue.

Para conectarse a una instancia privada de Cloud SQL se requiere `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` y una `DATABASE_URL` con formato de socket; una instancia pública con una red autorizada no necesita ninguna de las dos.

## 4. El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que faltan durante el arranque, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, el cual es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (row-level security), de modo que el primer inicio frente a una instancia vacía comienza a servir sus colecciones.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el inicio de una revisión no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, hay algo que aún requiere el CLI, ejecutado desde un clon local del repositorio o un trabajo de CI:

```bash
rebase db push
```

Cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restrictivo o un campo eliminado.

Desde su máquina, conéctese a través de [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) y apunte `DATABASE_URL` a `localhost`. La imagen del runtime viene sin el CLI, por lo que esto nunca se ejecuta dentro del contenedor de Cloud Run. Para migraciones versionadas, confirme los archivos de migración con `rebase db generate` y ejecute `rebase db migrate` como un paso de la fase de release.

## Almacenamiento de archivos

Las instancias de Cloud Run son efímeras y no tienen estado (stateless), por lo que el almacenamiento local de archivos implica una pérdida silenciosa de datos y el runtime lo rechaza en producción.

1. Cree un bucket privado de Google Cloud Storage en la región de la UE que elija.
2. Cree una clave HMAC para una cuenta de servicio que pueda usar el bucket (**Cloud Storage → Settings → Interoperability**) y acceda al bucket a través de su endpoint compatible con S3: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, y la clave como `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — consulte [Almacenamiento](/docs/backend/storage). `STORAGE_TYPE=gcs` carga `@google-cloud/storage`, paquete que la imagen del runtime no incluye, y una copia en su bundle no estará en su ruta de resolución.

:::caution
Cloud Run escala a cero. Si su proyecto utiliza suscripciones en tiempo real, configure `--min-instances 1` — las conexiones WebSocket se terminan cuando una instancia se escala a la baja.
:::

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador comunes a todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
