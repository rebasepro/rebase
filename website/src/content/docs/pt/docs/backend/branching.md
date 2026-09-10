---
sourceHash: bba1fa1dd7f34bed
title: Branching de Banco de Dados
sidebar_label: Branching
description: Crie branches de banco de dados isoladas para desenvolvimento, staging e testes usando o CREATE DATABASE ... TEMPLATE do PostgreSQL — cópias instantâneas e de alta fidelidade com zero tempo de inatividade.
---

## Visão Geral

O branching de banco de dados permite que você crie **cópias instantâneas e isoladas** de todo o seu banco de dados (tanto esquema quanto dados) para realizar com segurança o desenvolvimento, testes de migração e procedimentos de QA.

Ao utilizar templates nativos do PostgreSQL, o Rebase provisiona clones de bancos de dados no nível do sistema de arquivos. Isso significa que você obtém uma réplica de fidelidade total contendo todas as tabelas, índices, tipos customizados, restrições (constraints) e políticas de Row-Level Security (RLS) sem nenhum overhead de transferência de rede ou atrasos de configuração de esquema.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## Por Baixo dos Panos: Modelos (Templating) do PostgreSQL

Quando uma branch de banco de dados é criada, o `BranchService` do Rebase executa o seguinte comando SQL:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

O PostgreSQL processa essa operação copiando os diretórios subjacentes do sistema de arquivos que contêm os arquivos do banco de dados de origem. Isso fornece:
- **Clones em Subsegundos**: Nenhuma geração de SQL ou carregamento de dados é realizado.
- **Esquemas e Dados Idênticos**: Cada linha, índice e restrição é duplicado instantaneamente.
- **Isolamento Completo**: Alterar o esquema ou inserir registros na branch não tem impacto no banco de dados de origem.

### A Proteção contra Limitação de Conexões

O PostgreSQL exige que **nenhuma outra conexão ativa** exista no banco de dados de template (origem) ao executar um comando `CREATE DATABASE ... TEMPLATE`.

Para evitar falhas, o `DatabasePoolManager` do Rebase executa um processo de desocupação ativa antes de clonar ou remover uma branch:
1. **Loop de Desocupação**: Ele fecha e desconecta automaticamente todos os pools inativos que apontam para o banco de dados de destino dentro do contexto da aplicação Rebase.
2. **Bloqueio de Conexões Externas**: Se clientes externos (como DBeaver, pgAdmin ou processos de backend externos) mantiverem transações ativas no banco de dados de origem, o PostgreSQL rejeitará a operação de template com um erro `"being accessed by other users"`.

A falha informa exatamente o que está conectado, em vez de deixar você adivinhar:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

O `--force` encerra essas sessões antes da criação do template, tanto no `create` quanto no `delete`. Ele nunca encerra a sessão que está executando o comando em si.

O `DatabasePoolManager` desconecta seus próprios pools inativos antes de clonar ou remover — mas apenas os pools **dentro do processo que está executando o trabalho**. O comando `rebase db branch` é executado como seu próprio processo, portanto isso não alcança nada mais na sua máquina:

- **Um `rebase dev` em execução bloqueia o branching.** Este é o caso comum, não um caso isolado: querer uma branch e executar a aplicação costumam acontecer no mesmo momento. Pare o servidor de desenvolvimento, crie a branch e inicie-o novamente.
- **Qualquer outro cliente também bloqueia.** DBeaver, pgAdmin, uma sessão do `psql`, uma segunda instância da aplicação — o PostgreSQL rejeita a operação com `is being accessed by other users` e essas conexões precisam ser fechadas manualmente.

Não há como contornar isso no próprio PostgreSQL; o `CREATE DATABASE ... TEMPLATE` é uma cópia em nível de sistema de arquivos e o template deve permanecer inativo durante todo o processo.

---

## Esquema de Metadados

As configurações de branch são armazenadas no banco de dados padrão sob a tabela `rebase.branches`, que é provisionada durante o bootstrapping:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Sanitize user branch name (alphanumeric & underscores)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

---

## API Programática

A API de branching é exposta por meio do `BranchService` do backend. Abaixo está uma referência da interface principal:

### Criar uma Branch de Banco de Dados

Gera um novo banco de dados de branch a partir do banco de dados padrão ou de um template de origem explícito.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### Listar Branches Ativas

Recupera a lista de branches registradas juntamente com seus tamanhos físicos consultados por meio da função de sistema `pg_database_size` do PostgreSQL.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

### Obter Informações da Branch

Busca os metadados de uma única branch. Se a branch existir, o serviço tentará consultar seu uso atual de disco físico:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Excluir uma Branch

Remove o banco de dados de destino do servidor e limpa seu registro na tabela de metadados `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Trava de Segurança: O banco de dados principal (nome do banco de dados padrão configurado nas strings de conexão) está protegido. Se você tentar excluir o banco de dados pai, o `BranchService` lançará um erro `"Cannot delete the main database"` e abortará a operação.

---

## Integração com a CLI

As branches de banco de dados podem ser gerenciadas diretamente usando a CLI do Rebase.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

O comando `switch` é o que torna uma branch utilizável. Ele registra a branch em `.rebase/branch.json` — apenas um nome, nunca uma string de conexão, mantendo suas credenciais somente no `.env` — e todos os comandos `rebase` subsequentes nesse checkout passam a resolver o banco de dados da branch: `dev`, `db push`, `db migrate`, `db backup`.

Ele fica posicionado entre a shell e o arquivo do projeto na ordem de resolução:

1. `--database-url` na linha de comando
2. `DATABASE_URL` no ambiente da shell
3. **a branch para a qual este checkout foi alternado**
4. `DATABASE_URL` no `.env` do projeto

Uma branch precisa ter precedência sobre o `.env`, caso contrário, alternar não faria efeito em nenhum projeto que defina `DATABASE_URL`; mas ela não pode ter precedência sobre os dois itens acima dela, pois uma flag nessa linha de comando é uma instrução mais imediata do que uma alternância feita ontem.

O diretório `.rebase/` está no gitignore, portanto a branch em que você está é uma informação sobre a sua máquina e nunca sobre o projeto.

As branches são bancos de dados PostgreSQL comuns nomeados a partir da branch com o prefixo `rb_`, de modo que `dev_sandbox` acima é o banco de dados `rb_dev_sandbox` no mesmo servidor.

Criar uma branch **não** altera com qual banco de dados o seu projeto se comunica. O comando `rebase db branch create` faz a cópia e para por aí; nada é gravado no `.env`, e o próximo `rebase dev` ainda usará o banco de dados que usava antes. Para trabalhar em uma branch, aponte você mesmo o `DATABASE_URL` para ela — a string de conexão é a mesma que você já possui, apenas trocando o nome do banco de dados:

```bash
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## O branching requer um servidor PostgreSQL real

O branching **não** funciona com o banco de dados de desenvolvimento gerenciado — o banco de dados PGlite sem configuração prévia que o `rebase dev` inicia quando um projeto não possui `DATABASE_URL`.

O PGlite atende a exatamente um banco de dados. Executar `CREATE DATABASE ... TEMPLATE` nele grava uma entrada no catálogo e não copia nada, portanto a "branch" resolve para o banco de dados do qual foi clonada: as gravações que você acredita estarem isoladas acabam no seu banco de dados de desenvolvimento, e não há uma segunda cópia para a qual retornar.

Use o branching com um servidor real — seu próprio PostgreSQL via `DATABASE_URL`, ou `rebase dev --docker`.

---

## Melhores Práticas e Limitações

### Uso de Disco
Como o PostgreSQL duplica os arquivos no disco, cada branch consome espaço equivalente ao banco de dados de origem. Se você tem um banco de dados de produção de 100 GB, criar 5 branches consumirá 500 GB adicionais de armazenamento.
* *Recomendação*: Utilize bancos de dados reduzidos (subsets) ou templates de desenvolvimento leves como origens de clonagem em vez de clones integrais de produção.

O comando `rebase db branch prune` é como você recupera o espaço:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nada expira a menos que você solicite: uma branch pode ser a única cópia do trabalho de uma tarde inteira, portanto o `--older-than` é opcional (opt-in) e as idades são arredondadas para baixo, e o comando exibe seu plano e solicita confirmação antes de remover qualquer coisa, a menos que você passe `--yes`.

O comando prune também identifica as duas maneiras pelas quais as branches divergem de seus metadados — uma entrada cujo banco de dados foi excluído com SQL comum (o que o comando `list` continuaria exibindo para sempre), e um banco de dados de branch cujo registro nunca foi gravado (uma falha entre as duas instruções executadas pelo `create`). Os bancos de dados temporários `<db>_dev_diff` do Atlas são reportados conjuntamente, mas removidos apenas com `--include-dev-diff`: eles não são branches, e um deles pode pertencer a um `db push` em execução neste exato momento.

### Compatibilidade com pgBouncer
Ao implantar atrás do pgBouncer ou de poolers de conexão, certifique-se de que o pooler ofereça suporte a operações administrativas de banco de dados. Criar e excluir bancos de dados ignora pools padrão em nível de transação e requer conexões diretas ao servidor Postgres (usando privilégios de usuário elevados) por meio da configuração `adminConnectionString`.

### Consultas Entre Bancos de Dados (Cross-Database)
Como as branches são bancos de dados PostgreSQL separados, você não pode executar instruções SQL `JOIN` cruzando os limites das branches. Todos os relacionamentos devem estar contidos no escopo do banco de dados da branch ativa única.


## Relacionado

- [Comandos da CLI](/docs/cli/) — `rebase db branch` e suas flags
- [Geração de Esquema](/docs/cli/schema/) — como o esquema que uma branch copia é gerado
- [Ambiente e Configuração](/docs/getting-started/configuration/) — `DATABASE_URL` e sobre o que uma branch alternada tem precedência

---
