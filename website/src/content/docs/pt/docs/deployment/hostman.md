---
sourceHash: 5f650040f2d3d2f9
title: Deploy do Rebase no Hostman
description: Faça o deploy de um projeto rebase init no Hostman — App Platform com PostgreSQL Gerenciado e armazenamento S3, ou um servidor em nuvem com o próprio arquivo Compose do seu projeto.
sidebar_label: Hostman
---

O [Hostman](https://hostman.com) oferece dois modelos adequados para um backend Rebase, com data centers na Europa e nos EUA:

- **App Platform com PostgreSQL Gerenciado.** O Hostman compila e executa seu aplicativo a partir de um repositório GitHub e gerencia o banco de dados. Seus contêineres iniciam do zero a cada deploy, portanto, **o upload de arquivos precisa de um bucket compatível com S3 desde o primeiro dia**.
- **Um servidor em nuvem.** O Postgres e o runtime em uma VPS, sob o `docker-compose.yml` que seu projeto já possui. **Os uploads podem permanecer no disco do servidor.**

Nada nesta página sobre seu projeto é específico do Hostman. Uma implantação do Rebase consiste em duas partes separadas — a imagem do runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda em um laptop, no Rebase Cloud e aqui.

## App Platform

### 1. Criar o banco de dados

No painel do Hostman, crie um cluster **Managed PostgreSQL**:

- **Versão:** 16 ou mais recente.
- **Região:** a mesma em que você executará o aplicativo.
- **Rede:** uma rede privada. Coloque o aplicativo na mesma rede no passo 4. A rede de um aplicativo é escolhida quando ele é criado e não pode ser alterada posteriormente.

O cluster vem com um usuário, `gen_user`, e um banco de dados, `default_db`. Na aba **Connection**, copie a string de conexão para o **IP privado**. Ela é a sua `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Se o cluster exigir TLS, adicione `?sslmode=require` ao final.

#### Criar a role para a qual o Rebase alterna

O Rebase aplica a segurança em nível de linha (row-level security) alternando cada requisição autenticada para uma role restrita, `rebase_user`. O `gen_user` precisa ter permissão para criar essa role e alternar para ela.

1. Na aba **Users** do cluster, conceda ao `gen_user` o privilégio **CREATE ROLE**. A menor configuração do Hostman (1 CPU, 1 GB de RAM, 20 GB) não permite adicionar usuários ou bancos de dados. Se ela não permitir conceder o privilégio, escolha a configuração seguinte.
2. Conecte-se uma vez como `gen_user` com o `psql`, antes do primeiro deploy, e execute:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   O banco de dados está em uma rede privada, portanto, execute isso a partir de um servidor em nuvem na mesma rede ou ative o acesso público temporariamente.

O segundo comando é o que realmente importa. No PostgreSQL 16 e versões mais recentes, um usuário que cria uma role sem ser superusuário torna-se membro dela, mas não alguém que pode alternar para ela. Se o runtime criar a role por si mesmo, a inicialização é bem-sucedida e cada requisição autenticada falha subsequentemente com `DB_PERMISSION_DENIED`. Se isso já tiver acontecido, execute a linha `GRANT` e reinicie o aplicativo.

Se suas tabelas declararem uma coluna `col.vector()`, habilite a extensão **pgvector** em **Configuration → Extensions**. A estrutura inicial (scaffold) não declara nenhuma.

### 2. Criar um bucket

Crie um bucket compatível com S3 — o armazenamento S3 do próprio Hostman ou qualquer outro provedor. Nas configurações do bucket, anote o endpoint, a região, a access key e a secret key. Mantenha o bucket **privado**: o Rebase assina cada download, e a função `storageAuthorize` em `backend/storage.ts` decide quem pode ler, gravar e listar.

### 3. Adicionar um Dockerfile

A App Platform compila a partir do seu repositório, e `dist-bundle/` está no gitignore, de modo que a imagem compila o bundle por si mesma e depois o transfere para o runtime publicado. Faça o commit disso na raiz do projeto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.30.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Três detalhes são importantes aqui:

- **`node:22`, e não `node:22-slim`.** A instalação da CLI baixa o mecanismo de schema do Atlas, que precisa de `curl` e certificados CA. A imagem slim não possui nenhum dos dois, e a instalação falha.
- **`--chown=node:node`.** O runtime executa como `node` e vincula seus próprios pacotes ao bundle na inicialização. Um bundle pertencente ao root ainda funciona, mas registra um aviso para cada pacote que não conseguiu vincular.
- **Nenhum código-fonte na imagem final.** Ela contém apenas o runtime e seu bundle compilado. Atualizar o Rebase no futuro consiste em alterar a segunda linha `FROM`.

A imagem do runtime escuta na porta 8080 e a declara com `EXPOSE`, que é a porta para a qual a App Platform roteia o tráfego.

### 4. Criar o aplicativo

Na **App Platform**, crie um aplicativo **Backend**:

1. Conecte o repositório e a branch do GitHub.
2. Defina o **Framework** como **Dockerfile**.
3. Escolha a mesma região do banco de dados e a **rede privada** do banco de dados.
4. Escolha uma configuração com **2 GB de RAM**. O bundle é compilado como parte da imagem e o pico de consumo da compilação fica em torno de 1 GB; portanto, uma configuração de 1 GB pode ficar sem memória.
5. Defina o **caminho do health check** como `/livez`. O padrão, `/`, também funciona, mas `/livez` responde sem tocar no banco de dados, evitando que uma breve instabilidade no banco de dados reinicie um aplicativo saudável.

Em **Advanced settings**, adicione as variáveis de ambiente:

```env
NODE_ENV=production
DATABASE_URL=postgresql://gen_user:<password>@<private-ip>:5432/default_db
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app-domain>
FRONTEND_URL=https://<your-app-domain>
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ENDPOINT=<endpoint>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=true
```

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` definem o primeiro administrador. Em produção, a primeira conta registrada não é promovida automaticamente, portanto, nenhuma outra ação cria um administrador. O runtime cria a conta apenas uma vez, enquanto a tabela de usuários estiver vazia. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

O endereço do aplicativo não é conhecido até que ele seja criado. Crie o aplicativo, copie o domínio técnico na aba **Dashboard** e configure `CORS_ORIGINS` e `FRONTEND_URL` com esse valor. Salvar as configurações fará um novo deploy do aplicativo.

### 5. Acesse o aplicativo

Abra o domínio do aplicativo. Um único contêiner serve o painel administrativo em `/` e a API em `/api`. Faça login com `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` e, em seguida, altere a senha.

Cada push para a branch aciona um novo deploy. Para adicionar seu próprio domínio, acesse **Settings → Domains**. O Hostman emite o certificado. Adicione a nova origem a `CORS_ORIGINS` e `FRONTEND_URL`.

## Um servidor em nuvem

Um servidor em nuvem do Hostman executa a mesma stack de qualquer VPS: Postgres e o runtime sob o próprio `docker-compose.yml` do seu projeto, com o Caddy à frente para HTTPS. Um servidor com 2 vCPUs e 2 GB de RAM é suficiente para começar.

Crie-o com **Ubuntu 24.04** e sua chave SSH e, em seguida, siga os [passos de um servidor único na página da Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Nada neles depende da Hetzner.

Em um servidor, os uploads permanecem em seu disco: o arquivo Compose os mantém em um volume nomeado e define `FORCE_LOCAL_STORAGE=true`. Eles sobrevivem a reinicializações e novos deploys, mas não à perda do servidor, portanto, ative os backups de servidor do Hostman ou mova-os para um bucket quando se tornarem críticos.

## O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria as tabelas ausentes na inicialização, incluindo as que `backend/schema` declara.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema. Ele cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de row-level security, de modo que uma nova coleção já fica ativa no próximo deploy.

O modo `ensure` nunca altera nada que já exista. Ele não altera o tipo de uma coluna, não descarta nada e não edita os rótulos de um enum existente, pois um deploy não deve remodelar um schema como efeito colateral.

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido, um campo removido — precisa do `rebase db push`, executado a partir do código clonado:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Leia o SQL exibido pelo dry run e execute o comando novamente sem `--dry-run`. Duas coisas devem ser providenciadas no Managed PostgreSQL antes disso:

- **Acessibilidade.** Um banco de dados em uma rede privada não pode ser acessado pelo seu laptop. Habilite o acesso público temporariamente ou execute o comando a partir de um servidor na mesma rede.
- **O banco de dados temporário (scratch database).** O `db push` planeja cada alteração em uma cópia descartável do schema, em um banco de dados com o mesmo nome do seu acrescido de `_dev_diff` no final. Conceda ao `gen_user` o privilégio **CREATEDB** ou crie `default_db_dev_diff` uma vez pelo painel. Nenhuma das opções é possível na menor configuração.

Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
- [Armazenamento](/docs/backend/storage) — buckets, regras de acesso e várias fontes de armazenamento simultâneas.
