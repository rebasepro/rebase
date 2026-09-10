---
sourceHash: b2acba62de849f55
title: Desplegar Rebase en Microsoft Azure
description: Despliega tu instancia de Rebase de forma segura en Azure utilizando Azure Database for PostgreSQL y Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure ofrece integraciones estrechas y cumplimiento normativo empresarial. La arquitectura óptima para ejecutar Rebase en Azure utiliza **Azure Database for PostgreSQL – Flexible Server** para la capa de datos y **Azure Container Apps** para el entorno de ejecución (runtime).

Para cumplir con la normativa europea de protección de datos y obtener tiempos de respuesta locales rápidos, aprovisiona tus recursos en regiones como **West Europe (Ámsterdam)**, **North Europe (Irlanda)** o **France Central (París)**.

Nada en esta página sobre tu proyecto es específico de Azure. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en un portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar PostgreSQL Flexible Server

1. Desde Azure Portal, busca y selecciona **Azure Database for PostgreSQL servers**.
2. Haz clic en **Create** y selecciona **Flexible Server**.
3. Elige tu Grupo de recursos y establece tu región de la UE preferida.
4. Selecciona el tamaño de Compute (por ejemplo, General Purpose, o Burstable `B2s` para despliegues más pequeños).
5. Configura la pestaña **Authentication** con un nombre de usuario administrador y una contraseña segura.
6. En **Networking**, asegúrate de marcar "Allow public access from any Azure service within Azure to this server" para que tu Container App pueda conectarse, o configura una VNet segura.
7. Anota el nombre de tu servidor y construye el URI de conexión:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez: Azure la restringe tras el parámetro del servidor `azure.extensions`, luego ejecuta `CREATE EXTENSION vector;`.

## 2. Compilar el bundle e integrarlo en una imagen

No hay **ninguna imagen de aplicación que compilar desde tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones compiladas, funciones, crons y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Container Apps descarga desde un registro, por lo que debes integrar el bundle en una imagen derivada. Tres líneas, y fija con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Actualizar Rebase más adelante consiste en cambiar esa línea `FROM`. Tu bundle no se modifica.

## 3. Desplegar la Container App

Azure Container Apps proporciona un entorno de contenedores serverless con ingress HTTPS integrado.

1. Busca en el portal **Container Apps** y haz clic en **Create**.
2. Crea un nuevo entorno de Container Apps en tu región de la UE.
3. En la pestaña **Container**, apunta a tu registro ACR y selecciona la imagen `rebase-backend:latest`.
4. Define las **Variables de entorno**:

| Nombre | Valor |
|--------|-------|
| `DATABASE_URL` | Tu cadena de conexión de Azure Postgres |
| `JWT_SECRET` | Una cadena aleatoria y segura de más de 32 caracteres |
| `REBASE_SERVICE_KEY` | Una cadena aleatoria y segura de más de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de tu frontend (ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de tu frontend (usada para enlaces en correos y fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, establecida **antes del primer inicio** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las tres últimas son la forma en que este despliegue obtiene un administrador en absoluto: en producción, la primera cuenta que se registra no es promovida, por lo que ninguna otra cosa produce el primer usuario autenticado. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin). Guarda los secretos como secretos de Container Apps y referéncialos, en lugar de utilizarlos como valores de entorno en texto plano.

5. En la pestaña **Ingress**, habilita el ingress.
6. Establece el Target Port en **8080**, el puerto en el que la imagen de runtime escucha a menos que `PORT` indique lo contrario.
7. Apunta la sonda de salud (health probe) a `/livez`. No a `/health`: esta última realiza un viaje de ida y vuelta a la base de datos, por lo que una sonda de liveness sobre ella reiniciaría un contenedor en buen estado ante un hipo momentáneo de la base de datos.
8. Completa la creación. Azure aprovisiona el contenedor y te proporciona una URL de aplicación protegida con TLS.

## 4. El esquema

**El runtime crea las tablas faltantes al iniciar, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, que es aditivo en todo el esquema: crea tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), de modo que el primer arranque contra un servidor vacío comienza sirviendo tus colecciones.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas todavía requieren la CLI, ejecutada desde una copia local o un trabajo de CI con `DATABASE_URL` apuntando a tu Flexible Server (añade una regla de firewall que permita la IP de tu cliente si es necesario):

```bash
rebase db push
```

- **RLS de tablas intermedias (junction tables)** para relaciones muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restrictivo, un campo eliminado.

La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, confirma los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Las réplicas de Container Apps no tienen disco persistente, por lo que el almacenamiento local de archivos implica una pérdida silenciosa de datos y el runtime lo rechaza en producción. Crea una cuenta de Azure Storage y utiliza su interfaz compatible con S3, o un bucket compatible con S3 en la misma región, con `STORAGE_TYPE=s3` — consulta [Almacenamiento](/docs/backend/storage).

## Siguientes pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador que todas las plataformas comparten.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.

---
