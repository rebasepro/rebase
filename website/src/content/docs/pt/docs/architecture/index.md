---
sourceHash: 08efd8549191e760
title: Visão Geral da Arquitetura
sidebar_label: Arquitetura
description: Entenda como o backend, frontend, SDK do cliente e banco de dados do Rebase se integram para formar um Backend-as-a-Service completo.
---

## Arquitetura do Sistema

Rebase é uma plataforma full-stack com quatro camadas:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  React Admin UI  •  Custom Views  •  Plugins  •  Your App      │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes Chave

### Sistema Bootstrapper

O backend inicializa através de um sistema bootstrapper baseado em plugins. A lógica específica do banco de dados é desacoplada em seu próprio pacote, e os bootstrappers lidam com a inicialização do banco de dados, autenticação e serviços internos.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
        connectionString: process.env.DATABASE_URL!
    })
```

As coleções são automaticamente resolvidas em relação ao bootstrapper configurado através do registro interno de injeção de dependência.

:::tip
O `createPostgresAdapter` lida automaticamente com o pool de conexões do banco de dados, resolução de esquema e configuração de `LISTEN/NOTIFY` em tempo real.
:::

### Registro de Coleções

O `BackendCollectionRegistry` é o índice em tempo de execução de todas as coleções, suas tabelas PostgreSQL, enums e relações Drizzle. Ele é preenchido na inicialização a partir das suas definições de coleção.

### Serviço em Tempo Real

A sincronização em tempo real usa o mecanismo nativo `LISTEN/NOTIFY` do PostgreSQL:

1.  Ocorre uma mutação de dados (inserção, atualização, exclusão)
2.  O backend emite um `NOTIFY` em um canal
3.  O `RealtimeService` recebe a notificação
4.  Ele transmite a mudança para todos os clientes WebSocket conectados
5.  Componentes React são renderizados novamente com os novos dados

Para **implantações multi-instância** (por exemplo, Cloud Run com múltiplas réplicas), forneça uma `connectionString` no seu PostgresBootstrapper para que todas as réplicas compartilhem a mesma conexão `LISTEN`.

### Registro de Armazenamento

Assim como os drivers, os backends de armazenamento são registrados em um registro. Você pode ter vários provedores de armazenamento (local, S3) e rotear diferentes campos de arquivo para diferentes backends usando `storageId`.

## Mapa de Pacotes

| Pacote | Função | Usado Por |
|---------|------|---------|
| `@rebasepro/types` | Interfaces TypeScript para coleções, propriedades, entidades, plugins | Tudo |
| `@rebasepro/server` | Inicialização do servidor backend, API REST, autenticação, armazenamento, WebSocket | Backend |
| `@rebasepro/client` | SDK do Cliente — Transporte HTTP, WebSocket, autenticação | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controladores, formulários, rotas, hooks | Frontend |
| `@rebasepro/ui` | Biblioteca de componentes de UI autônomos (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Visualizações de login, hooks de controlador de autenticação, gerenciamento de usuário | Frontend |
| `@rebasepro/studio` | Editor de coleções, console SQL, console JS, editor RLS, navegador de armazenamento | Frontend |
| `@rebasepro/cli` | CLI para geração de esquema, migrações de BD, geração de SDK | Ferramentas de desenvolvimento |
| `@rebasepro/forms` | Gerenciamento de estado de formulário React leve | Frontend |
| `@rebasepro/plugin-ai` | Plugin de preenchimento automático de campo alimentado por IA | Frontend |
| `@rebasepro/plugin-data-import-export` | Importação e exportação CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Detecção automática de esquema a partir de dados de banco de dados existentes | Backend/CLI |

## Fluxo de Dados

### Fluxo de Leitura
1.  O usuário abre uma coleção na interface de administração
2.  O SDK do Cliente envia `GET /api/data/:slug` + abre uma assinatura WebSocket
3.  O backend consulta o PostgreSQL via Drizzle ORM
4.  O transformador de dados desserializa os registros do banco de dados para o formato de entidade
5.  Resposta enviada ao frontend, componentes são renderizados
6.  O WebSocket mantém a visualização sincronizada em tempo real

### Fluxo de Escrita
1.  O usuário edita uma entidade no formulário
2.  Callbacks `beforeSave` são executados (validação, transformação)
3.  O SDK do Cliente envia `PATCH /api/data/:slug/:id`
4.  O backend serializa os valores, executa o `UPDATE` do Drizzle
5.  Callbacks `afterSave` são executados (efeitos colaterais)
6.  A transmissão `NOTIFY` aciona a atualização do WebSocket para todos os clientes
7.  Se o histórico estiver habilitado, um entity é gravado

## Próximos Passos

-   **[Esquema como Código](/docs/architecture/schema-as-code)** — A abordagem TypeScript-first
-   **[Visão Geral do Backend](/docs/backend)** — Configuração do servidor
-   **[Coleções](/docs/collections)** — Defina seu esquema de dados
---
