---
sourceHash: 236f1a01516e7d29
title: Runtime e Bundles
sidebar_label: Runtime & Bundles
description: Como um projeto Rebase se divide em um bundle de projeto e um runtime versionado, e por que essa separação é o que torna atualizações, aplicações multi-repo e hospedagem gerenciada possíveis.
---

## As duas metades de um deployment

Um deployment do Rebase é composto por duas coisas, e não apenas uma:

- **O bundle** — o seu projeto. Coleções, hooks, funções e cron jobs compilados,
  além de um manifesto gerado descrevendo o que eles precisam.
- **O runtime** — o motor. `@rebasepro/server`, distribuído como a imagem de
  contêiner publicada `rebasepro/server`.

Eles são construídos, versionados e distribuídos separadamente. É dessa única
decisão que todo o resto desta página deriva: como o motor não está embutido na
imagem da sua aplicação, ele pode ser substituído por baixo do seu projeto — para
uma correção de segurança, uma melhoria de desempenho, um novo recurso — sem
precisar recompilar nada do que você escreveu.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

O runtime que você auto-hospeda (self-host) é o mesmo runtime que o Rebase Cloud
executa. Não existe uma versão separada da "plataforma", e nada no plano gerenciado
fica indisponível para quem executa `docker compose up`.

## Construindo um bundle

```bash
rebase build
```

Isso regenera o schema do banco de dados a partir das suas coleções, realiza a
checagem de tipos e os compila, resolve os especificadores de importação para que
o Node possa carregar a saída diretamente, e grava em `dist-bundle/` contendo:

| Caminho | O que é |
| --- | --- |
| `manifest.json` | Gerado. O contrato que este bundle afirma satisfazer. |
| `package.json` | Gerado. As dependências em tempo de execução do seu projeto. |
| `config/` | Coleções compiladas. |
| `backend/functions/` | Funções de servidor compiladas. |
| `backend/crons/` | Cron jobs compilados. |
| `backend/src/schema.generated.js` | Schema do banco de dados compilado. |

Vale a pena entender o manifesto, pois é o que um runtime valida antes de
aceitar inicializar:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.20.0", "contract": 1 },
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

`kind` pode ser `backend` — inicializa o servidor, além de qualquer app estático
em `entry.static` — ou `static`, que serve esses recursos estáticos e nada mais:
sem banco de dados, sem autenticação. O fato de um backend declarar suas
coleções no código ou inspecioná-las diretamente a partir do banco de dados
ativo não é um terceiro tipo; é simplesmente se `entry.config` está presente
ou não.

## Executando um bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

O `rebase start` carrega o bundle no mesmo processo, permitindo que sinais e
stack traces cheguem diretamente até você. Localmente, ele faz o link das
dependências já instaladas no bundle, evitando uma segunda instalação; um
deployment instala o próprio `package.json` do bundle.

## Compatibilidade

Dois números de versão controlam se um bundle e um runtime podem funcionar juntos,
e eles deliberadamente não são a versão do pacote.

**`bundleFormat`** é a estrutura no disco. Um runtime aceita qualquer bundle cujo
formato seja menor ou igual ao seu, e recusa um mais recente em vez de carregá-lo
parcialmente. Um bundle mais antigo em um runtime mais recente deve continuar
funcionando — esse é todo o propósito da separação, portanto um runtime lê todos
os formatos que já distribuiu. Bundles no formato 1, que chamavam este campo de
`mode` e continham um único diretório estático, ainda inicializam sem alterações.

**`runtime.contract`** é a interface entre um bundle e o motor. Dentro de uma
mesma versão major do contrato, qualquer bundle que validou continua validando.
Atualizações de patch e minor são substituições diretas (drop-in); uma major não
é, e o runtime recusará um bundle de uma versão diferente em vez de iniciar e
apresentar comportamentos incorretos mais tarde.

É por isso que atualizar o Rebase em um deployment self-hosted resume-se a
alterar uma tag:

```yaml
image: rebasepro/server:0.20.0   # a newer tag — your bundle is untouched
```

## O desenvolvimento usa o mesmo caminho

O `rebase dev` inicializa o mesmo runtime sobre o seu código-fonte TypeScript em
vez de um bundle compilado. O hot reload continua funcionando, e o ambiente de
desenvolvimento reflete a produção com precisão, pois ambos passam pelo mesmo
fluxo de inicialização em vez de duas implementações divergentes.

Um projeto que precise de algo que o runtime padrão não oferece ainda pode
escrever seu próprio `backend/src/index.ts` e importar o servidor como uma
biblioteca. O `rebase dev` detecta isso e o executa. Veja
[Servidor personalizado](/docs/backend/custom-server/) — você abre mão do
runtime padrão, mas não da superfície da API.

## O que o runtime lê do ambiente

O runtime é configurado inteiramente por variáveis de ambiente, pois é o padrão
comum suportado por qualquer destino de deployment.

| Variável | Significado |
| --- | --- |
| `DATABASE_URL` | String de conexão para o banco de dados padrão. Obrigatório. |
| `JWT_SECRET` | Segredo de assinatura, com pelo menos 32 caracteres. Obrigatório em produção. |
| `CORS_ORIGINS` | Origens separadas por vírgula com permissão para chamar a API. Obrigatório em produção. |
| `PORT` | Porta para escuta. Padrão `3001` localmente, `8080` na imagem. |
| `REBASE_SERVICE_KEY` | Chave servidor-para-servidor que concede acesso de administrador. |
| `REBASE_METRICS` | `true` para expor métricas do Prometheus em `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` não altera o schema; qualquer outro valor — inclusive não definido — executa a etapa aditiva de provisionamento. O padrão é `ensure` em qualquer lugar, incluindo produção. |
| `REBASE_SERVE_STATIC` | Serve os recursos estáticos do bundle a partir deste processo. Ativado por padrão. |

Vários bancos de dados e vários buckets são configurados adicionando a chave da
fonte como sufixo à variável — veja [Múltiplos bancos de dados e buckets](/docs/backend/multiple-sources/).

## Endpoints que o runtime sempre serve

| Caminho | Propósito |
| --- | --- |
| `GET /health` | Prontidão (Readiness). Realiza uma operação de ida e volta (round-trip) no banco de dados. |
| `GET /livez` | Vivacidade (Liveness). Deliberadamente *não* acessa o banco de dados, para que uma oscilação momentânea no banco não faça um orquestrador encerrar um processo saudável. |
| `GET /api/meta/schema-version` | A versão atual do schema. Não autenticado — é um carimbo de versão, não o schema em si. |
| `GET /api/meta/contract` | O contrato completo da coleção. Apenas administradores. |
| `GET /metrics` | Métricas do Prometheus, quando `REBASE_METRICS=true`. |

---
