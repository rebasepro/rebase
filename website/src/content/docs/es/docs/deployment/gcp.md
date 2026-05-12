---
title: Desplegando Rebase en Google Cloud Platform
description: Despliega tu instancia de Rebase de forma segura en GCP usando Cloud SQL y Cloud Run, centrándote en regiones de centros de datos de la UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) ofrece una experiencia de desarrollador increíblemente fluida para aplicaciones contenerizadas. Para una configuración de producción robusta, aprovechamos **Cloud SQL** para la base de datos y **Cloud Run** para la columna vertebral de contenedores sin servidor.

Para mantener un estricto cumplimiento de datos europeos, asegúrate de operar completamente dentro de una región de la UE, como **europe-west3 (Frankfurt)**, **europe-west9 (París)** o **europe-west1 (Bélgica)**.

## 1. Aprovisionar Cloud SQL (PostgreSQL)

1. Navega a la consola de **Cloud SQL** en tu región de la UE preferida.
2. Haz clic en **Crear Instancia** y selecciona **PostgreSQL**.
3. Establece tu ID de Instancia y genera una contraseña segura integrada para el usuario `postgres`.
4. Expande las **Opciones de Configuración** para asignar el Tipo de Máquina correcto (una máquina estándar de 2 vCPU es un excelente comienzo).
5. Asegúrate de que la base de datos esté configurada para redes de IP Privada o IP Pública Autorizada, dependiendo de tu configuración de VCP con Cloud Run.
6. Ensambla tu URI de conexión:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

## 2. Compilar y Desplegar en Cloud Run

Cloud Run escala el backend Node.js de Rebase automáticamente a cero (si se desea) y maneja TLS de forma predeterminada. Puedes compilar y desplegar la aplicación en un solo movimiento CLI desde tu espacio de trabajo local usando Google Cloud Build.

Asegúrate de tener la CLI de `gcloud` instalada y autenticada:

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Submit the build to Cloud Build, which automatically creates the container image and stores it in Google Container Registry (GCR)
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/rebase-backend ./backend

# Deploy the newly built image to Cloud Run
gcloud run deploy rebase-backend \
  --image gcr.io/YOUR_PROJECT_ID/rebase-backend \
  --region europe-west3 \
  --port 3001 \
  --set-env-vars DATABASE_URL="postgresql://...",JWT_SECRET="YOUR_SECURE_RANDOM_STRING",NODE_ENV="production" \
  --allow-unauthenticated
```

## 3. Gestionar Almacenamiento de Archivos
Dado que las instancias de Cloud Run son estrictamente sin estado y efímeras, no puedes usar el almacenamiento en disco local para las cargas de archivos de Rebase.

1. Navega a **Google Cloud Storage** y crea un nuevo bucket privado en tu región de la UE elegida.
2. Sigue la [Documentación de Almacenamiento de Rebase](/docs/storage) para configurar Rebase para usar la API compatible con S3 proporcionada por Google Cloud Storage en lugar del sistema de archivos local.

¡Tu instancia de Rebase ahora es completamente sin servidor y altamente escalable de forma nativa dentro de la UE!

---
