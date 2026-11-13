---
sourceHash: 0664758f56d33104
title: Despliegue de Rebase en Scaleway
description: Aprenda cómo desplegar Rebase en Scaleway para obtener una infraestructura en la nube segura con sede en Francia utilizando Serverless Containers.
sidebar_label: Scaleway
---

Scaleway es un proveedor de nube europeo con sede en Francia, con centros de datos en París, Ámsterdam y Varsovia; una excelente opción para organizaciones que priorizan la soberanía de los datos en la UE.

Utilice **Managed Database** de Scaleway para Postgres y **Serverless Containers** para el runtime.

Nada en esta página es específico de Scaleway con respecto a su proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que produce `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en una computadora portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Crear una base de datos Postgres gestionada

1. En la consola de Scaleway, vaya a **PostgreSQL**.
2. Haga clic en **Create a Database Instance**.
3. Elija una región (p. ej., París — `PAR1`).
4. Seleccione un tipo de nodo (**Play2-Pico** o **Pro2-XXS** funcionan bien).
5. Agregue un nombre de base de datos (`rebase_db`) y una contraseña de usuario segura.
6. Una vez desplegada, anote la **Cadena de conexión** (URI) del panel de control:
   `postgres://user:password@ip:port/rebase_db`

Si sus tablas declaran una columna `col.vector()`, habilite la extensión una vez: `CREATE EXTENSION vector;` en la base de datos.

## 2. Compilar el bundle e integrarlo en una imagen

**No hay ninguna imagen de aplicación que compilar desde su código fuente**. `rebase build` genera un directorio `dist-bundle` con sus tablas, funciones, tareas cron compiladas y, si su proyecto declara una aplicación estática, su frontend compilado. La imagen de runtime publicada se encarga de ejecutarlo:

```bash
rebase build
```

Serverless Containers extrae imágenes de un registro, así que integre el bundle en una imagen derivada. Tres líneas, y fija con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Vaya a **Container Registry** en la consola de Scaleway y cree un namespace (p. ej., `rebase-apps`).
2. Inicie sesión en el registro desde su terminal siguiendo las instrucciones que se muestran.
3. Compile y suba (push), desde la raíz del proyecto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Actualizar Rebase más adelante es solo cambiar esa línea `FROM`. Su bundle no se modifica.

## 3. Desplegar el Serverless Container

1. Navegue a **Serverless Containers**.
2. Haga clic en **Create a Container**.
3. Elija la imagen que acaba de subir.
4. Establezca el puerto en **8080**, el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
5. En Environment Variables, agregue:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | El URI de su paso de Managed Postgres |
| `JWT_SECRET` | Una cadena aleatoria segura de más de 32 caracteres para firmar tokens de autenticación |
| `REBASE_SERVICE_KEY` | Una cadena aleatoria segura de más de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de su frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de su frontend (utilizada para enlaces de correo electrónico y respaldo de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, establecida **antes del primer arranque** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta en registrarse no es promovida, por lo que nada más genera el primer usuario autenticado. Consulte [Su primer administrador](/docs/getting-started/deployment/#your-first-admin). Marque los secretos como variables de entorno secretas en lugar de texto plano.

6. Apunte el health check a `/livez`. No a `/health`: ese realiza un viaje de ida y vuelta a la base de datos, por lo que una prueba de liveness sobre él reiniciaría un contenedor en buen estado durante una breve interrupción de la base de datos.
7. Haga clic en **Deploy Container**.

Scaleway aprovisiona el contenedor y le proporciona un endpoint público (p. ej., `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Para un cumplimiento estricto de los datos, verifique que los detalles de su Organización en Scaleway reflejen su entidad corporativa europea.*

## 4. El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que faltan al arrancar, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` está configurado por defecto en `ensure`, lo cual es aditivo en todo el esquema: crea las tablas, columnas y tipos enum que falten y aplica su seguridad a nivel de fila (row-level security), de modo que el primer inicio frente a una base de datos vacía arranca sirviendo sus tablas.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, una cosa todavía requiere la CLI, ejecutada desde una copia local del código o un trabajo de CI con `DATABASE_URL` apuntando a su Managed Database:

```bash
rebase db push
```

Cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo restringido, un campo eliminado.

La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, confirme los archivos de migración con `rebase db generate` y ejecute `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Los Serverless Containers no tienen disco persistente, por lo que el almacenamiento local de archivos implica una pérdida silenciosa de datos y el runtime lo rechaza en producción. Scaleway Object Storage es compatible con S3 y se encuentra en los mismos centros de datos:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulte [Almacenamiento](/docs/backend/storage) para obtener una visión completa.

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment): la lista de verificación para producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration): todas las variables de entorno que lee el runtime.
