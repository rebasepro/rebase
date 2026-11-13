---
sourceHash: 93b3163dd1b482fd
title: Desplegar Rebase en AWS
description: Despliegue su instancia de Rebase de forma segura en Amazon Web Services utilizando RDS y AWS App Runner con un fuerte enfoque europeo.
sidebar_label: AWS
---

Amazon Web Services (AWS) proporciona una escala increíble y seguridad de nivel empresarial. Para un despliegue de Rebase en producción, recomendamos desacoplar la arquitectura utilizando **Amazon RDS** para la base de datos PostgreSQL y **AWS App Runner** (o ECS Fargate) para servir el runtime.

Para mantener un estricto cumplimiento de los datos a nivel europeo, asegúrese de operar completamente dentro de una región de la UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Ireland)** o **eu-west-3 (Paris)**.

Nada en esta página es específico de AWS en lo que respecta a su proyecto. Un despliegue de Rebase consta de dos piezas separables: la imagen de runtime publicada y el **bundle** que produce `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en un portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí. Moverse entre ellos es un cambio de infraestructura, no de la aplicación.

## 1. Aprovisionar Amazon RDS (PostgreSQL)

1. Navegue a la consola de **RDS** en la región de la UE seleccionada.
2. Haga clic en **Create database** y seleccione **Standard create**.
3. Elija el motor **PostgreSQL**.
4. En Templates, elija **Production** o **Free tier/Dev** según su carga de trabajo.
5. Cree un Master Username (p. ej., `rebase_admin`) y genere de forma segura una Master Password.
6. En Connectivity, asegúrese de que la base de datos esté ubicada dentro de una **VPC** a la que su futura instancia de App Runner pueda acceder de forma segura (o hágala públicamente accesible si controla estrictamente los rangos de IP de entrada).
7. Una vez aprovisionada, anote la **Endpoint address** y cree su URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Si sus tablas declaran una columna `col.vector()`, la instancia necesita la extensión `pgvector` (RDS la incluye, pero debe habilitarse ejecutando `CREATE EXTENSION vector;` en la base de datos una vez).

## 2. Construir el bundle e incorporarlo en una imagen

No hay **ninguna imagen de aplicación que construir a partir de su código fuente**. `rebase build` produce un directorio `dist-bundle` con sus tablas, funciones, tareas cron compiladas y, si su proyecto declara una aplicación estática, su frontend compilado. La imagen de runtime publicada se encarga de ejecutarlo:

```bash
rebase build
```

Para App Runner, que descarga imágenes desde un registro, incorpore el bundle en una imagen derivada. Esto solo requiere tres líneas y fija con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Navegue a **Elastic Container Registry** y cree un repositorio privado llamado `rebase-backend`.
2. Tome los comandos de push que AWS muestra en la consola; estos se encargan de la autenticación de Docker.
3. Construya y envíe la imagen desde la raíz del proyecto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Etiquétela y envíela a su repositorio de ECR.

Actualizar Rebase más adelante es tan simple como cambiar esa línea `FROM`. Su bundle no se modifica y no es necesario reconstruir nada de su proyecto.

## 3. Desplegar mediante AWS App Runner

App Runner es la forma más sencilla de ejecutar contenedores en AWS sin gestionar orquestadores.

1. Navegue a **AWS App Runner** y haga clic en **Create service**.
2. Seleccione **Container registry** y elija **Amazon ECR**.
3. Explore y seleccione su imagen `rebase-backend`.
4. En **Service settings**, configure el puerto en **8080**, que es el puerto en el que escucha la imagen de runtime a menos que `PORT` especifique lo contrario.
5. Configure la ruta del **health check** a `/livez`. No utilice `/health`: esta realiza un recorrido de ida y vuelta a la base de datos, por lo que una sonda de actividad (liveness probe) en ella reiniciaría un servicio en perfecto estado ante cualquier fallo momentáneo de la base de datos.
6. Añada las variables de entorno:

| Clave | Valor |
|-----|-------|
| `DATABASE_URL` | Su cadena de conexión de RDS |
| `JWT_SECRET` | Una cadena segura generada aleatoriamente (más de 32 caracteres) |
| `REBASE_SERVICE_KEY` | Una cadena segura generada aleatoriamente (más de 32 caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de su frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de su frontend (utilizada para enlaces de correo electrónico y fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, establecida **antes del primer arranque** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta en registrarse no se promociona, por lo que nada más genera el primer usuario autenticado. Consulte [Su primer administrador](/docs/getting-started/deployment/#your-first-admin). Guarde los secretos en AWS Secrets Manager y referéncielos en lugar de escribirlos directamente en el formulario de la consola.

7. (Opcional) Si su instancia de RDS es estrictamente privada, configure la red **Custom VPC** en App Runner para que el contenedor pueda conectarse a la base de datos.
8. Haga clic en **Create & deploy**.

AWS gestiona la terminación TLS, proporcionándole una URL `https` lista para usar.

## 4. El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que falten durante el arranque, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila, por lo que el primer inicio frente a una instancia de RDS vacía comenzará sirviendo sus colecciones.

Lo que `ensure` nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe alterar la estructura de un esquema como efecto secundario de un despliegue.

Por lo tanto, hay algo que aún requiere la CLI, ejecutada desde una copia local del código o un trabajo de CI con `DATABASE_URL` apuntando a RDS:

```bash
rebase db push
```

Cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo restringido o un campo eliminado.

Si la instancia es privada, ejecútelo desde CI o un host bastión dentro de la misma VPC. La imagen del runtime viene sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor de App Runner. Para migraciones versionadas, confirme los archivos de migración con `rebase db generate` y ejecute `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Las instancias de App Runner no tienen disco persistente, por lo que el almacenamiento local de archivos provocaría una pérdida silenciosa de datos y el runtime lo rechaza en producción. Cree un bucket de S3 en la misma región y configure `STORAGE_TYPE=s3` con su bucket y credenciales; consulte [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador compartidas por todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
