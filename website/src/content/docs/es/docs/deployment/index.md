---
sourceHash: 4c2b6974a271effa
title: Despliegue
sidebar_label: Resumen
description: Dónde puede ejecutarse un proyecto Rebase — Rebase Cloud, tu propio servidor, Kubernetes o una plataforma de contenedores gestionada — y qué guía abrir en cada caso.
---

## Qué se despliega

Un despliegue de Rebase son dos piezas separables: la **imagen de runtime
publicada** (`rebasepro/server`) y el **bundle** que `rebase build` genera a
partir de tu proyecto. No hay ninguna imagen de aplicación que construir, y
actualizar Rebase es un cambio de etiqueta en lugar de una reconstrucción. El
mismo bundle se ejecuta en tu portátil con Docker Compose, en Rebase Cloud y en
todas las plataformas de más abajo.

Si es tu primer despliegue, lee antes la
[guía de despliegue](/docs/getting-started/deployment/): explica qué sirve el
servidor, qué entorno necesita y cómo nombrar al primer administrador antes del
primer arranque.

## Que lo operen por ti

- **[Rebase Cloud](/docs/deployment/cloud/)** — el mismo Rebase, operado por
  nosotros: `rebase cloud deploy` desde tu proyecto, una base de datos por
  proyecto, copias de seguridad y TLS incluidos.

## Operarlo tú mismo

- **[Autoalojamiento](/docs/deployment/self-hosting/)** — la imagen de runtime
  más una base de datos Postgres, con Docker Compose o en un VPS sencillo.
  Empieza aquí.
- **[Kubernetes](/docs/deployment/kubernetes/)** — el chart de Helm oficial, con
  un Job de migración que es dueño del esquema.
- **[Dividir en varios procesos](/docs/deployment/split-processes/)** — un
  bundle como API, capa de funciones y worker, para que una función pesada deje
  de competir con la API de datos.

## Guías por plataforma

Cada una son las mismas dos piezas, conectadas al Postgres gestionado y al
runtime de contenedores de ese proveedor. Todas pueden mantenerse dentro de la
UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS y App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL y Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL y Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform o Docker Compose,
  en Alemania o Finlandia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, en
  Francia.
- **[Railway](/docs/deployment/railway/)** — la imagen y un Postgres gestionado,
  en un mismo proyecto.
- **[Fly.io](/docs/deployment/flyio/)** — global, o fijado a regiones de la UE.
