---
sourceHash: 0633ef5ec34074cf
title: Desplegando Rebase en Google Cloud Platform
description: Despliega tu instancia de Rebase de forma segura en GCP usando Cloud SQL y Cloud Run, con un enfoque en regiones de centros de datos de la UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) ofrece una experiencia de desarrollo fluida para aplicaciones contenerizadas. Para una configuración de producción robusta, utiliza **Cloud SQL** para la base de datos y **Cloud Run** para el entorno de ejecución.

Para mantener un cumplimiento estricto de la normativa europea de datos, opera completamente dentro de una región de la UE como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** o **europe-west1 (Belgium)**.

Nada en esta página es específico de GCP en lo que respecta a tu proyecto. Un despliegue de Rebase consta de dos piezas separables: la imagen de ejecución publicada y el **bundle** que genera `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en un portátil, en Rebase Cloud, mediante el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar Cloud SQL (PostgreSQL)

1. Navega a la consola de **Cloud SQL** en tu región preferida de la UE.
2. Haz clic en **Create Instance** y selecciona **PostgreSQL**.
3. Define tu Instance ID y genera una contraseña segura para el usuario `postgres`.
4. Despliega **Configuration Options** para elegir un tipo de máquina (dos vCPUs es un buen punto de partida).
5. Configura una IP privada o una red pública autorizada, dependiendo de cómo se conectará Cloud Run.
6. Construye tu URI de conexión:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez: `CREATE EXTENSION vector;` en la base de datos.

## 2. Construir el bundle e integrarlo en una imagen

No hay **ninguna imagen de aplicación que compilar a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones compiladas, funciones, crons y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de ejecución publicada se encarga de ejecutarlo:

```bash
rebase build
```

Cloud Run descarga imágenes desde un registro, por lo que debes empaquetar el bundle dentro de una imagen derivada. Tres líneas bastan y fijan exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Actualizar Rebase más adelante consiste simplemente en cambiar esa línea `FROM`. Tu bundle permanece intacto.

## 3. Desplegar en Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inyecta `PORT` y el entorno de ejecución se vincula a él, por lo que no hay ningún puerto que configurar. Apunta la sonda de inicio (startup probe) a `/livez` en lugar de a `/health`: la segunda realiza un viaje de ida y vuelta a la base de datos, por lo que una sonda de liveness sobre ella reiniciaría una revisión en buen estado durante un breve fallo momentáneo de la base de datos.

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` son el medio por el cual este servicio obtiene un administrador: en producción, la primera cuenta que se registra no se promociona automáticamente, por lo que nada más generará el primer usuario autenticado. Configúralos antes de que la primera revisión empiece a recibir tráfico; consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` reemplaza el bloque de entorno **completo** en cada despliegue, por lo que un despliegue posterior que omita una variable la eliminará silenciosamente. Mantén la lista completa en tu script de despliegue.

Para conectarse a una instancia privada de Cloud SQL se requiere `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` y una `DATABASE_URL` basada en sockets; una instancia pública con una red autorizada no necesita ninguna de las dos cosas.

## 4. El esquema

**El entorno de ejecución crea las tablas que falten durante el arranque, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, el cual es acumulativo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), de modo que el primer arranque contra una instancia vacía comienza sirviendo tus colecciones.

Lo que `ensure` nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el arranque de una revisión no debe remodelar el esquema como un efecto secundario del despliegue.

Por lo tanto, dos cosas todavía requieren la CLI, ejecutada desde una copia local o un job de CI:

```bash
rebase db push
```

- **RLS de tablas de unión (junction-table)** para relaciones de muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restrictivo, un campo eliminado.

Desde tu máquina, conéctate a través del [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) y apunta `DATABASE_URL` a `localhost`. La imagen de ejecución se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor de Cloud Run. Para migraciones versionadas, confirma los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release.

## Almacenamiento de archivos

Las instancias de Cloud Run son efímeras y no mantienen estado, por lo que el almacenamiento local de archivos implica una pérdida silenciosa de datos y el entorno de ejecución lo rechaza en producción.

1. Crea un bucket privado de Google Cloud Storage en tu región de la UE elegida.
2. Establece `STORAGE_TYPE=gcs` y su bucket; consulta [Almacenamiento](/docs/backend/storage). En Cloud Run, la cuenta de servicio del entorno proporciona las credenciales, por lo que no hay nada más que configurar.

:::caution
Cloud Run escala a cero. Si tu proyecto utiliza suscripciones en tiempo real, establece `--min-instances 1`: las conexiones WebSocket se interrumpen cuando una instancia se reduce a cero.
:::

## Siguientes pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador compartidas por todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.

---
