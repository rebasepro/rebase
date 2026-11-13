---
sourceHash: 47f5760918cfd724
title: Runtime e Bundles
sidebar_label: Runtime & Bundles
description: Como um projeto Rebase se divide em um bundle de projeto e um runtime versionado, e por que essa separação é o que torna possíveis atualizações, aplicativos multi-repo e hospedagem gerenciada.
---

## As duas metades de um deployment

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um deployment do Rebase é composto por duas coisas, não apenas uma:

- **O bundle** — o seu projeto. Tabelas compiladas, hooks, funções e cron
  jobs, além de um manifesto gerado descrevendo o que eles precisam.
- **O runtime** — o motor. `@rebasepro/server`, distribuído como a imagem
  de contêiner publicada `rebasepro/server`.

Eles são construídos, versionados e distribuídos separadamente. Essa única decisão é de
onde tudo o mais nesta página se origina: como o motor não está embutido na imagem
da sua aplicação, ele pode ser substituído por baixo do seu projeto — para uma
correção de segurança, uma melhoria de desempenho, uma nova funcionalidade — sem
recompilar nada do que você escreveu.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  backend/schema/*.ts       ──►   dist-bundle/backend/schema/  ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/             + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

O runtime que você auto-hospeda é o mesmo runtime que o Rebase Cloud executa. Não
há uma versão separada de "plataforma", e nada sobre o plano gerenciado está
indisponível para alguém executando `docker compose up`.

## Construindo um bundle

```bash
rebase build
```

Isso regenera o schema do banco de dados a partir de suas tabelas, faz a checagem
de tipos e as compila, resolve os especificadores de importação para que o Node possa
carregar a saída diretamente e grava o diretório `dist-bundle/` contendo:

| Caminho | O que é |
| --- | --- |
| `manifest.json` | Gerado. O contrato que este bundle afirma satisfazer. |
| `package.json` | Gerado. As dependências de runtime do seu projeto. |
| `backend/schema/` | Tabelas compiladas: o `index` que as exporta e um módulo por tabela. |
| `backend/resources.js`, `backend/storage.js`, `backend/hooks.js` | Os módulos compilados que o runtime lê junto com as tabelas, quando o projeto os possui. |
| `backend/functions/` | Funções de servidor compiladas. |
| `backend/crons/` | Cron jobs compilados. |
| `backend/src/schema.generated.js` | Schema do banco de dados compilado. |

Vale a pena entender o manifesto, porque é ele que um runtime valida
antes de aceitar inicializar:

```jsonc
{
  "bundleFormat": 3,
  "runtime": { "range": "^1", "builtAgainst": "0.30.1", "contract": 2 },
  "schemaVersion": "v2:3f0c9a1e7d2b5c48",
  "kind": "backend",
  "entry": {
    "tables": "backend/schema",
    "resources": "backend/resources.js",
    "storage": "backend/storage.js",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "tables": ["authors", "posts", "tags", "users"],
  "hooks": { "native": false },
  "storage": { "authorize": true },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

<span class="since-badge" data-since="0.31">Desde 0.31</span> `bundleFormat`
3 e contrato de runtime 2: o schema é `entry.tables`, o diretório compilado
`backend/schema`, ao lado de `entry.resources`, `entry.storage` e
`entry.hooks`. `schemaVersion` começa com `v2:` — ele é calculado a partir das
tabelas compiladas.

`kind` é `backend` — inicializa o servidor, além de quaisquer aplicações estáticas em
`entry.static` — ou `static`, que serve esses arquivos estáticos e nada mais: sem
banco de dados, sem autenticação. O fato de um backend declarar suas tabelas em código ou
inspecioná-las a partir do banco de dados ativo não é um terceiro tipo; trata-se
simplesmente de saber se `entry.tables` está presente.

## Executando um bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

O comando `rebase start` carrega o bundle no mesmo processo, de modo que os sinais e
stack traces cheguem diretamente a você. Localmente, ele vincula as dependências já
instaladas ao bundle para que não haja uma segunda instalação; um deployment instala o
próprio `package.json` do bundle em vez disso.

## Compatibilidade

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Dois números de versão controlam se um bundle e um runtime podem funcionar juntos e,
propositadamente, eles não correspondem à versão do pacote.

**`bundleFormat`** é a estrutura em disco. Um runtime recusa um formato mais novo
em vez de carregá-lo pela metade. Um bundle mais antigo em um runtime mais recente continua
funcionando quando o layout permite — esse é o objetivo da separação — com uma
exceção: **um bundle de formato 1 ou formato 2 é recusado** por um runtime 0.31.
Esses bundles contêm `config/collections` — objetos `defineCollection` — e um runtime
que lê apenas `backend/schema` não tem com o que lê-los; inicializar um deles
inspecionaria o banco de dados em vez de servir as tabelas declaradas. A
recusa informa a correção: execute
[`rebase migrate collections-to-tables`](/docs/cli/schema/#rebase-migrate) no
código-fonte do projeto e, em seguida, recompile o bundle.

**`runtime.contract`** é a interface entre um bundle e o motor; o 0.31
a alterou para `2`. Dentro de uma mesma versão principal (major) do contrato, qualquer
bundle validado continua sendo válido. Versões de patch e minor são compatíveis
diretamente (drop-in); uma versão major não é, e o runtime recusará um bundle de
uma versão diferente em vez de iniciar e apresentar comportamento incorreto depois.

É por isso que atualizar o Rebase em um deployment auto-hospedado se resume a alterar uma tag:

```yaml
image: rebasepro/server:0.30.1   # a newer tag — your bundle is untouched
```

## O desenvolvimento usa o mesmo caminho

O comando `rebase dev` inicializa o mesmo runtime sobre o seu código-fonte TypeScript
em vez de um bundle compilado. O hot reload continua funcionando, e o desenvolvimento
reflete fielmente a produção porque ambos passam pelo mesmo fluxo de inicialização, em
vez de duas implementações que divergem.

Um projeto que precisa de algo que o runtime padrão não faz ainda pode escrever seu
próprio `backend/src/index.ts` e importar o servidor como uma biblioteca. O `rebase dev`
o detecta e o executa. Consulte [Servidor personalizado](/docs/backend/custom-server/) — você
abre mão do runtime padrão, mas não da superfície da API.

## O que o runtime lê do ambiente

O runtime é configurado inteiramente por variáveis de ambiente, pois esse é o formato
suportado por qualquer destino de deployment.

| Variável | Significado |
| --- | --- |
| `DATABASE_URL` | String de conexão para o banco de dados padrão. Obrigatória. |
| `JWT_SECRET` | Segredo de assinatura, com pelo menos 32 caracteres. Obrigatório em produção. |
| `CORS_ORIGINS` | Origens separadas por vírgula com permissão para chamar a API. Obrigatório em produção. |
| `PORT` | Porta a ser vinculada (bind). Padrão `3001` localmente, `8080` na imagem. |
| `REBASE_SERVICE_KEY` | Chave servidor-a-servidor concedendo acesso de administrador. |
| `REBASE_METRICS` | `true` para expor métricas do Prometheus em `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `ensure` — o padrão em todos os lugares, incluindo produção — executa a etapa de provisionamento aditivo; `none` não altera o schema. Qualquer outro valor recusa a inicialização, e a imagem do runtime também recusa `push`. |
| `REBASE_SERVE_STATIC` | Serve os arquivos estáticos do bundle a partir deste processo. Ativado por padrão. |

Vários bancos de dados e vários buckets são configurados adicionando o sufixo da
chave de origem à variável — consulte [Múltiplos bancos de dados e
buckets](/docs/backend/multiple-sources/).

## Endpoints que o runtime sempre serve

| Caminho | Finalidade |
| --- | --- |
| `GET /health` | Prontidão (Readiness). Realiza uma comunicação de ida e volta (round-trip) com o banco de dados. |
| `GET /livez` | Vivacidade (Liveness). Deliberadamente *não* acessa o banco de dados, para que uma instabilidade no banco de dados não faça um orquestrador encerrar um processo saudável. |
| `GET /api/meta/schema-version` | A versão atual do schema. Não autenticado — é um carimbo de versão, não um schema. |
| `GET /api/schema/tables` | As tabelas, conforme cada chamador pode visualizá-las — a partir do que o painel de administração é renderizado. Consulte [Endpoints](/docs/backend/endpoints/#schema). |
| `GET /api/meta/contract` | A versão do schema, o runtime e todas as tabelas conforme um administrador as vê. Requer `schema:read`. |
| `GET /metrics` | Métricas do Prometheus, quando `REBASE_METRICS=true`. |
