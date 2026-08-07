---
title: Despliegue de Rebase en Hetzner Cloud
description: Aprenda a desplegar Rebase en Hetzner Cloud usando Docker Compose para un rendimiento excelente basado en la UE y soberanía de datos.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud es ampliamente reconocido por ofrecer una increíble relación rendimiento-precio y es una opción principal para proyectos que requieren estricta soberanía de datos europea y cumplimiento del GDPR (con centros de datos en Núremberg, Falkenstein y Helsinki).

Desplegar Rebase en Hetzner es más fácil a través de Docker Compose en una instancia de nube estándar de Ubuntu.

## 1. Aprovisionar un Servidor

1. Inicie sesión en su Consola de Hetzner Cloud.
2. Haga clic en **Añadir Servidor**.
3. Elija su Ubicación preferida (p. ej., **Falkenstein** o **Núremberg**).
4. Elija una Imagen: Seleccione **Ubuntu 24.04** o **App -> Docker CE** (esto preinstala Docker por usted).
5. Elija un Tipo: Un `CPX21` (3 núcleos, 4GB de RAM) o `CX32` (4 núcleos, 8GB de RAM) proporciona una excelente base de cómputo para ejecutar Rebase + Postgres.
6. Añada su clave SSH y pulse **Crear**.

## 2. SSH y Configuración

Una vez aprovisionado su servidor, obtenga la dirección IP pública.

```bash
ssh root@<your-server-ip>
```

Si no eligió la imagen de Docker, instale Docker y Docker Compose explícitamente:

```bash
apt update && apt install docker.io docker-compose-v2 -y
```

## 3. Clonar y Configurar Rebase

Clone su proyecto Rebase directamente en la instancia del servidor.

```bash
git clone https://github.com/your-username/your-rebase-repo.git /opt/rebase
cd /opt/rebase
```

Rebase proporciona un `docker-compose.yml` listo para usar. Necesitará definir sus variables de entorno de producción. Cree un archivo `.env.production`:

```bash
nano .env.production
```

Añada sus secretos:

```env
DATABASE_URL=postgresql://rebase_app:your_secure_db_password@postgres:5432/rebase
JWT_SECRET=generate_a_very_long_secure_random_string_here
NODE_ENV=production
```

*Asegúrese de actualizar `docker-compose.yml` si desea obtener la contraseña de Postgres de una variable de entorno.*

## 4. Ejecutar la Pila

Ponga la pila en línea usando el modo separado:

```bash
docker compose --env-file .env.production up -d --build
```

Docker construirá su backend de Node.js desde el `Dockerfile` local y pondrá en marcha el contenedor de Postgres. Una vez completado, su aplicación estará funcionando en `http://localhost:3001` (interno al servidor).

## 5. Crear el Esquema de la Base de Datos

Al arrancar, Rebase crea automáticamente **solo las tablas de autenticación**. Las tablas de sus propias colecciones **no se crean automáticamente**. Debe aplicar el esquema una vez contra la base de datos de producción:

```bash
pnpm run db:push
```

Si omite este paso, la aplicación arranca con normalidad y el inicio de sesión funciona —esa es la trampa—, pero cada colección devuelve un error de «tabla inexistente» (*missing table*) en su primera consulta.

En Hetzner ya dispone de un checkout del proyecto en el propio servidor (`/opt/rebase`), así que ejecútelo allí directamente con `DATABASE_URL` apuntando a la base de datos de producción; use `localhost:5432` como host, ya que el contenedor de Postgres expone ese puerto. Ejecútelo desde el checkout del proyecto, **no dentro del contenedor de la aplicación**: la imagen de producción se distribuye sin la CLI.

Para migraciones versionadas, use `pnpm run db:generate` + `pnpm run db:migrate` en lugar de `pnpm run db:push`.

## 6. Exponer a través de Caddy o Nginx

Nunca debe exponer el puerto 3001 directamente a internet sin SSL. Recomendamos colocar **Caddy** delante de su instancia de Rebase para aprovisionar automáticamente certificados Let's Encrypt.

Instalar Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Edite su Caddyfile:
```bash
nano /etc/caddy/Caddyfile
```

Añada lo siguiente (reemplace con su dominio, que debería tener su registro A apuntando a esta IP de Hetzner):

```caddyfile
admin.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Reiniciar Caddy:
```bash
systemctl restart caddy
```

¡Eso es todo! Su plataforma Rebase está alojada de forma segura completamente dentro de la UE.
