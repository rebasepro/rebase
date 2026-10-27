---
sourceHash: 7f14a487f380e2c9
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

## Principais Componentes

### Sistema de Adaptadores de Banco de Dados

O backend é inicializado por meio de um padrão unificado de adaptador de banco de dados. A lógica específica do banco de dados é desacoplada em seu próprio pacote, e o adaptador gerencia pool de conexões, resolução de esquema e roteamento de eventos em tempo real automaticamente.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

As coleções são resolvidas automaticamente em relação ao adaptador configurado por meio do registro interno de injeção de dependência.

:::tip
O `createPostgresAdapter` gerencia o pool de conexões com o banco de dados, a resolução de esquema e a configuração de `LISTEN/NOTIFY` em tempo real automaticamente.
:::

### Registro de Coleções

O `BackendCollectionRegistry` é o índice em tempo de execução de todas as coleções, suas tabelas PostgreSQL, enums e relações Drizzle. Ele é preenchido na inicialização a partir das suas definições de coleção.

### Serviço em Tempo Real

A sincronização em tempo real usa o mecanismo nativo de `LISTEN/NOTIFY` do PostgreSQL:

1. Uma mutação de dados acontece (inserção, atualização, exclusão) — pela API ou por qualquer outra coisa que escreva na tabela: `psql`, um cron, o editor SQL
2. Um trigger na tabela emite um `NOTIFY` em um canal (onde o trigger não pode ser instalado, o backend o emite, apenas para escritas feitas pela API)
3. O `RealtimeService` recebe a notificação
4. Ele transmite a alteração para todos os clientes WebSocket conectados
5. Os componentes React são renderizados novamente com os novos dados

Para **implantações com múltiplas instâncias** (por exemplo, Cloud Run com múltiplas réplicas), cada réplica mantém a sua própria conexão `LISTEN` com o mesmo banco de dados, de modo que uma alteração chega aos assinantes de todas as réplicas. Atrás de um pooler em modo de transação como o PgBouncer, que não mantém um `LISTEN`, defina `DATABASE_DIRECT_URL` apontando para o próprio banco de dados.

### Registro de Armazenamento

Assim como os drivers, os backends de armazenamento são registrados em um registro central. Você pode ter vários provedores de armazenamento (local, S3) e rotear diferentes campos de arquivos para diferentes backends usando `storage.storageSource`.

## Mapa de Pacotes

| Pacote | Função | Usado por |
|---------|------|---------|
| `@rebasepro/types` | Interfaces TypeScript para coleções, propriedades, entidades, plugins | Tudo |
| `@rebasepro/server` | Inicialização do servidor backend, API REST, autenticação, armazenamento, WebSocket | Backend |
| `@rebasepro/client` | SDK tipado — transporte HTTP, WebSocket, autenticação | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controladores, formulários, rotas, hooks, telas de login, hooks de controlador de autenticação | Frontend |
| `@rebasepro/ui` | Biblioteca de componentes de UI independente (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/studio` | Editor de coleções, console SQL, console JS, editor de RLS, navegador de armazenamento | Frontend |
| `@rebasepro/cli` | CLI para geração de esquema, migrações de banco de dados, geração de SDK | Ferramentas de desenvolvimento |
| `@rebasepro/forms` | Gerenciamento leve de estado de formulários em React | Frontend |
| `@rebasepro/plugin-ai` | Plugin de preenchimento automático de campos com IA | Frontend |
| `@rebasepro/cms` | Views de gerenciamento de conteúdo, formulários e roteamento, incluindo importação e exportação de CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Infere propriedades de coleção a partir de linhas de exemplo (a importação "criar uma coleção a partir de um arquivo" do admin) | Frontend |

## Fluxo de Dados

### Fluxo de Leitura
1. O usuário abre uma coleção no Rebase CMS
2. O SDK tipado envia `GET /api/data/:slug` + abre uma assinatura WebSocket
3. O backend consulta o PostgreSQL via Drizzle ORM
4. O transformador de dados desserializa os registros do banco de dados no formato de entidade
5. A resposta é enviada para o frontend, os componentes são renderizados
6. O WebSocket mantém a visualização sincronizada em tempo real

### Fluxo de Escrita
1. O usuário edita uma entidade no formulário
2. Os callbacks `beforeSave` são executados (validação, transformação)
3. O SDK tipado envia `PATCH /api/data/:slug/:id`
4. O backend serializa os valores, executa o `UPDATE` do Drizzle
5. Os callbacks `afterSave` são executados (efeitos colaterais)
6. A transmissão via `NOTIFY` aciona a atualização do WebSocket para todos os clientes
7. Se o histórico estiver ativado, um snapshot é registrado

## Próximos Passos

- **[Schema as Code](/docs/architecture/schema-as-code)** — A abordagem TypeScript-first
- **[Visão Geral do Backend](/docs/backend)** — Configuração do servidor
- **[Coleções](/docs/collections)** — Defina seu esquema de dados
