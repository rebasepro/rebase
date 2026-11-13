---
sourceHash: 663fa0179ad2c716
title: Desplegar Rebase en Scaleway
description: Aprende a desplegar Rebase en Scaleway para contar con una infraestructura en la nube segura con sede en Francia utilizando Serverless Containers.
sidebar_label: Scaleway
---

Scaleway es un proveedor de nube europeo con sede en Francia, con centros de datos en París, Ámsterdam y Varsovia: una excelente opción para las organizaciones que priorizan la soberanía de datos en la UE.

Utiliza **Managed Database** de Scaleway para Postgres y **Serverless Containers** para el runtime.

Nada en esta página es específico de Scaleway con respecto a tu proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en un portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Crear una base de datos Postgres gestionada

1. En la consola de Scaleway, ve a **PostgreSQL**.
2. Haz clic en **Create a Database Instance**.
3. Elige una región (por ejemplo, París — `PAR1`).
4. Selecciona un tipo de nodo (**Play2-Pico** o **Pro2-XXS** funcionan bien).
5. Añade un nombre de base de datos (`rebase_db`) y una contraseña segura para el usuario.
6. Una vez desplegada, anota la **Connection string** (URI) del panel de control:
   `postgres://user:password@ip:port/rebase_db`

Si tus tablas declaran una columna `col.vector()`, habilita la extensión una vez: `CREATE EXTENSION vector;` en la base de datos.

## 2. Compilar el bundle e integrarlo en una imagen

**No hay ninguna imagen de aplicación que compilar desde tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus tablas, funciones y crons compilados y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada se encarga de ejecutarlo:

```bash
rebase build
```

Serverless Containers descarga desde un registro, por lo que debes integrar el bundle en una imagen derivada. Tres líneas bastan para fijar con precisión lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Ve a **Container Registry** en la consola de Scaleway y crea un namespace (por ejemplo, `rebase-apps`).
2. Inicia sesión en el registro desde tu terminal siguiendo las instrucciones que se muestran.
3. Compila y haz push desde la raíz del proyecto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Actualizar Rebase más adelante consiste únicamente en cambiar esa línea `FROM`. Tu bundle se mantiene intacto.

## 3. Desplegar el Serverless Container

1. Navega hasta **Serverless Containers**.
2. Haz clic en **Create a Container**.
3. Elige la imagen que acabas de subir.
4. Configura el puerto en **8080**, el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
5. En Environment Variables, añade:

| Clave | Valor |
|-------|-------|
| `DATABASE_URL` | La URI del paso de Managed Postgres |
| `JWT_SECRET` | Una cadena aleatoria segura de más de 32 caracteres para firmar tokens de autenticación |
| `REBASE_SERVICE_KEY` | Una cadena aleatoria segura de más de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de tu frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de tu frontend (utilizada para enlaces de correo electrónico y como fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, configurada **antes del primer arranque** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las tres últimas son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta que se registra no se promociona automáticamente, por lo que nada más creará al primer usuario autenticado. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin). Marca los secretos como variables de entorno secretas en lugar de variables de texto plano.

6. Apunta el health check a `/livez`. No a `/health`: este último realiza un viaje de ida y vuelta a la base de datos, por lo que una sonda de liveness configurada en él reiniciará un contenedor sano durante una breve interrupción de la base de datos.
7. Haz clic en **Deploy Container**.

Scaleway aprovisionará el contenedor y te proporcionará un endpoint público (p. ej., `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Para un estricto cumplimiento en materia de datos, verifica que los detalles de tu Organización en Scaleway reflejen tu entidad corporativa europea.*

## 4. El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que falten durante el arranque, incluidas las que declara `backend/schema`.** El valor predeterminado de `REBASE_MIGRATE_ON_BOOT` es `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum que falten y aplica su seguridad a nivel de fila (RLS), por lo que el primer inicio frente a una base de datos vacía comenzará sirviendo tus colecciones.

Lo que `ensure` nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, hay algo que aún requiere la CLI, ejecutada desde una copia local o un trabajo de CI con `DATABASE_URL` apuntando a tu Managed Database:

```bash
rebase db push
```

Cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restrictivo, un campo eliminado.

La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Los Serverless Containers no tienen disco persistente, por lo que el almacenamiento local de archivos implicaría una pérdida silenciosa de datos y el runtime lo rechaza en producción. Scaleway Object Storage es compatible con S3 y se encuentra en los mismos centros de datos:

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

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador comunes a todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
