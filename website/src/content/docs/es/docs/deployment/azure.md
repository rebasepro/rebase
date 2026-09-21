---
sourceHash: c8c26c456236b255
title: Despliegue de Rebase en Microsoft Azure
description: Despliega tu instancia de Rebase de forma segura en Azure usando Azure Database for PostgreSQL y Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure ofrece integraciones estrechas y cumplimiento normativo empresarial. La arquitectura óptima para ejecutar Rebase en Azure utiliza **Azure Database for PostgreSQL – Flexible Server** para la capa de datos y **Azure Container Apps** para el runtime.

Para cumplir con las normativas europeas de datos y obtener tiempos de respuesta locales rápidos, aprovisiona tus recursos en regiones como **West Europe (Ámsterdam)**, **North Europe (Irlanda)** o **France Central (París)**.

Nada en esta página es específico de Azure respecto a tu proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en una portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar PostgreSQL Flexible Server

1. Desde Azure Portal, busca y selecciona **Azure Database for PostgreSQL servers**.
2. Haz clic en **Create** y selecciona **Flexible Server**.
3. Elige tu Resource Group y establece tu región de la UE preferida.
4. Selecciona el tamaño de Compute (por ejemplo, General Purpose, o Burstable `B2s` para despliegues más pequeños).
5. Configura la pestaña **Authentication** con un nombre de usuario administrador y una contraseña segura.
6. En **Networking**, asegúrate de que la opción "Allow public access from any Azure service within Azure to this server" esté marcada para que tu Container App pueda conectarse, o bien configura una VNet segura.
7. Toma nota del nombre de tu servidor y construye la URI de conexión:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez: Azure la restringe tras el parámetro de servidor `azure.extensions`, y luego ejecuta `CREATE EXTENSION vector;`.

## 2. Compilar el bundle e integrarlo en una imagen

No hay **ninguna imagen de aplicación que compilar a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones compiladas, funciones, crons y, si tu proyecto declara una app estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Container Apps descarga desde un registro, así que integra el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

1. Crea un **Container Registry** en la región de la UE que hayas elegido.
2. Inicia sesión desde tu CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Compila y haz push, desde la raíz del proyecto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Actualizar Rebase más adelante consiste solo en cambiar esa línea `FROM`. Tu bundle no se modifica.

## 3. Desplegar la Container App

Azure Container Apps proporciona un entorno de contenedores serverless con ingress HTTPS integrado.

1. Busca **Container Apps** en el portal y haz clic en **Create**.
2. Crea un nuevo Container Apps Environment en tu región de la UE.
3. En la pestaña **Container**, apunta a tu registro ACR y selecciona la imagen `rebase-backend:latest`.
4. Configura las **Variables de entorno**:

| Nombre | Valor |
|------|-------|
| `DATABASE_URL` | Tu cadena de conexión de Azure Postgres |
| `JWT_SECRET` | Una cadena aleatoria segura de más de 32 caracteres |
| `REBASE_SERVICE_KEY` | Una cadena aleatoria segura de más de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Tu dominio de frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de tu frontend (utilizada para enlaces de correo y fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, configurada **antes del primer inicio** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta que se registra no es promovida, por lo que nada más genera el primer usuario autenticado. Consulta [Tu primer admin](/docs/getting-started/deployment/#your-first-admin). Almacena los secretos como secretos de Container Apps y haz referencia a ellos, en lugar de dejarlos como valores de entorno en texto plano.

5. En la pestaña **Ingress**, habilita ingress.
6. Establece el Target Port en **8080** — el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
7. Dirige el health probe a `/livez`. No a `/health`: ese realiza un viaje de ida y vuelta a la base de datos (round-trip), por lo que un liveness probe sobre él reiniciará un contenedor en buen estado ante una pequeña interrupción momentánea de la base de datos.
8. Completa la creación. Azure aprovisionará el contenedor y te proporcionará una URL de aplicación protegida con TLS.

## 4. El esquema

**El runtime crea las tablas faltantes al iniciar, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), por lo que el primer inicio frente a un servidor vacío arranca sirviendo tus colecciones.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas todavía requieren la CLI, ejecutada desde una copia del repositorio o un trabajo de CI con `DATABASE_URL` apuntando a tu Flexible Server (añade una regla de firewall que permita tu IP de cliente si es necesario):

```bash
rebase db push
```

- **RLS en tablas intermedias (junction tables)** para relaciones many-to-many.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restringido o un campo eliminado.

La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Las réplicas de Container Apps no tienen disco duradero, por lo que el almacenamiento local de archivos implica una pérdida silenciosa de datos y el runtime lo rechaza en producción. Crea una cuenta de Azure Storage y utiliza su interfaz compatible con S3, o un bucket compatible con S3 en la misma región, con `STORAGE_TYPE=s3` — consulta [Storage](/docs/backend/storage).

## Próximos pasos

- [Deployment](/docs/getting-started/deployment) — la lista de verificación de producción y las reglas del primer admin comunes a todas las plataformas.
- [Configuration](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
