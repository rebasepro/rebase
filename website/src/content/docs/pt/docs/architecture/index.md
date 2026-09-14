---
sourceHash: fa7350988287074c
title: Visão Geral da Arquitetura
sidebar_label: Arquitetura
description: Entenda como o backend, frontend, SDK do cliente e banco de dados do Rebase se integram para formar um Backend-as-a-Service completo.
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

1. Uma mutação de dados acontece (inserção, atualização, exclusão)
2. O backend emite um `NOTIFY` em um canal
3. O `RealtimeService` recebe a notificação
4. Ele transmite a alteração para todos os clientes WebSocket conectados
5. Os componentes React são renderizados novamente com os novos dados

Para **implantações com múltiplas instâncias** (por exemplo, Cloud Run com múltiplas réplicas), forneça uma `connectionString` no seu PostgresBootstrapper para que todas as réplicas compartilhem a mesma conexão `LISTEN`.

### Registro de Armazenamento

Assim como os drivers, os backends de armazenamento são registrados em um registro central. Você pode ter vários provedores de armazenamento (local, S3) e rotear diferentes campos de arquivos para diferentes backends usando `storageId`.

## Mapa de Pacotes

| Pacote | Função | Usado por |
|---------|------|---------|
| `@rebasepro/types` | Interfaces TypeScript para coleções, propriedades, entidades, plugins | Tudo |
| `@rebasepro/server` | Inicialização do servidor backend, API REST, autenticação, armazenamento, WebSocket | Backend |
| `@rebasepro/client` | SDK do cliente — transporte HTTP, WebSocket, autenticação | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controladores, formulários, rotas, hooks | Frontend |
| `@rebasepro/ui` | Biblioteca de componentes de UI independente (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Telas de login, hooks de controlador de autenticação, gerenciamento de usuários | Frontend |
| `@rebasepro/studio` | Editor de coleções, console SQL, console JS, editor de RLS, navegador de armazenamento | Frontend |
| `@rebasepro/cli` | CLI para geração de esquema, migrações de banco de dados, geração de SDK | Ferramentas de desenvolvimento |
| `@rebasepro/forms` | Gerenciamento leve de estado de formulários em React | Frontend |
| `@rebasepro/plugin-ai` | Plugin de preenchimento automático de campos com IA | Frontend |
| `@rebasepro/plugin-data-import-export` | Importação e exportação de CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Detecção automática de esquema a partir de dados de banco de dados existentes | Backend/CLI |

## Fluxo de Dados

### Fluxo de Leitura
1. O usuário abre uma coleção no Rebase CMS
2. O SDK do cliente envia `GET /api/data/:slug` + abre uma assinatura WebSocket
3. O backend consulta o PostgreSQL via Drizzle ORM
4. O transformador de dados desserializa os registros do banco de dados no formato de entidade
5. A resposta é enviada para o frontend, os componentes são renderizados
6. O WebSocket mantém a visualização sincronizada em tempo real

### Fluxo de Escrita
1. O usuário edita uma entidade no formulário
2. Os callbacks `beforeSave` são executados (validação, transformação)
3. O SDK do cliente envia `PATCH /api/data/:slug/:id`
4. O backend serializa os valores, executa o `UPDATE` do Drizzle
5. Os callbacks `afterSave` são executados (efeitos colaterais)
6. A transmissão via `NOTIFY` aciona a atualização do WebSocket para todos os clientes
7. Se o histórico estiver ativado, um snapshot é registrado

## Próximos Passos

- **[Schema as Code](/docs/architecture/schema-as-code)** — A abordagem TypeScript-first
- **[Visão Geral do Backend](/docs/backend)** — Configuração do servidor
- **[Coleções](/docs/collections)** — Defina seu esquema de dados
