---
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: "Ejecuta Rebase en cualquier lugar con la imagen de runtime oficial y el bundle de tu proyecto: Docker Compose, Fly, Railway o un VPS común."
---

## Descripción general

Autoalojar Rebase significa ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que construir**. Tu proyecto viaja como un bundle,
el runtime está publicado y actualizar Rebase es un cambio de etiqueta (tag) en lugar de una
reconstrucción. Consulta [Runtime y bundles](/docs/architecture/runtime-and-bundles/) para
saber por qué está dividido de esa manera.

## Docker Compose

```bash
rebase build                     # produces ./dist-bundle
docker compose up -d db          # start Postgres
rebase db push                   # create the collection tables, once
docker compose up                # start the runtime
```

Un `docker-compose.yml` mínimo:

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: rebase
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      retries: 12

  api:
    image: rebasepro/server:latest
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      # Writable: the container installs the bundle's declared dependencies into
      # it on first start. See "Dependencies" below for the read-only variant.
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

volumes:
  db-data:
```

## Dependencias

`rebase build` escribe un `package.json` junto a tu bundle listando las
dependencias que declaró tu proyecto. El contenedor las instala en el primer inicio,
razón por la cual el montaje anterior es de escritura.

Para montarlo en modo solo lectura en su lugar —algo recomendable, ya que un hook
comprometido no podrá reescribir el código que se ejecuta tras el siguiente reinicio—,
instálalas primero:

```bash
npm install --omit=dev --prefix dist-bundle
```

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

Para un despliegue real, es preferible empaquetar ambos dentro de una imagen, lo cual
también fija exactamente lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.13.0
COPY dist-bundle /bundle
```

## Creación del esquema

El runtime crea sus propias tablas de **auth** al iniciar. **Las tablas de colecciones son
un paso separado y deliberado**, y la imagen del runtime no lo realiza —el reinicio de un
contenedor no debe poder cambiar un esquema como efecto secundario de un despliegue.

```bash
rebase db push
```

Ejecútalo desde un repositorio local (checkout) o un trabajo de CI, apuntando a la base
de datos del despliegue. Realiza una simulación (dry-run) del cambio primero, rechaza los
cambios destructivos sin una confirmación explícita y puede hacer una copia de seguridad
antes de aplicarlos.

`REBASE_MIGRATE_ON_BOOT` acepta `ensure` (el valor por defecto —solo tablas de auth) y
`none`.

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier sistema
que ejecute contenedores funcionará. Dos cosas que deben configurarse correctamente en todas partes:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él —consulta [Dependencias](#dependencies).
2. Configura `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se negará a
   iniciar en producción sin ellos en lugar de adivinarlos.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.13.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utiliza la forma de imagen derivada descrita anteriormente para que el bundle se envíe con la aplicación y luego ejecuta `fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, configura las variables de entorno y define la
ruta de comprobación de estado (health check) en `/livez`.

### Un VPS común

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Ejecútalo bajo systemd, con líneas `Environment=` para las variables anteriores.

## Verificaciones de estado

| Ruta | Uso |
| --- | --- |
| `/livez` | Vitalidad (Liveness). Responde a "¿está vivo este proceso?" sin tocar la base de datos. |
| `/health` | Disponibilidad (Readiness). Realiza una ida y vuelta (round-trip) a la base de datos y reporta la latencia. |

Apunta las pruebas de vitalidad (liveness probes) a `/livez`. Una prueba de vitalidad
en `/health` reiniciará un proceso perfectamente sano durante un pequeño problema temporal
de la base de datos, lo cual es lo opuesto a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuento de solicitudes e histogramas
de latencia desglosados por superficie de API (datos, auth, almacenamiento, funciones)
y colección, además de indicadores de proceso (gauges). Sin un token, el endpoint es
legible por cualquiera que pueda acceder al puerto, así que define uno a menos que esté
en una red privada.

## Actualización

```yaml
image: rebasepro/server:0.13.0
```

Reinicia. Tu bundle no cambia. Dentro de una versión mayor del contrato del runtime,
un bundle que haya sido validado seguirá funcionando; consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
