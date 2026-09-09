---
sourceHash: a4b27cb5ae61a96e
title: Runtime e Bundles
sidebar_label: Runtime & Bundles
description: Como um projeto Rebase se divide em um bundle de projeto e um runtime versionado, e por que essa separação é o que torna possíveis atualizações, aplicações multi-repo e hospedagem gerenciada.
---

## As duas metades de um deployment

Um deployment do Rebase é composto por duas coisas, não apenas uma:

- **O bundle** — seu projeto. Coleções compiladas, hooks, functions e tarefas cron, além de um manifesto gerado descrevendo o que eles precisam.
- **O runtime** — o motor (engine). `@rebasepro/server`, distribuído como a imagem de contêiner `rebasepro/server` publicada.

Eles são compilados, versionados e distribuídos separadamente. É dessa única decisão que todo o resto nesta página se origina: como o motor não está embutido na imagem da sua aplicação, ele pode ser substituído por baixo do seu projeto — para uma correção de segurança, uma melhoria de desempenho, um novo recurso — sem recompilar nada do que você escreveu.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

O runtime que você auto-hospeda é o mesmo runtime que o Rebase Cloud executa. Não existe uma versão de build separada para a "plataforma", e nada na camada gerenciada é indisponível para quem executa `docker compose up`.

## Gerando um bundle

```bash
rebase build
```

Isso regenera o esquema do banco de dados a partir das suas coleções, faz a verificação de tipos e as compila, resolve os especificadores de importação para que o Node possa carregar a saída diretamente e grava `dist-bundle/` contendo:

| Caminho | O que é |
| --- | --- |
| `manifest.json` | Gerado. O contrato que este bundle afirma atender. |
| `package.json` | Gerado. As dependências de runtime do seu projeto. |
| `config/` | Coleções compiladas. |
| `backend/functions/` | Funções de servidor compiladas. |
| `backend/crons/` | Tarefas cron compiladas. |
| `backend/src/schema.generated.js` | Esquema de banco de dados compilado. |

Vale a pena entender o manifesto, pois é ele que um runtime valida antes de aceitar inicializar:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.19.1", "contract": 1 },
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

`kind` pode ser `backend` — inicializa o servidor, além de quaisquer aplicações estáticas em `entry.static` — ou `static`, que serve apenas esses assets e nada mais: sem banco de dados, sem autenticação. Se um backend declara suas coleções no código ou faz introspecção delas a partir do banco de dados ativo não é um terceiro tipo; é simplesmente uma questão de `entry.config` estar presente ou não.

## Executando um bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

O `rebase start` carrega o bundle no mesmo processo, de modo que sinais e stack traces chegam diretamente a você. Localmente, ele vincula suas dependências já instaladas ao bundle para que não haja uma segunda instalação; um deployment, por sua vez, instala o próprio `package.json` do bundle.

## Compatibilidade

Dois números de versão controlam se um bundle e um runtime podem trabalhar juntos, e eles deliberadamente não são a versão do pacote.

**`bundleFormat`** é o layout em disco. Um runtime aceita qualquer bundle cujo formato seja menor ou igual ao seu próprio, e recusa um mais recente em vez de carregá-lo parcialmente. Um bundle mais antigo em um runtime mais recente deve continuar funcionando — esse é o objetivo principal da separação, portanto um runtime lê todos os formatos já lançados. Bundles de formato 1, que chamavam este campo de `mode` e continham um único diretório estático, ainda inicializam inalterados.

**`runtime.contract`** é a interface entre um bundle e o motor. Dentro de uma mesma versão major do contrato, qualquer bundle validado continua sendo válido. Patches e minors são substituições diretas (drop-in); uma versão major não é, e o runtime recusará um bundle de uma versão diferente em vez de iniciar e apresentar comportamentos incorretos mais tarde.

É por isso que atualizar o Rebase em um deployment auto-hospedado se resume a alterar uma tag:

```yaml
image: rebasepro/server:0.19.1   # a newer tag — your bundle is untouched
```

## O desenvolvimento usa o mesmo caminho

O `rebase dev` inicializa o mesmo runtime sobre o seu código-fonte TypeScript em vez de um bundle compilado. O hot reload continua funcionando, e o ambiente de desenvolvimento reflete a produção porque ambos passam por um único caminho de inicialização, em vez de duas implementações que divergem ao longo do tempo.

Um projeto que precisa de algo que o runtime padrão não oferece ainda pode escrever seu próprio `backend/src/index.ts` e importar o servidor como uma biblioteca. O `rebase dev` o detecta e executa. Consulte [Servidor customizado](/docs/backend/custom-server/) — você perde o runtime padrão, mas não a superfície da API.

## O que o runtime lê do ambiente

O runtime é configurado inteiramente por variáveis de ambiente, pois é com isso que todos os destinos de deployment concordam.

| Variável | Significado |
| --- | --- |
| `DATABASE_URL` | String de conexão para o banco de dados padrão. Obrigatório. |
| `JWT_SECRET` | Chave secreta de assinatura, com pelo menos 32 caracteres. Obrigatório em produção. |
| `CORS_ORIGINS` | Origens separadas por vírgula com permissão para chamar a API. Obrigatório em produção. |
| `PORT` | Porta a ser vinculada. Padrão `3001` localmente, `8080` na imagem. |
| `REBASE_SERVICE_KEY` | Chave de comunicação server-to-server que concede acesso de administrador. |
| `REBASE_METRICS` | `true` para expor métricas do Prometheus em `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` não altera o esquema; qualquer outro valor — incluindo não definido — executa o passo de provisionamento aditivo. O padrão é `ensure` em todos os ambientes, incluindo produção. |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos do bundle a partir deste processo. Ativado por padrão. |

Vários bancos de dados e vários buckets são configurados adicionando o sufixo da chave de origem à variável — consulte [Múltiplos bancos de dados e buckets](/docs/backend/multiple-sources/).

## Endpoints que o runtime sempre disponibiliza

| Caminho | Propósito |
| --- | --- |
| `GET /health` | Prontidão (Readiness). Realiza um teste de ida e volta (round-trip) com o banco de dados. |
| `GET /livez` | Vivacidade (Liveness). Deliberadamente *não* acessa o banco de dados, para que uma oscilação momentânea do banco não faça um orquestrador encerrar um processo saudável. |
| `GET /api/meta/schema-version` | A versão atual do esquema. Não autenticado — é apenas um carimbo de versão, não o esquema em si. |
| `GET /api/meta/contract` | O contrato completo das coleções. Apenas para administradores. |
| `GET /metrics` | Métricas do Prometheus, quando `REBASE_METRICS=true`. |

---
