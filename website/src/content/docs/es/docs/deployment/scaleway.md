---
sourceHash: c543c4d920d4a2f9
title: Despliegue de Rebase en Scaleway
description: Aprende a desplegar Rebase en Scaleway para obtener una infraestructura en la nube segura y basada en Francia mediante Serverless Containers.
sidebar_label: Scaleway
---

Scaleway es un proveedor de nube europeo con sede en Francia, con centros de datos en París, Ámsterdam y Varsovia, una excelente opción para organizaciones que priorizan la soberanía de datos en la UE.

Utiliza **Managed Database** de Scaleway para Postgres y **Serverless Containers** para el runtime.

Nada en esta página es específico de Scaleway respecto a tu proyecto. Un despliegue de Rebase consta de dos piezas separables: la imagen de runtime publicada y el **bundle** que produce `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en una laptop, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Crear una base de datos Managed Postgres

1. En la consola de Scaleway, ve a **PostgreSQL**.
2. Haz clic en **Create a Database Instance**.
3. Elige una región (por ejemplo, París — `PAR1`).
4. Selecciona un tipo de nodo (**Play2-Pico** o **Pro2-XXS** funcionan bien).
5. Añade un nombre de base de datos (`rebase_db`) y una contraseña de usuario segura.
6. Una vez desplegada, anota la **Connection string** (URI) del panel:
   `postgres://user:password@ip:port/rebase_db`

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez: `CREATE EXTENSION vector;` contra la base de datos.

## 2. Compilar el bundle e integrarlo en una imagen

No hay **ninguna imagen de aplicación para compilar desde tu código fuente**. `rebase build` produce un directorio `dist-bundle` con tus colecciones compiladas, funciones, crons y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Serverless Containers descarga desde un registro, así que integra el bundle en una imagen derivada. Tres líneas, y fija con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

1. Ve a **Container Registry** en la consola de Scaleway y crea un namespace (por ejemplo, `rebase-apps`).
2. Inicia sesión en el registro desde tu terminal siguiendo las instrucciones que se muestran.
3. Compila y haz push, desde la raíz del proyecto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Actualizar Rebase más adelante es solo cambiar esa línea `FROM`. Tu bundle no se toca.

## 3. Desplegar el Serverless Container

1. Navega a **Serverless Containers**.
2. Haz clic en **Create a Container**.
3. Elige la imagen que acabas de subir.
4. Configura el puerto en **8080**, el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
5. En Variables de Entorno, añade:

| Clave | Valor |
|-----|-------|
| `DATABASE_URL` | La URI de tu paso de Managed Postgres |
| `JWT_SECRET` | Una cadena aleatoria segura de más de 32 caracteres para firmar tokens de autenticación |
| `REBASE_SERVICE_KEY` | Una cadena aleatoria segura de más de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de tu frontend (por ejemplo, `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de tu frontend (utilizada para enlaces de correo electrónico y respaldo de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, establecida **antes del primer arranque** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta que se registra no es promovida, por lo que nada más generará el primer usuario autenticado. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin). Marca los secretos como variables de entorno secretas en lugar de normales.

6. Apunta el health check a `/livez`. No a `/health`: este último realiza un viaje de ida y vuelta a la base de datos, por lo que una prueba de actividad (liveness probe) sobre él reiniciará un contenedor en buen estado durante un breve fallo temporal de la base de datos.
7. Haz clic en **Deploy Container**.

Scaleway aprovisiona el contenedor y te proporciona un endpoint público (por ejemplo, `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Para un cumplimiento estricto de los datos, verifica que los datos de tu organización en Scaleway reflejen tu entidad corporativa europea.*

## 4. El esquema

**El runtime crea las tablas faltantes al arrancar, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), de modo que el primer inicio contra una base de datos vacía se pone en marcha sirviendo tus colecciones.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas aún requieren el CLI, ejecutado desde un checkout o un trabajo de CI con `DATABASE_URL` apuntando a tu Managed Database:

```bash
rebase db push
```

- **RLS en tablas de unión (junction tables)** para relaciones de muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restrictivo, un campo eliminado.

La imagen de runtime se distribuye sin el CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Los Serverless Containers no tienen disco duradero, por lo que el almacenamiento local de archivos supone una pérdida silenciosa de datos y el runtime lo rechaza en producción. Scaleway Object Storage es compatible con S3 y se encuentra en los mismos centros de datos:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulta [Almacenamiento](/docs/backend/storage) para obtener una visión completa.

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.

---
