---
sourceHash: 70d7eb76c5784603
title: Despliegue
sidebar_label: Visión general
description: Dónde se puede ejecutar un proyecto de Rebase — Rebase Cloud, tu propio servidor, Kubernetes o una plataforma de contenedores administrada — y qué guía abrir para cada caso.
---

## Qué despliegas

Un despliegue de Rebase consta de dos piezas separables: la **imagen de runtime publicada**
(`rebasepro/server`) y el **bundle** que `rebase build` genera a partir de tu
proyecto. No es necesario compilar ninguna imagen de aplicación, y actualizar Rebase es simplemente
cambiar una etiqueta en lugar de recompilar. El mismo bundle se ejecuta en una laptop con Docker
Compose, en Rebase Cloud y en cada una de las plataformas que figuran a continuación.

Si este es tu primer despliegue, lee primero la
[guía de despliegue](/docs/getting-started/deployment/): explica lo que sirve el
servidor, el entorno que necesita y cómo designar al primer
administrador antes del primer inicio.

## Ejecútalo por mí

- **[Rebase Cloud](/docs/deployment/cloud/)** — el mismo Rebase, operado para
  ti: `rebase cloud deploy` desde tu proyecto, una base de datos por proyecto, copias de seguridad
  y TLS incluidos.
- **[Runtime de backend administrado](/docs/deployment/managed-runtime/)** — lo que un
  backend con `runtime: "managed"` puede hacer allí: paquetes, memoria, tiempos de espera,
  el sistema de archivos, secretos, almacenamiento y red de salida.

## Ejecútalo tú mismo

- **[Autohospedaje](/docs/deployment/self-hosting/)** — la imagen de runtime más una
  base de datos Postgres, en Docker Compose o un VPS simple. Empieza aquí.
- **[Kubernetes](/docs/deployment/kubernetes/)** — el Helm chart oficial, con
  un Job de migración responsable del esquema.
- **[División en varios procesos](/docs/deployment/split-processes/)** —
  un bundle como API, una capa de funciones y un worker, para que una función pesada
  no compita con la API de datos.
- **[Ejecutar más de una instancia](/docs/deployment/multiple-instances/)** —
  el estado que cada proceso mantiene para sí mismo, y la configuración que lo comparte,
  antes de que una segunda réplica reciba tráfico.

## Guías de plataformas

Cada una de estas opciones consta de las mismas dos piezas, conectadas a la base de datos Postgres administrada
y al runtime de contenedores de ese proveedor. Todas ellas pueden mantenerse dentro de la UE.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS y App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL y Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL y Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — el archivo Compose de tu proyecto en
  un servidor, o Terraform, en Alemania o Finlandia.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, en Francia.
- **[Railway](/docs/deployment/railway/)** — la imagen y un Postgres administrado,
  en un solo proyecto.
- **[Fly.io](/docs/deployment/flyio/)** — global, o fijado a regiones de la UE.
- **[InstaPods](/docs/deployment/instapods/)** — Node y PostgreSQL en un solo pod,
  archivos subidos en su disco, sin Docker.
- **[Hostman](/docs/deployment/hostman/)** — App Platform con Managed
  PostgreSQL, o un servidor en la nube.
- **[Out Plane](/docs/deployment/outplane/)** — una aplicación desde tu repositorio,
  PostgreSQL administrado y un bucket, en Alemania.
