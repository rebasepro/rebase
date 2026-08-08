---
title: Runtime e Bundles
sidebar_label: Runtime e Bundles
description: Como um projeto Rebase se separa em um bundle de projeto e um runtime versionado, e por que essa separação é o que torna possíveis atualizações, aplicativos multi-repositório e hospedagem gerenciada.
---

## As duas metades de um deployment

Um deployment do Rebase é composto por duas coisas, e não apenas uma:

- **O bundle** — seu projeto. Coleções compiladas, hooks, funções e cron
  jobs, além de um manifesto gerado descrevendo o que eles precisam.
- **O runtime** — o motor. `@rebasepro/server`, distribuído como a imagem
  de contêiner `rebasepro/server` publicada.

Eles são construídos, versionados e distribuídos separadamente. É dessa única
decisão que decorre todo o resto nesta página: como o motor não está embutido
na imagem da sua aplicação, ele pode ser substituído por baixo do seu projeto —
para uma correção de segurança, uma melhoria de desempenho, um novo recurso —
sem reconstruir nada do que você escreveu.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

O runtime que você hospeda por conta própria é o mesmo runtime que o Rebase Cloud
executa. Não existe uma compilação de "plataforma" separada, e nada na camada
gerenciada deixa de estar disponível para quem executa `docker compose up`.

## Construindo um bundle

```bash
rebase build
```

Isso regenera o esquema do banco de dados a partir das suas coleções, realiza a
checagem de tipos e as compila, resolve os especificadores de importação para que
o Node possa carregar a saída diretamente e escreve em `dist-bundle/` contendo:

| Caminho | O que é |
| --- | --- |
| `manifest.json` | Gerado. O contrato que este bundle afirma satisfazer. |
| `package.json` | Gerado. As dependências de runtime do seu projeto. |
| `config/` | Coleções compiladas. |
| `backend/functions/` | Funções de servidor compiladas. |
| `backend/crons/` | Cron jobs compilados. |
| `backend/src/schema.generated.js` | Esquema do banco de dados compilado. |

Vale a pena entender o manifesto, pois é o que um runtime valida antes de
aceitar a inicialização:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.13.0", "contract": 1 },
  "schemaVersion": "v1:c5d97d0f96b7f87a",
  "kind": "backend",
  "entry": {
    "config": "config",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "hooks": { "native": false },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

`kind` é `backend` — inicializa o servidor, além de quaisquer aplicativos
estáticos em `entry.static` — ou `static`, que serve esses ativos e nada mais:
sem banco de dados, sem autenticação. Se um backend declara suas coleções no
código ou faz a introspecção delas a partir do banco de dados ativo não é um
terceiro tipo; é simplesmente uma questão de `entry.config` estar presente ou não.

## Executando um bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

O `rebase start` carrega o bundle no mesmo processo, para que sinais e stack
traces cheguem diretamente a você. Localmente, ele vincula as suas dependências
já instaladas ao bundle para que não haja uma segunda instalação; um deployment
instala o próprio `package.json` do bundle.

## Compatibilidade

Dois números de versão governam se um bundle e um runtime podem funcionar juntos,
e eles deliberadamente não são a versão do pacote.

**`bundleFormat`** é o layout no disco. Um runtime aceita qualquer bundle cujo
formato seja menor ou igual ao seu próprio, e recusa um mais recente em vez de
carregá-lo pela metade. Um bundle mais antigo em um runtime mais recente deve
continuar funcionando — esse é todo o propósito da separação, portanto, um
runtime lê todos os formatos que já lançou. Bundles do Formato 1, que nomeavam
este campo como `mode` e carregavam um único diretório estático, ainda
inicializam sem alterações.

**`runtime.contract`** é a interface entre um bundle e o motor. Dentro de uma
mesma versão major do contrato, qualquer bundle validado continua sendo validado.
Patches e versões minor são substituições diretas (drop-in); uma versão major não
é, e um runtime recusará um bundle de uma versão major diferente em vez de
iniciar e apresentar comportamentos incorretos mais tarde.

É por isso que atualizar o Rebase em um deployment self-hosted é apenas uma
mudança de tag:

```yaml
image: rebasepro/server:0.13.0   # was 0.12.0 — your bundle is untouched
```

## O desenvolvimento usa o mesmo caminho

O `rebase dev` inicializa o mesmo runtime sobre o seu código-fonte TypeScript em
vez de um bundle compilado. O hot reload continua funcionando, e o ambiente de
desenvolvimento reflete fielmente a produção porque ambos passam pelo mesmo
caminho de inicialização, em vez de duas implementações que se distanciam.

Um projeto que precisa de algo que o runtime padrão não faz ainda pode escrever
seu próprio `backend/src/index.ts` e importar o servidor como uma biblioteca.
O `rebase dev` o detecta e executa. Veja [Servidor customizado](/docs/backend/custom-server/) —
você perde o runtime padrão, não a superfície da API.

## O que o runtime lê do ambiente

O runtime é totalmente configurado por variáveis de ambiente, porque é isso com o
que todos os alvos de deployment concordam.

| Variável | Significado |
| --- | --- |
| `DATABASE_URL` | String de conexão para o banco de dados padrão. Obrigatório. |
| `JWT_SECRET` | Segredo de assinatura, pelo menos 32 caracteres. Obrigatório em produção. |
| `CORS_ORIGINS` | Origens separadas por vírgula permitidas a chamar a API. Obrigatório em produção. |
| `PORT` | Porta para vinculação (bind). Padrão `3001` localmente, `8080` na imagem. |
| `REBASE_SERVICE_KEY` | Chave servidor-para-servidor que concede acesso de administrador. |
| `REBASE_METRICS` | `true` para expor métricas do Prometheus em `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none`, `ensure` ou `push`. O padrão é `none` em produção. |
| `REBASE_SERVE_STATIC` | Serve os ativos estáticos do bundle a partir deste processo. Ativado por padrão. |

Múltiplos bancos de dados e múltiplos buckets são configurados adicionando o sufixo
da chave de origem à variável — veja [Múltiplos bancos de dados e buckets](/docs/backend/multiple-sources/).

## Endpoints que o runtime sempre serve

| Caminho | Finalidade |
| --- | --- |
| `GET /health` | Prontidão (Readiness). Realiza um round-trip no banco de dados. |
| `GET /livez` | Liveness. Deliberadamente *não* toca no banco de dados, para que uma oscilação temporária no banco de dados não faça o orquestrador encerrar um processo saudável. |
| `GET /api/meta/schema-version` | A versão atual do esquema. Sem autenticação — é um carimbo de versão, não um esquema. |
| `GET /api/meta/contract` | O contrato completo das coleções. Apenas para administradores. |
| `GET /metrics` | Métricas do Prometheus, quando `REBASE_METRICS=true`. |

---
