---
sourceHash: 32d97963eacb9f50
title: Desplegando Rebase en Railway
description: Despliega Rebase en Railway a partir de la imagen de runtime publicada y el bundle de tu proyecto. Mantén el enfoque en la UE.
sidebar_label: Railway
---

Railway es una PaaS moderna que simplifica DevOps y admite regiones de despliegue europeas (Ámsterdam), lo que te permite mantener el cumplimiento de alojamiento regional.

Nada en esta página sobre tu proyecto es específico de Railway. Un despliegue de Rebase consta de dos partes diferenciables: la imagen de runtime publicada y el **bundle** que genera `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en una laptop, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Crear un proyecto y una región de la UE

1. Inicia sesión en tu [cuenta de Railway](https://railway.app/).
2. Haz clic en **New Project**.
3. Ve a **Settings → Default Region** y establécelo en **Europe (Amsterdam)**. Hacer esto *después* de crear servicios implica migrarlos manualmente.

## 2. Aprovisionar PostgreSQL

1. Dentro de tu proyecto, haz clic en **New → Database → Add PostgreSQL**.
2. Espera a que se aprovisione.
3. Railway expone una variable interna `DATABASE_URL` en la pestaña **Variables** del widget de Postgres.

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez en esa base de datos: `CREATE EXTENSION vector;`.

## 3. Construir el bundle e incorporarlo en una imagen

**No hay ninguna imagen de aplicación que construir a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones compiladas, funciones, crons y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Haz commit de un `Dockerfile` de tres líneas en la raíz del repositorio, de modo que el paso de compilación de Railway sea una copia en lugar de una compilación:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Construye el bundle en CI y haz commit o súbelo como parte de tu release, o ejecuta `rebase build` antes de hacer push. De cualquier forma, la imagen que Railway construye no contiene ninguna toolchain ni código fuente; actualizar Rebase más adelante consiste en cambiar esa línea `FROM`, dejando tu bundle intacto.

Luego: **New → GitHub Repo**, selecciona tu repositorio y deja que Railway detecte el Dockerfile en la raíz.

## 4. Configurar variables de entorno

1. Haz clic en la tarjeta del servicio.
2. Ve a la pestaña **Variables**.
3. Añade:
   - `JWT_SECRET`: una cadena aleatoria segura de más de 32 caracteres.
   - `REBASE_SERVICE_KEY`: otra cadena aleatoria segura de más de 32 caracteres.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: el dominio de tu frontend (ej. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: lo mismo que `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: la dirección del primer administrador
   - `REBASE_ADMIN_PASSWORD`: al menos 12 caracteres

   Los últimos tres son la forma en que este servicio obtiene un administrador: en producción, la primera cuenta que se registra no es promovida, por lo que nada más generará el primer usuario autenticado. Configúralos antes de que el servicio comience a recibir tráfico; consulta [Tu primer admin](/docs/getting-started/deployment/#your-first-admin).

4. Haz clic en **Reference Variable** y selecciona `DATABASE_URL` del servicio PostgreSQL. Railway inyecta la URL interna de Postgres en tiempo de ejecución.

Railway define `PORT` y el runtime se vincula a él, por lo que no hay ningún puerto que configurar. Apunta el health check a `/livez` en lugar de `/health`: el segundo realiza un viaje de ida y vuelta a la base de datos (round-trip), por lo que una sonda de liveness sobre él reiniciará un contenedor en buen estado durante un breve fallo momentáneo de la base de datos.

## 5. Exponer el dominio

1. En la tarjeta del servicio, ve a **Settings → Networking**.
2. En **Public Networking**, haz clic en **Generate Domain** para obtener una URL `.up.railway.app`, o vincula un dominio personalizado.

## 6. El esquema

**El runtime crea las tablas que faltan durante el arranque, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, el cual es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), de modo que el primer inicio frente a una base de datos vacía se pone en marcha sirviendo tus colecciones.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que un reinicio de contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas aún requieren el CLI, ejecutado desde un checkout o un trabajo de CI:

```bash
rebase db push
```

- **RLS para tablas intermedias (junction tables)** en relaciones many-to-many.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restrictivo, un campo eliminado.

Apunta `DATABASE_URL` a la cadena de conexión **pública** de tu servicio Postgres (widget de Postgres → **Connect**); la URL interna referenciada solo es accesible desde el interior de Railway. La imagen de runtime se distribuye sin el CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Los contenedores de Railway se reemplazan en cada despliegue, por lo que el almacenamiento de archivos local supone una pérdida silenciosa de datos y el runtime lo rechaza en producción. Conecta un bucket compatible con S3 con `STORAGE_TYPE=s3`; consulta [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación de producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.

---
