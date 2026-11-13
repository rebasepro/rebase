---
sourceHash: d9b167443cc3fd35
title: Desplegar Rebase en AWS
description: Despliegue su instancia de Rebase de forma segura en Amazon Web Services utilizando RDS y AWS App Runner con un fuerte enfoque europeo.
sidebar_label: AWS
---

Amazon Web Services (AWS) proporciona una escala increíble y seguridad de nivel empresarial. Para un despliegue de Rebase en producción, recomendamos desacoplar la arquitectura utilizando **Amazon RDS** para la base de datos PostgreSQL y **AWS App Runner** (o ECS Fargate) para servir el runtime.

Para mantener un cumplimiento estricto de los datos europeos, asegúrese de operar completamente dentro de una región de la UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Ireland)** o **eu-west-3 (Paris)**.

Nada en esta página es específico de AWS con respecto a su proyecto. Un despliegue de Rebase consta de dos piezas separables: la imagen de runtime publicada y el **bundle** que produce `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en una laptop, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí. Moverse entre ellos es un cambio de infraestructura, no de la aplicación.

## 1. Aprovisionar Amazon RDS (PostgreSQL)

1. Vaya a la consola de **RDS** en su región de la UE seleccionada.
2. Haga clic en **Create database** y seleccione **Standard create**.
3. Elija el motor **PostgreSQL**.
4. En Templates, elija **Production** o **Free tier/Dev** según su carga.
5. Cree un Master Username (por ejemplo, `rebase_admin`) y genere de forma segura una Master Password.
6. En Connectivity, asegúrese de que la base de datos esté ubicada dentro de una **VPC** a la que su futura instancia de App Runner pueda acceder de forma segura (o hágala públicamente accesible si controla estrictamente los rangos de IP de entrada).
7. Una vez aprovisionada, anote la **Endpoint address** y arme su URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Si sus tablas declaran una columna `col.vector()`, la instancia necesita la extensión `pgvector` — RDS la incluye, pero debe habilitarse: `CREATE EXTENSION vector;` contra la base de datos, una sola vez.

## 2. Construir el bundle e integrarlo en una imagen

**No hay ninguna imagen de aplicación que construir a partir de su código fuente**. `rebase build` produce un directorio `dist-bundle` con sus tablas, funciones, tareas cron compiladas y, si su proyecto declara una aplicación estática, su frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Para App Runner, que extrae imágenes desde un registro, integre el bundle en una imagen derivada. Son solo tres líneas y fija con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Vaya a **Elastic Container Registry** y cree un repositorio privado llamado `rebase-backend`.
2. Copie los comandos de push que AWS muestra en la consola; estos se encargan de la autenticación de Docker.
3. Construya y haga push, desde la raíz del proyecto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Etiquétela y súbala (push) a su repositorio de ECR.

Actualizar Rebase más adelante es simplemente cambiar esa línea `FROM`. Su bundle no se modifica y no se recompila nada de su proyecto.

## 3. Desplegar mediante AWS App Runner

App Runner es la forma más sencilla de ejecutar contenedores en AWS sin gestionar orquestadores.

1. Vaya a **AWS App Runner** y haga clic en **Create service**.
2. Seleccione **Container registry** y elija **Amazon ECR**.
3. Explore y seleccione su imagen `rebase-backend`.
4. En **Service settings**, configure el Port en **8080**, el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
5. Configure la ruta del **health check** en `/livez`. No use `/health`: esa realiza un viaje de ida y vuelta a la base de datos, por lo que una comprobación de actividad (liveness probe) sobre ella reiniciaría un servicio perfectamente sano durante un breve fallo temporal de la base de datos.
6. Añada las variables de entorno:

| Clave | Valor |
|-------|-------|
| `DATABASE_URL` | Su cadena de conexión de RDS |
| `JWT_SECRET` | Una cadena segura generada aleatoriamente (más de 32 caracteres) |
| `REBASE_SERVICE_KEY` | Una cadena segura generada aleatoriamente (más de 32 caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de su frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de su frontend (utilizada para enlaces de correo electrónico y fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, configurada **antes del primer arranque** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta en registrarse no es promovida, por lo que nada más generaría el primer usuario autenticado. Consulte [Su primer administrador](/docs/getting-started/deployment/#your-first-admin). Guarde los secretos en AWS Secrets Manager y haga referencia a ellos en lugar de escribirlos directamente en el formulario de la consola.

7. (Opcional) Si su instancia de RDS es estrictamente privada, configure la red **Custom VPC** en App Runner para que el contenedor pueda comunicarse con la base de datos.
8. Haga clic en **Create & deploy**.

AWS gestiona la terminación TLS, proporcionándole una URL `https` lista para usar.

## 4. El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que faltan durante el arranque, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, el cual es aditivo en todo el esquema: crea las tablas, columnas y tipos enum que falten y aplica su seguridad a nivel de fila, de modo que el primer inicio frente a una instancia de RDS vacía comienza sirviendo sus tablas.

Lo que `ensure` nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, hay algo que todavía requiere la CLI, ejecutada desde una copia de trabajo local o un trabajo de CI con `DATABASE_URL` apuntando a RDS:

```bash
rebase db push
```

Cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo restringido, un campo eliminado.

Si la instancia es privada, ejecútelo desde CI o un host bastión dentro de la misma VPC. La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor de App Runner. Para migraciones versionadas, confirme los archivos de migración con `rebase db generate` y ejecute `rebase db migrate` como un paso de lanzamiento en su lugar.

## Almacenamiento de archivos

Las instancias de App Runner no tienen disco duradero, por lo que el almacenamiento de archivos local supone una pérdida silenciosa de datos y el runtime lo rechaza en producción. Cree un bucket de S3 en la misma región y configure `STORAGE_TYPE=s3` con su bucket y credenciales; consulte [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación de producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.
