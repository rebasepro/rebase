---
sourceHash: 7a718828c0eed5a6
title: Despliegue
sidebar_label: Descripción general
description: Dónde se puede ejecutar un proyecto de Rebase — Rebase Cloud, tu propio servidor, Kubernetes o una plataforma de contenedores gestionada — y qué guía consultar para cada caso.
---

## Qué despliegas

Un despliegue de Rebase consta de dos partes separables: la **imagen de runtime publicada**
(`rebasepro/server`) y el **bundle** que `rebase build` genera a partir de tu
proyecto. No hay ninguna imagen de aplicación que construir, y actualizar Rebase es un simple
cambio de tag en lugar de una reconstrucción. El mismo bundle se ejecuta en un equipo local
con Docker Compose, en Rebase Cloud y en cada una de las plataformas que figuran a continuación.

Si este es tu primer despliegue, lee primero la
[guía de despliegue](/docs/getting-started/deployment/): explica lo que sirve el
servidor, el entorno que necesita y cómo nombrar al primer
administrador antes del primer arranque.

## Ejecútalo por mí

- **[Rebase Cloud](/docs/deployment/cloud/)** — el mismo Rebase, operado para
  ti: `rebase cloud deploy` desde tu proyecto, una base de datos por proyecto, copias de seguridad
  y TLS incluidos.
- **[Runtime de backend gestionado](/docs/deployment/managed-runtime/)** — lo que un
  backend con `runtime: "managed"` puede hacer allí: paquetes, memoria, tiempos límite (timeouts),
  el sistema de archivos, secretos, almacenamiento y red de salida.

## Ejecútalo tú mismo

- **[Autoalojamiento](/docs/deployment/self-hosting/)** — la imagen de runtime más una
  base de datos Postgres, en Docker Compose o en un VPS estándar. Empieza aquí.
- **[Kubernetes](/docs/deployment/kubernetes/)** — el Helm chart oficial, con
  un Job de migración que se encarga del esquema.
- **[División en varios procesos](/docs/deployment/split-processes/)** —
  un bundle como API, una capa de funciones y un worker, para que una función
  pesada deje de competir con la API de datos.
- **[Ejecución de más de una instancia](/docs/deployment/multiple-instances/)** —
  el estado que cada proceso mantiene para sí mismo y la configuración que lo comparte,
  antes de que una segunda réplica reciba tráfico.

## Guías de plataformas

Cada una de ellas se compone de las dos mismas piezas, conectadas a la base de datos Postgres
gestionada y al runtime de contenedores de ese proveedor. Todas ellas pueden mantenerse dentro de la UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS y App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL y Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL y Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform o Docker Compose,
  en Alemania o Finlandia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, en Francia.
- **[Railway](/docs/deployment/railway/)** — la imagen y un Postgres gestionado,
  en un solo proyecto.
- **[Fly.io](/docs/deployment/flyio/)** — global, o fijado a regiones de la UE.
