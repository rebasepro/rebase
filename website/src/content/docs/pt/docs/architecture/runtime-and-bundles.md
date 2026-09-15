---
sourceHash: 67566dbd11f6e659
title: Runtime e Bundles
sidebar_label: Runtime & Bundles
description: Como um projeto Rebase se divide em um bundle de projeto e um runtime versionado, e por que essa separação torna possíveis atualizações, aplicações multi-repositório e hospedagem gerenciada.
---

## As duas metades de um deployment

Um deployment do Rebase é composto por duas coisas, não apenas uma:

- **O bundle** — o seu projeto. Coleções, hooks, funções e tarefas cron compiladas,
  além de um manifesto gerado que descreve o que eles precisam.
- **O runtime** — o motor. `@rebasepro/server`, distribuído como a imagem de
  container publicada `rebasepro/server`.

Eles são construídos, versionados e distribuídos separadamente. Essa única decisão
é de onde tudo o mais nesta página decorre: como o motor não está embutido na
imagem da sua aplicação, ele pode ser substituído por baixo do seu projeto — para
uma correção de segurança, uma melhoria de desempenho ou um novo recurso — sem
reconstruir nada do que você escreveu.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

O runtime que você auto-hospeda é o mesmo runtime que o Rebase Cloud executa. Não
existe uma compilação separada de "plataforma", e nada sobre a camada gerenciada
está indisponível para quem executa `docker compose up`.

## Construindo um bundle

```bash
rebase build
```

Isso regenera o esquema do banco de dados a partir de suas coleções, realiza a
checagem de tipos e as compila, resolve os especificadores de importação para que
o Node possa carregar a saída diretamente e grava `dist-bundle/` contendo:

| Caminho | O que é |
| --- | --- |
| `manifest.json` | Gerado. O contrato que este bundle alega satisfazer. |
| `package.json` | Gerado. As dependências de runtime do seu projeto. |
| `config/` | Coleções compiladas. |
| `backend/functions/` | Funções de servidor compiladas. |
| `backend/crons/` | Tarefas cron compiladas. |
| `backend/src/schema.generated.js` | Esquema de banco de dados compilado. |

Vale a pena entender o manifesto, pois é o que um runtime valida antes de concordar
em inicializar:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.21.1", "contract": 1 },
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

`kind` é `backend` — inicializa o servidor, além de quaisquer aplicações estáticas
em `entry.static` — ou `static`, que serve esses assets e nada mais: sem banco de
dados, sem autenticação. Se um backend declara suas coleções no código ou faz
introspecção delas diretamente do banco de dados ativo não é um terceiro tipo; é
simplesmente uma questão de saber se `entry.config` está presente.

## Executando um bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carrega o bundle no próprio processo, permitindo que sinais e
stack traces cheguem diretamente a você. Localmente, ele vincula as dependências
já instaladas ao bundle para que não haja uma segunda instalação; já um deployment
instala o próprio `package.json` do bundle.

## Compatibilidade

Dois números de versão controlam se um bundle e um runtime podem trabalhar juntos,
e eles deliberadamente não são a versão do pacote.

**`bundleFormat`** é a estrutura no disco. Um runtime aceita qualquer bundle cujo
formato seja menor ou igual ao seu próprio, e recusa um mais recente em vez de
carregá-lo pela metade. Um bundle mais antigo em um runtime mais novo deve
continuar funcionando — esse é o objetivo principal da separação, portanto um
runtime lê todos os formatos que já distribuiu. Bundles de formato 1, que
chamavam este campo de `mode` e continham um único diretório estático, ainda
inicializam inalterados.

**`runtime.contract`** é a interface entre um bundle e o motor. Dentro de uma
mesma versão major do contrato, qualquer bundle validado continua funcionando.
Versões patch e minor são substituições diretas (drop-in); uma versão major não é,
e o runtime recusará um bundle de uma versão diferente em vez de inicializar e
apresentar comportamento inadequado mais tarde.

É por isso que atualizar o Rebase em um deployment auto-hospedado é apenas uma
mudança de tag:

```yaml
image: rebasepro/server:0.21.1   # a newer tag — your bundle is untouched
```

## O desenvolvimento usa o mesmo caminho

`rebase dev` inicializa o mesmo runtime sobre o seu código-fonte TypeScript em vez
de um bundle compilado. O hot reload continua funcionando, e o desenvolvimento
prevê com precisão a produção porque ambos utilizam um único caminho de
inicialização, em vez de duas implementações que divergem.

Um projeto que precisa de algo que o runtime padrão não oferece ainda pode
escrever seu próprio `backend/src/index.ts` e importar o servidor como uma
biblioteca. O `rebase dev` o detecta e o executa. Veja [Servidor personalizado](/docs/backend/custom-server/) —
você abre mão do runtime padrão, mas não da superfície da API.

## O que o runtime lê do ambiente

O runtime é configurado inteiramente por meio de variáveis de ambiente, pois esse
é o padrão comum a qualquer destino de deployment.

| Variável | Significado |
| --- | --- |
| `DATABASE_URL` | String de conexão para o banco de dados padrão. Obrigatória. |
| `JWT_SECRET` | Segredo de assinatura, com pelo menos 32 caracteres. Obrigatório em produção. |
| `CORS_ORIGINS` | Origens separadas por vírgula com permissão para chamar a API. Obrigatório em produção. |
| `PORT` | Porta a ser vinculada. Padrão `3001` localmente, `8080` na imagem. |
| `REBASE_SERVICE_KEY` | Chave servidor-para-servidor que concede acesso de administrador. |
| `REBASE_METRICS` | `true` para expor métricas do Prometheus em `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` deixa o esquema inalterado; qualquer outro valor — incluindo ausência de valor — executa a etapa aditiva de provisionamento. O padrão é `ensure` em todos os lugares, produção inclusa. |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos do bundle a partir deste processo. Ativado por padrão. |

Múltiplos bancos de dados e múltiplos buckets são configurados sufixando a variável
com a chave de origem — consulte [Múltiplos bancos de dados e buckets](/docs/backend/multiple-sources/).

## Endpoints que o runtime sempre disponibiliza

| Caminho | Finalidade |
| --- | --- |
| `GET /health` | Readiness (prontidão). Realiza uma comunicação completa (round-trip) com o banco de dados. |
| `GET /livez` | Liveness (atividade). Deliberadamente *não* consulta o banco de dados, para que uma oscilação momentânea no banco não faça um orquestrador encerrar um processo saudável. |
| `GET /api/meta/schema-version` | A versão atual do esquema. Sem autenticação — é um carimbo de versão, não um esquema. |
| `GET /api/meta/contract` | O contrato completo das coleções. Apenas para administradores. |
| `GET /metrics` | Métricas do Prometheus, quando `REBASE_METRICS=true`. |
