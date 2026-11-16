---
sourceHash: 45c57a6b4b3a588f
title: Deploy do Rebase na Hostman
description: Faça o deploy de um projeto rebase init na Hostman — App Platform com PostgreSQL Gerenciado e armazenamento S3, ou um servidor em nuvem com o arquivo Compose do seu próprio projeto.
sidebar_label: Hostman
---

A [Hostman](https://hostman.com) oferece dois formatos adequados para um backend Rebase, com data centers na Europa e nos EUA:

- **App Platform com PostgreSQL Gerenciado.** A Hostman compila e executa sua aplicação a partir de um repositório GitHub e gerencia o banco de dados. Seus contêineres iniciam limpos a cada deploy, portanto, **os uploads de arquivos precisam de um bucket compatível com S3 desde o primeiro dia**.
- **Um servidor em nuvem.** Postgres e o runtime em uma VPS, sob o `docker-compose.yml` que seu projeto já possui. **Os uploads podem permanecer no disco do servidor.**

Nada nesta página sobre o seu projeto é específico da Hostman. Uma implantação do Rebase consiste em duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda em um laptop, no Rebase Cloud e aqui.

## App Platform

### 1. Crie o banco de dados

No painel da Hostman, crie um cluster de **Managed PostgreSQL**:

- **Versão:** 16 ou mais recente.
- **Região:** a mesma em que você executará a aplicação.
- **Rede:** uma rede privada. Coloque a aplicação na mesma rede no passo 4. A rede de uma aplicação é escolhida quando ela é criada e não pode ser alterada posteriormente.

O cluster vem com um usuário, `gen_user`, e um banco de dados, `default_db`. Na aba **Connection**, copie a string de conexão para o **IP privado**. Ela é a sua `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Se o cluster exigir TLS, adicione `?sslmode=no-verify` ao final: criptografado, sem verificar o certificado em relação a uma autoridade pública. Um `sslmode=require` simples é interpretado como "verifique-o" pelo driver Node no qual o Rebase é executado, e falha com um certificado que uma autoridade pública não assinou. Consulte [Configuração](/docs/getting-started/configuration/#required).

#### Crie a role para a qual o Rebase alterna

O Rebase impõe segurança em nível de linha (row-level security) alternando cada requisição autenticada para uma role restrita, `rebase_user`. O `gen_user` precisa ter permissão para criar essa role e alternar para ela.

1. Na aba **Users** do cluster, conceda ao `gen_user` o privilégio **CREATE ROLE**. A menor configuração da Hostman (1 CPU, 1 GB de RAM, 20 GB) não permite adicionar usuários ou bancos de dados. Se ela não permitir que você conceda o privilégio, escolha a configuração seguinte.
2. Conecte-se uma vez como `gen_user` com o `psql`, antes do primeiro deploy, e execute:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   O banco de dados está em uma rede privada, portanto, execute isso a partir de um servidor em nuvem na mesma rede ou ative o acesso público durante a execução.

A segunda instrução é a que realmente importa. No PostgreSQL 16 e mais recentes, um usuário que cria uma role sem ser superusuário torna-se membro dela, mas não um membro que pode alternar para ela. Se o próprio runtime criar a role, a inicialização é bem-sucedida e cada requisição autenticada falha subsequentemente com `DB_PERMISSION_DENIED`. Se isso já aconteceu, execute a linha `GRANT` e reinicie a aplicação.

Se suas tabelas declararem uma coluna `col.vector()`, ative o **pgvector** em **Configuration → Extensions**. O scaffold não declara nenhuma.

### 2. Crie um bucket

Crie um bucket compatível com S3 — o próprio armazenamento S3 da Hostman ou qualquer outro provedor. Nas configurações do bucket, anote o endpoint, a região, a chave de acesso (access key) e a chave secreta (secret key). Mantenha o bucket **privado**: o Rebase assina cada download, e `storageAuthorize` em `backend/storage.ts` decide quem pode ler, gravar e listar.

### 3. Adicione um Dockerfile

O App Platform compila a partir do seu repositório, e `dist-bundle/` está no .gitignore, de modo que a imagem compila o bundle por conta própria e, em seguida, o entrega ao runtime publicado. Faça commit disto na raiz do projeto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.32.0
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Três detalhes importantes aqui:

- **`node:22`, e não `node:22-slim`.** A instalação da CLI baixa o motor de esquema Atlas, que precisa de `curl` e certificados CA. A imagem slim não tem nenhum dos dois, e a instalação falha.
- **`--chown=node:node`.** O runtime é executado como `node` e vincula seus próprios pacotes ao bundle na inicialização. Um bundle pertencente ao root ainda funciona, mas registra um aviso para cada pacote que não conseguiu vincular.
- **Nenhum código-fonte na imagem final.** Ela contém o runtime e o seu bundle compilado. Atualizar o Rebase posteriormente resume-se a alterar a segunda linha `FROM`.

A imagem do runtime escuta na porta 8080 e a declara com `EXPOSE`, que é a porta para a qual o App Platform roteia.

### 4. Crie a aplicação

No **App Platform**, crie uma aplicação **Backend**:

1. Conecte o repositório e branch do GitHub.
2. Defina o **Framework** como **Dockerfile**.
3. Escolha a mesma região do banco de dados e a **rede privada** do banco de dados.
4. Escolha uma configuração com **2 GB de RAM**. O bundle é compilado como parte da imagem e a compilação atinge um pico de cerca de 1 GB, portanto, uma configuração de 1 GB pode ficar sem memória.
5. Defina o **health check path** para `/livez`. O padrão, `/`, também funciona, mas `/livez` responde sem consultar o banco de dados, de modo que uma oscilação momentânea no banco não reinicia uma aplicação saudável.

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

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` definem o primeiro administrador. Em produção, a primeira conta a se registrar não é promovida, portanto, nada mais cria uma. O runtime cria a conta uma única vez, enquanto a tabela de usuários estiver vazia. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

O endereço da aplicação não é conhecido até que ela exista. Crie a aplicação, obtenha seu domínio técnico na aba **Dashboard** e, em seguida, defina `CORS_ORIGINS` e `FRONTEND_URL` com ele. Salvar as configurações fará um novo deploy da aplicação.

### 5. Acesse a aplicação

Abra o domínio da aplicação. Um contêiner serve o painel de administração em `/` e a API em `/api`. Faça login com `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` e, em seguida, altere a senha.

Cada push para a branch faz um novo deploy. Para adicionar seu próprio domínio, use **Settings → Domains**. A Hostman emite o certificado. Adicione a nova origem a `CORS_ORIGINS` e `FRONTEND_URL`.

## Um servidor em nuvem

Um servidor em nuvem da Hostman executa a mesma stack de qualquer VPS: Postgres e o runtime sob o `docker-compose.yml` do seu próprio projeto, com o Caddy na frente para HTTPS. Um servidor com 2 vCPUs e 2 GB de RAM é suficiente para começar.

Crie-o com **Ubuntu 24.04** e sua chave SSH e, em seguida, siga os [passos de servidor único na página do Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Nada neles depende da Hetzner.

Em um servidor, os uploads permanecem em seu disco: o arquivo Compose os mantém em um volume nomeado e define `FORCE_LOCAL_STORAGE=true`. Eles sobrevivem a reinicializações e novos deploys, mas não à perda do servidor, portanto, ative os backups de servidor da Hostman ou transfira-os para um bucket quando começarem a ser importantes.

## O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as que `backend/schema` declara.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema. Ele cria tabelas, colunas e tipos enum ausentes e aplica sua segurança em nível de linha, para que uma nova tabela esteja ativa no próximo deploy.

`ensure` nunca altera algo que já existe. Ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, porque um deploy não deve remodelar um schema como efeito colateral.

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido, um campo removido — requer `rebase db push`, executado a partir de um checkout:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Leia o SQL impresso pelo dry run e, em seguida, execute-o novamente sem `--dry-run`. Duas coisas para organizar no Managed PostgreSQL primeiro:

- **Acessibilidade.** Um banco de dados em uma rede privada não é acessível a partir do seu laptop. Habilite o acesso público durante a execução ou execute o comando a partir de um servidor na mesma rede.
- **O banco de dados temporário (scratch database).** O `db push` planeja cada alteração em uma cópia descartável do schema, em um banco de dados com o mesmo nome do seu e com o sufixo `_dev_diff`. Conceda ao `gen_user` o privilégio **CREATEDB**, ou crie `default_db_dev_diff` uma vez pelo painel. Nenhuma das duas opções é possível na menor configuração.

Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador que todas as plataformas compartilham.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
- [Armazenamento](/docs/backend/storage) — buckets, regras de acesso e várias fontes de armazenamento simultaneamente.
