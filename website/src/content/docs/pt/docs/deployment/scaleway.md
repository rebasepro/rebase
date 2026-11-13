---
sourceHash: 0664758f56d33104
title: Implantando o Rebase na Scaleway
description: Aprenda como implantar o Rebase na Scaleway para uma infraestrutura em nuvem segura e sediada na França usando Serverless Containers.
sidebar_label: Scaleway
---

A Scaleway é uma provedora de nuvem europeia sediada na França, com data centers em Paris, Amsterdã e Varsóvia — uma excelente escolha para organizações que priorizam a soberania de dados na UE.

Use o **Managed Database** da Scaleway para Postgres e o **Serverless Containers** para o runtime.

Nada nesta página é específico da Scaleway em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** gerado por `rebase build` — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Criar um Banco de Dados Postgres Gerenciado

1. No Scaleway Console, vá para **PostgreSQL**.
2. Clique em **Create a Database Instance**.
3. Escolha uma Região (ex.: Paris — `PAR1`).
4. Selecione um Tipo de Nó (**Play2-Pico** ou **Pro2-XXS** funcionam bem).
5. Adicione um nome de banco de dados (`rebase_db`) e uma senha de usuário forte.
6. Depois de implantado, anote a **Connection string** (URI) no painel:
   `postgres://user:password@ip:port/rebase_db`

Se as suas tabelas declararem uma coluna `col.vector()`, habilite a extensão uma vez: `CREATE EXTENSION vector;` no banco de dados.

## 2. Gerar o bundle e incluí-lo em uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas tabelas compiladas, funções, crons e — se o seu projeto declarar um aplicativo estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Serverless Containers faz o pull a partir de um registro, portanto, embale o bundle em uma imagem derivada. Três linhas, e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Vá para **Container Registry** no Scaleway Console e crie um namespace (ex.: `rebase-apps`).
2. Faça login no registro a partir do seu terminal usando as instruções exibidas.
3. Construa e faça o push, a partir da raiz do projeto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Atualizar o Rebase posteriormente resume-se a alterar essa linha `FROM`. Seu bundle permanece intocado.

## 3. Implantar o Serverless Container

1. Navegue até **Serverless Containers**.
2. Clique em **Create a Container**.
3. Escolha a imagem que você acabou de enviar (push).
4. Defina a Porta para **8080** — a porta na qual a imagem de runtime escuta, a menos que `PORT` indique o contrário.
5. Em Environment Variables, adicione:

| Chave | Valor |
|-------|-------|
| `DATABASE_URL` | A URI do passo do Managed Postgres |
| `JWT_SECRET` | Uma string aleatória segura de 32+ caracteres para assinar tokens de autenticação |
| `REBASE_SERVICE_KEY` | Uma string aleatória segura de 32+ caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, configurado **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

Os três últimos itens são como essa implantação obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais gera o primeiro chamador autenticado. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Marque os segredos como variáveis de ambiente secretas em vez de variáveis comuns.

6. Aponte a verificação de integridade (health check) para `/livez`. Não para `/health`: esta última realiza uma comunicação de ida e volta com o banco de dados, portanto, uma sonda de liveness nela reiniciará um contêiner íntegro durante uma breve oscilação do banco de dados.
7. Clique em **Deploy Container**.

A Scaleway provisiona o contêiner e fornece a você um endpoint público (ex.: `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Para uma conformidade rigorosa de dados, verifique se os detalhes da sua Organização na Scaleway refletem sua entidade corporativa europeia.*

## 4. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria tabelas ausentes na inicialização, incluindo aquelas que `backend/schema` declara.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (row-level security) deles — de modo que a primeira inicialização em um banco de dados vazio já começa servindo suas tabelas.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, pois a reinicialização de um contêiner não deve remodelar um schema como efeito colateral de uma implantação.

Portanto, uma coisa ainda requer a CLI, executada a partir de um checkout ou de um job de CI com `DATABASE_URL` apontando para o seu Managed Database:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido, um campo removido.

A imagem de runtime é distribuída sem a CLI, portanto, isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

Os Serverless Containers não possuem disco durável, portanto o armazenamento de arquivos local causaria perda silenciosa de dados e o runtime o recusa em produção. O Scaleway Object Storage é compatível com o S3 e reside nos mesmos data centers:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulte [Armazenamento](/docs/backend/storage) para ver o panorama completo.

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
