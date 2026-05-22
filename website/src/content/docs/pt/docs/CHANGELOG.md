---
slug: docs/changelog
title: Histórico de Alterações
---
# Histórico de Alterações

## [0.1.2] - 2026-05-15

### Melhorias

- **Remoção da dependência do `lodash`** — Substituição do `lodash/cloneDeep` por um utilitário personalizado `deepClone` em `@rebasepro/utils`. Isso elimina a dependência externa e corrige a falha do `npx create-rebase-app` devido à falta do `lodash` em tempo de execução.
- **Novo utilitário `deepClone`** — Uma função leve de clonagem profunda que preserva referências a funções e instâncias de classes (Date, GeoPoint, etc.), projetada especificamente para objetos de coleção do Rebase.

### CI e Ferramentas

- **Fluxo de publicação automatizado** — Novo fluxo de trabalho do GitHub Actions (`Publish Stable Release`) que lida com o incremento da versão, a publicação no npm e a criação do lançamento no GitHub com um único clique na guia Actions.
- **Script de lançamento local** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` para lançar a partir da linha de comando com o mesmo fluxo de publicação.
- **Lançamentos Canary** — Cada push no `main` publica uma versão canary no npm (tag de distribuição `@canary`).

### Correções

- Corrigidos os testes do utilitário de navegação para garantir a assinatura de chamada correta com o parâmetro de opções opcional `undefined`.
- Atualizadas as descrições dos pacotes para refletir a arquitetura baseada no Postgres.

---

## [0.1.0] - 2025-05-14

🎉 **Primeiro lançamento público do Rebase** — um CMS headless de código aberto e painel de administração para Postgres.

### Destaques

- **Painel de Administração Completo** — Vistas de planilha, cartões, listas e tabelas para gerenciar seus dados com edição em linha, filtragem, ordenação e pesquisa.
- **Backend do PostgreSQL** — Suporte de primeira classe ao Postgres com Drizzle ORM, introspecção de esquema e migrações automáticas.
- **Autenticação** — Autenticação integrada com e-mail/senha, Google OAuth e login anônimo. Controle de acesso baseado em funções com permissões personalizáveis.
- **Armazenamento** — Armazenamento de arquivos compatível com S3 com redimensionamento de imagens, uploads por arrastar e soltar e gerenciamento de metadatos.
- **Studio** — Editor SQL, editor de políticas RLS, visualizador de esquema, editor JS/TS, tarefas cron e explorador de API.
- **CLI** — `npx create-rebase-app` para estruturar um novo projeto em segundos. Suporta tanto npm quanto pnpm.
- **Gerador de SDK** — Gera automaticamente SDKs do TypeScript totalmente tipados a partir das definições de suas coleções.
- **Servidor MCP** — Servidor Model Context Protocol para gerenciamento de banco de dados assistido por IA.
- **Plugins** — Plugins de enriquecimento de dados e insights para estender a experiência de administração.
- **Biblioteca de Componentes de UI** — Um conjunto abrangente de componentes React acessíveis e personalizáveis baseados em primitivas Radix.
- **Suporte ao Firebase** — Adaptadores opcionais de autenticação e fonte de dados do Firebase/Firestore.
- **Suporte ao MongoDB** — Adaptador de fonte de dados opcional do MongoDB.

### Pacotes

| Pacote | Descrição |
|---|---|
| `@rebasepro/types` | Definições de tipo principais do TypeScript |
| `@rebasepro/utils` | Funções de utilitário compartilhadas |
| `@rebasepro/common` | Módulos comuns compartilhados entre os pacotes |
| `@rebasepro/formex` | Biblioteca leve de gerenciamento de formulários |
| `@rebasepro/ui` | Biblioteca de componentes React |
| `@rebasepro/core` | Lógica central do CMS e controladores |
| `@rebasepro/client` | Camada de acesso a dados do lado do cliente |
| `@rebasepro/client-postgresql` | Adaptador de cliente do PostgreSQL |
| `@rebasepro/client-firebase` | Adaptador de cliente do Firebase/Firestore |
| `@rebasepro/server-core` | Framework do servidor e middleware |
| `@rebasepro/server-postgresql` | Adaptador de servidor do PostgreSQL com Drizzle |
| `@rebasepro/server-mongodb` | Adaptador de servidor do MongoDB |
| `@rebasepro/auth` | Controladores e visualizações de autenticação |
| `@rebasepro/admin` | Interface completa do painel de administração |
| `@rebasepro/studio` | Editor SQL, ferramentas de esquema e utilitários para desenvolvedores |
| `@rebasepro/cli` | CLI para estruturação e gerenciamento de projetos |
| `@rebasepro/sdk-generator` | Geração de código do SDK do TypeScript |
| `@rebasepro/mcp-server` | Servidor MCP para integrações de IA |
| `@rebasepro/schema-inference` | Introspeção e inferência de esquema de banco de dados |
| `@rebasepro/plugin-data-enhancement` | Plugin de enriquecimento de dados alimentado por IA |
| `@rebasepro/plugin-insights` | Plugin de análises e insights |
