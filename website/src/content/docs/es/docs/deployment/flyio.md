---
sourceHash: 263c0ae6a0fac44f
title: Desplegar Rebase en Fly.io
description: Aprende a desplegar Rebase globalmente o a restringirlo a centros de datos europeos utilizando Fly.io.
sidebar_label: Fly.io
---

Fly.io ejecuta contenedores Docker cerca de tus usuarios en una red global anycast y es altamente configurable respecto a dónde residen los datos — una opción ideal para un despliegue de Rebase con un enfoque estrictamente europeo. Fly cuenta con centros de datos en **Ámsterdam (ams)**, **Fráncfort (fra)**, **Madrid (mad)** y **París (cdg)**.

Nada en esta página es específico de Fly con respecto a tu proyecto. Un despliegue de Rebase consta de dos piezas separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en una laptop, en Rebase Cloud, bajo el [chart de Helm](/docs/deployment/kubernetes) y aquí.

## 1. Inicializar la app de Fly

Con `flyctl` instalado, desde tu proyecto:

```bash
fly launch --no-deploy
```

1. **Nombre de la app:** `my-rebase-app`
2. **Organización:** personal o la organización de tu empresa.
3. **Región:** elige un centro de datos europeo — Fráncfort (`fra`) o París (`cdg`).
4. **Base de datos:** responde **Yes** a un clúster de Postgres. Fly lo crea en la misma región e inyecta `DATABASE_URL`.
5. **Redis:** responde **No**.

`--no-deploy` porque los secretos y el bundle deben estar listos primero.

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez en esa base de datos: `CREATE EXTENSION vector;`.

## 2. Compilar el bundle y apuntar fly.toml a la imagen de runtime

**No hay ninguna imagen de aplicación que compilar a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones, funciones y crons compilados y —si tu proyecto declara una aplicación estática— tu frontend compilado:

```bash
rebase build
```

Haz commit de un `Dockerfile` de tres líneas en la raíz del proyecto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Y apunta `fly.toml` hacia él:

```toml title="fly.toml"
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  DISABLE_SELF_REGISTRATION = "true"

[http_service]
  internal_port = 8080          # the port the runtime image listens on
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1      # realtime subscriptions need a machine to stay up

[[http_service.checks]]
  path = "/livez"
```

`/livez` en lugar de `/health`: el segundo realiza un viaje de ida y vuelta a la base de datos, por lo que una comprobación de liveness en él reiniciaría una máquina en buen estado durante un breve fallo temporal de la base de datos.

`DISABLE_SELF_REGISTRATION` es nuevo: en 0.17.3 no existe tal opción, y la primera cuenta en registrarse se convierte en el administrador.

Actualizar Rebase más adelante consiste simplemente en cambiar esa línea `FROM`. Tu bundle no se modifica.

## 3. Configurar los secretos de producción

```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=$(openssl rand -hex 12) \
  -a my-rebase-app
```

Los dos últimos son nuevos y son la forma en que esta app obtiene un administrador: en producción, la primera cuenta en registrarse no se promociona, por lo que nada más generaría el primer usuario autenticado. Configúralos antes de que el primer despliegue reciba tráfico; consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` solo muestra resúmenes (digests), así que guarda la contraseña generada con este comando; no hay forma de volver a leerla.

## 4. Desplegar

```bash
fly deploy
```

Luego `fly open`.

## 5. El esquema

**El runtime crea las tablas que falten al arrancar, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum que falten y aplica su seguridad a nivel de fila (RLS), de modo que el primer inicio contra una base de datos vacía se pone en marcha sirviendo tus colecciones.

Lo que `ensure` nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de una máquina no debe alterar el esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas todavía requieren la CLI, ejecutada desde una copia de trabajo o un trabajo de CI:

```bash
rebase db push
```

- **RLS en tablas de unión** para relaciones de muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restrictivo, un campo eliminado.

Para un Postgres privado de Fly, abre un túnel con `fly proxy 5432 -a <your-db-app>` y apunta `DATABASE_URL` a `localhost:5432`. La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro de la máquina y un `release_command` tampoco puede invocarlo. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

El sistema de archivos de una máquina de Fly no sobrevive a un despliegue, por lo que el almacenamiento local de archivos supone una pérdida silenciosa de datos y el runtime lo rechaza en producción. Conecta un bucket compatible con S3 —Tigris es el que Fly aprovisiona— con `STORAGE_TYPE=s3`. Consulta [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas para el primer administrador comunes a todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.

---
