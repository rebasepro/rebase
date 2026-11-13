---
sourceHash: 8d400239df61cbd4
title: Desplegar Rebase en Google Cloud Platform
description: Despliega tu instancia de Rebase de forma segura en GCP utilizando Cloud SQL y Cloud Run, centrándote en regiones de centros de datos de la UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) ofrece una experiencia de desarrollo fluida para aplicaciones contenerizadas. Para una configuración de producción robusta, utiliza **Cloud SQL** para la base de datos y **Cloud Run** para el entorno de ejecución (runtime).

Para mantener un cumplimiento estricto de los datos europeos, opera completamente dentro de una región de la UE como **europe-west3 (Fráncfort)**, **europe-west9 (París)** o **europe-west1 (Bélgica)**.

Nada en esta página es específico de GCP respecto a tu proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que produce `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en una laptop, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar Cloud SQL (PostgreSQL)

1. Navega a la consola de **Cloud SQL** en tu región de la UE preferida.
2. Haz clic en **Crear instancia** y selecciona **PostgreSQL**.
3. Define tu ID de instancia y genera una contraseña segura para el usuario `postgres`.
4. Despliega **Opciones de configuración** para elegir un tipo de máquina (dos vCPUs es un buen punto de partida).
5. Configura una IP privada o una red pública autorizada, dependiendo de cómo Cloud Run accederá a ella.
6. Arma tu URI de conexión:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si tus tablas declaran una columna `col.vector()`, habilita la extensión una vez ejecutando `CREATE EXTENSION vector;` en la base de datos.

## 2. Construir el bundle e incorporarlo en una imagen

**No hay ninguna imagen de aplicación que construir a partir de tu código fuente**. `rebase build` produce un directorio `dist-bundle` con tus tablas, funciones, crons compilados y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Cloud Run descarga imágenes desde un registro, así que incorpora el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

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

Actualizar Rebase más adelante es tan simple como cambiar esa línea `FROM`. Tu bundle no se modifica.

## 3. Desplegar en Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inyecta `PORT` y el runtime se vincula a él, por lo que no hay ningún puerto que configurar. Apunta el sondeo de inicio (startup probe) a `/livez` en lugar de `/health`: el segundo realiza un viaje de ida y vuelta a la base de datos, por lo que un sondeo de liveness sobre él reiniciaría una revisión en buen estado durante una breve interrupción de la base de datos.

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` son la forma en que este servicio obtiene un administrador: en producción, la primera cuenta que se registra no es promovida, por lo que nada más genera el primer usuario autenticado. Configúralos antes de que la primera revisión empiece a servir tráfico; consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` reemplaza el bloque de entorno **completo** en cada despliegue, por lo que un despliegue posterior que omita una variable la eliminará silenciosamente. Mantén la lista completa en tu script de despliegue.

Para acceder a una instancia privada de Cloud SQL se necesita `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` y una `DATABASE_URL` de tipo socket; una instancia pública con una red autorizada no necesita ninguna de las dos cosas.

## 4. El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas faltantes al iniciar, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (row-level security), de modo que el primer inicio frente a una instancia vacía arranca sirviendo tus tablas.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el inicio de una revisión no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, una cosa todavía requiere la CLI, ejecutada desde una copia local o un trabajo de CI:

```bash
rebase db push
```

Cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restrictivo, un campo eliminado.

Desde tu máquina, conéctate a través del [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) y apunta `DATABASE_URL` a `localhost`. La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor de Cloud Run. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de la fase de release.

## Almacenamiento de archivos

Las instancias de Cloud Run son sin estado (stateless) y efímeras, por lo que el almacenamiento local de archivos implica una pérdida silenciosa de datos y el runtime lo rechaza en producción.

1. Crea un bucket privado de Google Cloud Storage en tu región de la UE seleccionada.
2. Crea una clave HMAC para una cuenta de servicio que pueda usar el bucket (**Cloud Storage → Configuración → Interoperabilidad**), y accede al bucket a través de su endpoint compatible con S3: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, y la clave como `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — consulta [Almacenamiento](/docs/backend/storage). `STORAGE_TYPE=gcs` carga `@google-cloud/storage`, paquete que la imagen de runtime no incluye, y una copia en tu bundle no se encuentra en su ruta de resolución.

:::caution
Cloud Run escala a cero. Si tu proyecto utiliza suscripciones en tiempo real, configura `--min-instances 1`: las conexiones WebSocket se terminan cuando una instancia se escala hacia abajo.
:::

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador comunes a todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.
