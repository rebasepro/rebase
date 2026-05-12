---
title: Despliegue de Rebase en Fly.io
description: Aprende a desplegar Rebase globalmente o a restringirlo a centros de datos europeos usando Fly.io.
sidebar_label: Fly.io
---

Fly.io te permite alojar contenedores Docker cerca de tus usuarios a través de su red global anycast. Fly es altamente configurable en cuanto al enrutamiento de datos, lo que lo convierte en una excelente opción para desplegar aplicaciones Rebase con un estricto enfoque en datos europeos.

Fly.io cuenta con centros de datos en **Ámsterdam (ams)**, **Fráncfort (fra)**, **Madrid (mad)** y **París (cdg)**.

## 1. Inicializar la aplicación Fly
Desde tu repositorio local de Rebase, después de asegurarte de que la CLI de Fly (`flyctl`) está instalada, ejecuta:

```bash
fly launch
```

1.  **Nombre de la Aplicación:** `my-rebase-app`
2.  **Organización:** Personal o tu Organización corporativa.
3.  **Región:** Cuando se te pida una región, elige explícitamente un centro de datos europeo como **Fráncfort (fra)** o **París (cdg)**.
4.  **Base de Datos:** Cuando se te pida configurar una base de datos Postgres, di **Sí**. Fly creará automáticamente un clúster de Postgres en la *misma región* e inyectará de forma segura la `DATABASE_URL` en tu aplicación.
5.  **Redis:** Di **No**.

*No despliegues todavía cuando se te pida.* Primero necesitamos configurar una variable de entorno crítica.

## 2. Configuración del Secreto JWT
Antes de que tu aplicación se inicie en producción, debes inyectar el Secreto JWT para que Rebase pueda firmar de forma segura las operaciones de los tokens de autenticación.

Ejecuta el siguiente comando localmente:
```bash
fly secrets set JWT_SECRET=your_super_long_randomly_generated_secure_string -a my-rebase-app
```

## 3. Validar la Configuración Interna
Fly habrá generado un archivo `fly.toml` en la raíz de tu proyecto. Verifica que el puerto interno se alinee explícitamente con la configuración predeterminada de Rebase (`3001`):

```toml
# fly.toml
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3001 # Make sure this matches your Hono app port
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
```

## 4. Desplegar

Tus datos están localizados, tu base de datos está provisionada y tus secretos están inyectados. Inicia el despliegue:

```bash
fly deploy
```

Una vez que el análisis y la carga se completen, tu aplicación estará en línea automáticamente. ¡Ejecuta `fly open` para ver tu aplicación desplegada en el navegador!
---
