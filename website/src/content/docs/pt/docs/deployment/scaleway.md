---
sourceHash: 8065b392b2b6690b
title: Implantando o Rebase na Scaleway
description: Aprenda como implantar o Rebase na Scaleway para uma infraestrutura em nuvem segura e baseada na França usando Serverless Containers.
sidebar_label: Scaleway
---

A Scaleway é uma provedora de nuvem europeia sediada na França, com datacenters em Paris, Amsterdã e Varsóvia — uma excelente escolha para organizações que priorizam a soberania de dados na UE.

Use o **Managed Database** da Scaleway para Postgres e os **Serverless Containers** para o runtime.

Nada nesta página é específico da Scaleway em relação ao seu projeto. Uma implantação do Rebase consiste em duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda no Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Criar um banco de dados Postgres gerenciado

1. No Console da Scaleway, acesse **PostgreSQL**.
2. Clique em **Create a Database Instance**.
3. Escolha uma Região (ex.: Paris — `PAR1`).
4. Selecione um Node Type (**Play2-Pico** ou **Pro2-XXS** funcionam bem).
5. Adicione um nome para o banco de dados (`rebase_db`) e uma senha de usuário forte.
6. Assim que implantado, anote a **Connection string** (URI) no painel:
   `postgres://user:password@ip:port/rebase_db`

Se suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez: execute `CREATE EXTENSION vector;` no banco de dados.

## 2. Gerar o bundle e incluí-lo em uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O comando `rebase build` produz um diretório `dist-bundle` com suas coleções, funções e crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Serverless Containers faz o pull a partir de um registry, então incorpore o bundle em uma imagem derivada. São apenas três linhas, e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Vá para **Container Registry** no Console da Scaleway e crie um namespace (ex.: `rebase-apps`).
2. Faça login no registry pelo seu terminal seguindo as instruções exibidas.
3. Faça o build e o push a partir da raiz do projeto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. O seu bundle permanece intocado.

## 3. Implantar o Serverless Container

1. Navegue até **Serverless Containers**.
2. Clique em **Create a Container**.
3. Escolha a imagem que você acabou de enviar.
4. Defina a Porta para **8080** — a porta na qual a imagem de runtime escuta, a menos que a variável `PORT` determine o contrário.
5. Em Environment Variables, adicione:

| Chave | Valor |
|-----|-------|
| `DATABASE_URL` | A URI obtida na etapa do Postgres Gerenciado |
| `JWT_SECRET` | Uma string aleatória segura de mais de 32 caracteres para assinar tokens de autenticação |
| `REBASE_SERVICE_KEY` | Uma string aleatória segura de mais de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço de e-mail do primeiro administrador, configurado **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | No mínimo 12 caracteres |

As três últimas variáveis são a única maneira pela qual esta implantação obtém um administrador: em produção, a primeira conta registrada não é promovida automaticamente, portanto nenhuma outra ação gerará o primeiro chamador autenticado. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Configure os valores sensíveis como variáveis de ambiente secretas (secret) em vez de texto simples.

6. Aponte a verificação de integridade (health check) para `/livez`. Não use `/health`: esta rota executa uma operação completa de ida e volta ao banco de dados, portanto, uma liveness probe configurada nela reiniciará um container saudável durante uma breve oscilação do banco.
7. Clique em **Deploy Container**.

A Scaleway provisionará o container e fornecerá um endpoint público (ex.: `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Para conformidade rigorosa com a proteção de dados, certifique-se de que os detalhes da sua Organização na Scaleway reflitam sua entidade corporativa europeia.*

## 4. O schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as de suas coleções.** A variável `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é uma operação puramente aditiva em todo o schema — ela cria tabelas, colunas e tipos enum ausentes e aplica a segurança a nível de linha (RLS) correspondente — de modo que a primeira inicialização em um banco de dados vazio já começa servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, pois a reinicialização de um container não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas ações ainda precisam da CLI, executada a partir de uma cópia local do código ou de um job de CI com a variável `DATABASE_URL` apontando para o seu banco gerenciado:

```bash
rebase db push
```

- **RLS de tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

A imagem de runtime é disponibilizada sem a CLI, portanto isso nunca é executado dentro do container. Para migrações versionadas, faça commit dos arquivos de migração gerados com `rebase db generate` e execute `rebase db migrate` como uma etapa do processo de release.

## Armazenamento de arquivos

Containers Serverless não possuem disco persistente, portanto o armazenamento local de arquivos causará perda silenciosa de dados e o runtime rejeita essa prática em produção. O Scaleway Object Storage é compatível com S3 e reside nos mesmos datacenters:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulte [Armazenamento](/docs/backend/storage) para obter todos os detalhes.

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
