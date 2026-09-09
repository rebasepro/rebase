---
sourceHash: e902dc7a4aad0fa2
title: Despliegue de Rebase en Google Cloud Platform
description: Despliega tu instancia de Rebase de forma segura en GCP usando Cloud SQL y Cloud Run, con un enfoque en regiones de centros de datos de la UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) ofrece una experiencia de desarrollo fluida para aplicaciones contenerizadas. Para una configuración de producción robusta, utiliza **Cloud SQL** para la base de datos y **Cloud Run** para el runtime.

Para mantener un estricto cumplimiento de los datos europeos, opera completamente dentro de una región de la UE como **europe-west3 (Frankfurt)**, **europe-west9 (París)** o **europe-west1 (Bélgica)**.

Nada en esta página es específico de GCP respecto a tu proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en un equipo local, en Rebase Cloud, bajo el [chart de Helm](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar Cloud SQL (PostgreSQL)

1. Navega a la consola de **Cloud SQL** en tu región preferida de la UE.
2. Haz clic en **Create Instance** y selecciona **PostgreSQL**.
3. Establece el ID de tu instancia y genera una contraseña segura para el usuario `postgres`.
4. Despliega las **Configuration Options** para elegir un tipo de máquina (dos vCPU es un buen punto de partida).
5. Configura una IP privada o una red pública autorizada, según cómo Cloud Run vaya a conectarse a ella.
6. Construye tu URI de conexión:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez: `CREATE EXTENSION vector;` en la base de datos.

## 2. Construir el bundle e incorporarlo en una imagen

**No hay ninguna imagen de aplicación que compilar a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones compiladas, funciones, tareas cron y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Cloud Run descarga imágenes desde un registro, así que incorpora el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
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

Actualizar Rebase más adelante consiste simplemente en cambiar esa línea `FROM`. Tu bundle no se modifica.

## 3. Desplegar en Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inyecta la variable `PORT` y el runtime se vincula a ella, por lo que no hay ningún puerto que configurar. Dirige la sonda de inicio (startup probe) a `/livez` en lugar de `/health`: esta última realiza un viaje de ida y vuelta a la base de datos, por lo que una sonda de liveness sobre ella reiniciaría una revisión en buen estado durante un breve fallo temporal de la base de datos.

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` son la forma en que este servicio obtiene un administrador: en producción, la primera cuenta que se registra no es promovida, por lo que nada más creará al primer usuario autenticado. Configúralas antes de que la primera revisión comience a servir tráfico; consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` reemplaza **todo** el bloque de variables de entorno en cada despliegue, por lo que un despliegue posterior que omita una variable la eliminará silenciosamente. Mantén la lista completa en tu script de despliegue.

Para conectarse a una instancia privada de Cloud SQL se necesita `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` y una `DATABASE_URL` de tipo socket; una instancia pública con una red autorizada no necesita ninguna de las dos.

## 4. El esquema

**El runtime crea las tablas faltantes al arrancar, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), de modo que el primer inicio frente a una instancia vacía arranca sirviendo tus colecciones.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el arranque de una revisión no debe modificar la estructura del esquema como efecto secundario de un despliegue.

Por lo tanto, hay dos cosas que aún requieren la CLI, ejecutada desde una copia local del código o un trabajo de CI:

```bash
rebase db push
```

- **RLS en tablas intermedias (junction tables)** para relaciones muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restrictivo o un campo eliminado.

Desde tu máquina, conéctate a través del [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) y apunta `DATABASE_URL` a `localhost`. La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor de Cloud Run. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso del proceso de release en su lugar.

## Almacenamiento de archivos

Las instancias de Cloud Run son sin estado (stateless) y efímeras, por lo que el almacenamiento local de archivos supone una pérdida silenciosa de datos y el runtime lo rechaza en producción.

1. Crea un bucket privado de Google Cloud Storage en tu región de la UE elegida.
2. Configura `STORAGE_TYPE=gcs` y su bucket; consulta [Storage](/docs/backend/storage). En Cloud Run, la cuenta de servicio del entorno proporciona las credenciales, por lo que no hay nada más que configurar.

:::caution
Cloud Run escala a cero. Si tu proyecto utiliza suscripciones en tiempo real, configura `--min-instances 1`; las conexiones WebSocket se terminan cuando se reduce la escala de una instancia.
:::

## Próximos pasos

- [Deployment](/docs/getting-started/deployment): la lista de comprobación para producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuration](/docs/getting-started/configuration): cada variable de entorno que lee el runtime.

---
