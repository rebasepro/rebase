---
sourceHash: b58890f96ff100b4
title: Visão Geral da Arquitetura
sidebar_label: Arquitetura
description: Entenda como o backend, frontend, SDK tipado e banco de dados do Rebase se integram para formar um Backend-as-a-Service completo.
---

## Arquitetura do Sistema

O Rebase é uma plataforma full-stack com quatro camadas:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  Rebase CMS + Studio  •  Custom Views  •  Plugins  •  Your App │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes Principais

### Sistema de Adaptador de Banco de Dados

O backend é inicializado por meio de um padrão unificado de adaptador de banco de dados. A lógica específica do banco de dados é desacoplada em seu próprio pacote, e o adaptador gerencia automaticamente o pool de conexões, a resolução de esquemas e o roteamento de eventos em tempo real.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Cada tabela é resolvida em relação ao adaptador configurado — o banco de dados padrão ou aquele que sua propriedade `database` define em `backend/resources.ts`.

:::tip
O `createPostgresAdapter` gerencia automaticamente o pool de conexões com o banco de dados, a resolução de esquemas e a configuração de `LISTEN/NOTIFY` em tempo real.
:::

### Descritores de tabela

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Na inicialização, o backend compila as tabelas exportadas por `backend/schema/index.ts` em **descritores**: cada coluna com seu tipo Postgres, nulabilidade, regras de validação e armazenamento, as relações por slug e a política de segurança em nível de linha (RLS). Um problema em qualquer tabela impede a inicialização com um erro `SchemaDefinitionError` listando cada inconsistência. Os descritores são a base para o funcionamento do REST, realtime, MCP e da especificação OpenAPI, sobre os quais a versão do esquema é calculada e o que o `GET /api/schema/tables` fornece ao painel de administração e ao Studio, com dados sensíveis ocultados de acordo com o solicitante. O código dos hooks nunca sai do servidor. Um backend sem `backend/schema` faz a introspecção do banco de dados nesses mesmos descritores.

### Serviço em Tempo Real

A sincronização em tempo real utiliza o mecanismo nativo `LISTEN/NOTIFY` do PostgreSQL:

1. Uma mutação de dados acontece (insert, update, delete) — por meio da API ou qualquer outra ferramenta que grave na tabela: `psql`, um cron, o editor SQL
2. Um gatilho (trigger) na tabela emite um `NOTIFY` em um canal (caso o gatilho não possa ser instalado, o próprio backend o emite, exclusivamente para gravações feitas via API)
3. O `RealtimeService` recebe a notificação
4. Ele transmite a alteração para todos os clientes WebSocket conectados
5. Os componentes React são renderizados novamente com os novos dados

Para **implantações multi-instância** (por exemplo, Cloud Run com múltiplas réplicas), cada réplica mantém sua própria conexão `LISTEN` com o mesmo banco de dados, garantindo que a alteração alcance os assinantes de todas as réplicas. Ao utilizar um pooler em modo de transação como o PgBouncer, que não suporta conexões persistentes de `LISTEN`, defina `DATABASE_DIRECT_URL` apontando diretamente para o banco de dados.

### Registro de Armazenamento

Assim como os drivers, os backends de armazenamento são registrados em um catálogo centralizado. É possível configurar múltiplos provedores de armazenamento (local, S3) e rotear diferentes colunas de arquivos para backends distintos usando `col.storage({ source })`.

## Mapa de Pacotes

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Pacote | Função | Usado por |
|---------|------|---------|
| `@rebasepro/types` | Construtores de tabela (`defineTable`, `col`, `rel`), descritores e interfaces compartilhadas por todos os pacotes | Todos |
| `@rebasepro/server` | Inicialização do servidor backend, REST API, autenticação, armazenamento, WebSocket; reexporta os construtores de `@rebasepro/server/schema`, um ponto de entrada que não carrega código de servidor | Backend |
| `@rebasepro/server-postgres` | Driver Postgres: planejamento de esquema, migrações, políticas de RLS, realtime | Backend |
| `@rebasepro/codegen` | Geração de SDK tipado a partir dos descritores de tabela | Ferramentas de desenvolvimento |
| `@rebasepro/client` | SDK tipado — transporte HTTP, WebSocket, autenticação | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controladores, formulários, rotas, hooks, telas de login, hooks de controle de autenticação | Frontend |
| `@rebasepro/ui` | Biblioteca independente de componentes de UI (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/studio` | Visualizador e editor de esquema, console SQL, console JS, editor de RLS, gerenciador de armazenamento | Frontend |
| `@rebasepro/cli` | CLI para geração de esquemas, migrações de banco de dados e geração de SDK | Ferramentas de desenvolvimento |
| `@rebasepro/forms` | Gerenciamento leve de estado de formulários para React | Frontend |
| `@rebasepro/plugin-ai` | Plugin de preenchimento automático de campos com IA | Frontend |
| `@rebasepro/cms` | Painel administrativo: uma visualização por tabela a partir dos descritores, `customizeTable`, formulários e rotas, importação e exportação de CSV/JSON/Excel | Frontend |
| `@rebasepro/cms-types` | Tipos e utilitários do painel: opções do `customizeTable`, opções de campo, ações de entidade e modelo de visualização de coleções e propriedades (`CollectionConfig`, `StringProperty`, `CollectionCallbacks`, …) | Frontend |
| `@rebasepro/firebase` | Firestore como fonte de dados lida diretamente pelo painel: `defineFirestoreCollection` | Frontend |
| `@rebasepro/inference` | Inferência de campos a partir de linhas de exemplo (importação "criar a partir de arquivo" do admin) | Frontend |

## Fluxo de Dados

### Fluxo de Leitura
1. O usuário abre uma tabela no Rebase CMS
2. O SDK tipado envia `GET /api/data/:slug` e abre uma assinatura WebSocket
3. O backend consulta o PostgreSQL via Drizzle ORM
4. A resposta retorna as linhas fornecidas pela API; o painel monta os valores do formulário com base nos registros e no descritor da tabela
5. A resposta é enviada ao frontend e os componentes são renderizados
6. O WebSocket mantém a visualização sincronizada em tempo real

### Fluxo de Escrita
1. O usuário edita uma linha no formulário
2. O SDK tipado envia `PATCH /api/data/:slug/:id`
3. O backend valida os valores com base na tabela e executa os hooks `beforeSave`
4. Executa a instrução `UPDATE` respeitando a segurança em nível de linha (RLS) do chamador
5. Os hooks `afterSave` são executados dentro da mesma transação
6. A notificação via `NOTIFY` dispara a atualização por WebSocket para todos os clientes
7. Se o histórico estiver ativado, um snapshot do registro é armazenado

## Próximos Passos

- **[Schema as Code](/docs/architecture/schema-as-code)** — A abordagem TypeScript-first
- **[Visão Geral do Backend](/docs/backend)** — Configuração do servidor
- **[Tabelas](/docs/schema/)** — Defina o esquema dos seus dados
