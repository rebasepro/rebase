---
sourceHash: 7c4aa80f1caf1225
slug: pt/docs/compatibility
title: Compatibilidade
description: O que o Rebase promete entre versões e o que não promete — os seis contratos versionados, como cada um falha e o que ainda pode mudar em uma versão minor.
---

O que o Rebase promete entre versões e o que não promete.

Este é o documento a ser lido antes de alterar qualquer coisa da qual um projeto implantado ou um tenant em execução no Rebase Cloud já dependa. É também a resposta honesta para "se eu desenvolver com o Rebase hoje, o que vai quebrar para mim mais tarde?"

## O que "beta" significa aqui

O Rebase está em beta público. A maioria dos projetos usa essa palavra para significar "qualquer coisa pode quebrar", o que não diz nada com o qual o leitor possa se planejar, então aqui está o limite que este projeto realmente estabelece:

> **A API contra a qual você escreve pode mudar em uma versão minor, com uma entrada no changelog.
> Seus dados não podem quebrar silenciosamente.**

A primeira metade é o comportamento comum de versões `0.x` e é descrita abaixo. A segunda metade é a parte que vale a pena conferir, porque é uma afirmação sobre mecanismos em vez de intenções: os contratos versionados na próxima seção são carimbados em um artefato ou banco de dados, cada um é verificado na inicialização (boot) ou na ingestão, e cada um **falha de forma ruidosa e específica** em vez de degradar. Um push de schema que removeria uma coluna é recusado por um gate destrutivo (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e o próprio caminho de upgrade é um teste: `upgrade-e2e.test.ts` restaura bancos de dados como versões anteriores os deixaram, executa o caminho de migração atual sobre cada um e assegura que as linhas sobrevivem — não apenas que a inicialização ocorreu com sucesso.

O que o beta de fato significa: recursos ainda estão ausentes, alguns subsistemas são mais novos que outros, e a natureza de uma aresta a ser lapidada é que algo está ausente ou é desajeitado, não que algo seja corrompido silenciosamente. Quais subsistemas são quais é algo publicado e datado, em vez de ser deixado para você descobrir — a tabela abaixo é essa publicação.

## Prontidão por subsistema

**Última revisão em 14 de setembro de 2026, com base na versão 0.21.0.** Releia a cada minor; uma classificação que não mudou em três releases ou está consolidada ou foi esquecida, e esta nota está aqui para que a diferença seja verificada.

As três classificações significam:

- **Stable** — o formato está consolidado e coberto por um gate no CI. Ele ainda pode receber recursos; não será redesenhado debaixo de você dentro da 0.x, e uma alteração que quebraria você será anunciada no changelog.
- **Beta** — funciona e é usado em produção, e algo nele é sabidamente inacabado: um limite que você pode atingir, uma aresta incômoda, uma decisão de design ainda não tomada. A parte inacabada é indicada nas notas, porque "beta" por si só não diz nada com o qual você possa se planejar.
- **Experimental** — lançado para que possa ser usado e reportado. Espere encontrar partes pelas quais ninguém passou ainda.

| Subsistema | Classificação | Em que a classificação se baseia |
|---|---|---|
| REST API + SDK gerado | Stable | O contrato de rede (wire contract) é versionado e validado por gates; `client-sdk-e2e` executa register → sign-in → leituras com escopo de RLS → refresh → storage → realtime de ponta a ponta |
| Auth — e-mail/senha, OAuth, OIDC, magic link, código de uso único | Stable | Doze provedores OAuth são fornecidos. O schema de auth é um contrato versionado, carimbado e verificado no boot |
| Auth — MFA (TOTP) | Beta | Registro (enrolment), verificação e recuperação funcionam e são testados. A rotação de chaves está implementada para a chave de criptografia; não há interface administrativa para redefinir o fator de um usuário bloqueado |
| Row-level security (RLS) | Stable | O pilar central do produto. `pnpm rls:check` audita um banco de dados ativo em quinze verificações, e a suíte e2e de RLS é executada a cada push |
| Storage | Stable | Local, S3 e GCS. Bloqueio por padrão (default-deny) em produção desde 0.17.0, e o scaffold inclui um hook de autorização |
| Realtime | **Beta** | As inscrições são associadas apenas pelo caminho da collection, portanto N inscritos em uma collection custam N refetches com escopo de RLS por escrita. Isso limita uma implantação a algumas centenas de inscritos simultâneos. Correto em qualquer escala; custoso além desse ponto |
| Busca vetorial (pgvector) | Beta | Cada coluna de vetor recebe um índice HNSW para distância de cosseno por padrão, ajustável por propriedade por meio de `VectorIndexConfig` (método, distâncias, parâmetros de build) ou desativado, o que resulta em uma varredura exata. O pgvector não pode indexar uma coluna com mais de 2.000 dimensões, portanto essas ficam sem índice e realizam varredura |
| Sincronização offline | Beta | As mutações carregam chaves de idempotência respeitadas pelo servidor, e os defeitos de perda de dados encontrados na auditoria de julho foram corrigidos. O modelo de conflito é last-write-wins sem mesclagem por campo |
| Histórico de entidades | Stable | Baseado em snapshots, validado por sua própria suíte |
| Functions e crons | Stable | O ponto de entrada portátil (`@rebasepro/server/functions`) é um contrato versionado com sua própria seção de superfície de API |
| Servidor MCP + habilidades de agente | Beta | `@rebasepro/mcp` executa via stdio: cinquenta e três ferramentas, autenticação bearer por projeto, ferramentas destrutivas recusam alvos não locais a menos que haja opt-in. Desde a versão 0.21, o servidor também pode montar um endpoint `/mcp` remoto — OAuth 2.1, dezessete ferramentas de dados (as quatro de apps salvos, experimentais), cada chamada sob o próprio RLS do usuário autenticado — desativado a menos que `REBASE_MCP_ENABLED=true`, e apenas para Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Usado diariamente em projetos reais. O suporte a branches está presente no pacote OSS e deliberadamente não exposto no Rebase Cloud, porque mover uma implantação ativa para um branch ainda não tem um fluxo definido |
| CMS + painel de administração | Beta | Completo para CRUD, relações, campos de storage e roles. **A tabela de dados não possui semântica de grid** — sem `role`, sem `aria-rowindex`, `tabIndex` removido — de modo que usuários de teclado e leitores de tela não conseguem operar a visualização principal. Sem rascunhos, sem conteúdo por localidade (locale), sem rich text em blocos |
| Banco de dados de desenvolvimento gerenciado PGlite | Beta | `rebase dev` com configuração zero e sem Docker. Uma sessão por vez, portanto as requisições são serializadas e a concorrência não pode ser reproduzida nele; comandos com suporte do Atlas (`db push`, `generate`, `migrate`) planejam contra um segundo PGlite temporário iniciado para o comando; `db branch` não funciona lá e avisa isso |
| Helm chart | Beta | Renderiza a topologia de processos separados e é publicado no registro OCI a cada release. O padrão continua sendo um único contêiner |
| `@rebasepro/server-mongo` | **Experimental** | Um driver funcional com realtime via change-stream e histórico por snapshots. **Sem row-level security** — todo o modelo de isolamento acima não se aplica a ele — e sem relações. Change streams precisam de um replica set: em um `mongod` standalone nada os substitui, de modo que uma inscrição enxerga escritas feitas por meio daquele processo do Rebase e perde todas as outras. Sem MFA: o registro responde 501, e as verificações respondem "no factor", então o login nunca solicita um. A agregação do admin não pode ter uma collection como alvo — ela lê o nome de um estágio `$from` que o MongoDB não possui —, portanto não retorna nada |
| `@rebasepro/firebase` | Experimental | Executa o painel de administração e o SDK contra o Firestore. Sem RLS, sem interface SQL; o conjunto de recursos do Postgres não é transferido. O driver do Firestore ignora grupos de filtros `or(...)`/`and(...)`, então uma consulta que usa um lê todas as linhas permitidas por seus filtros simples |
| Rebase Cloud | **Beta privado** | Ativo, executando tenants reais, liberado em lotes. Não é self-service |

Duas entradas acima são o custo honesto de publicar esta tabela: o refetch do realtime e a acessibilidade da tabela de dados são defeitos em aberto, não itens de roadmap, e ambos estão listados em vez de deixados para o leitor descobrir.

Esta tabela é o que existe. O que ainda não existe está no
[roadmap](https://rebase.pro/roadmap), uma entrada por issue do GitHub, com o
subconjunto necessário para a versão 1.0 demarcado.

## A promessa da 0.x

O Rebase está na versão `0.x`. Esta seção foi escrita para ser válida para cada release 0.x em vez de apenas para uma delas, para que não fique desatualizada a cada corte de versão. **Breaking changes na API TypeScript criada ainda são permitidas em versões minor**, e o changelog é onde elas são anunciadas. O que
*não* é permitido quebrar silenciosamente é o conjunto de contratos versionados abaixo: cada
um é carimbado em um artefato ou banco de dados, cada um é verificado na inicialização (boot) ou na ingestão, e cada um falha **de forma ruidosa e específica** em vez de degradar.

Essa distinção é toda a promessa. Uma exportação renomeada custa a você um erro de compilação e cinco minutos. Um bundle que inicializa contra o runtime errado e serve dados sutilmente incorretos custa a você um incidente, e os contratos existem para que a segunda categoria não possa acontecer silenciosamente.

O Rebase Cloud consome exatamente esses contratos e nada mais. Qualquer coisa não listada aqui é um detalhe de implementação do qual a plataforma não depende.

### Badges de versão e canaries

A documentação é publicada a partir da branch `main`, portanto uma página pode descrever algo que nenhuma release estável possui ainda. Uma badge *Since* indica a primeira release estável que a contém, e o texto ao lado informa o que a release anterior faz.

Um canary é um build da `main` numerado de acordo com a release para a qual está caminhando: `0.25.0-canary.g<commit>` é a `main` naquele commit, após a 0.24.0 e antes da 0.25.0, e `rebase upgrade --to canary` instala o mais recente. Ele traz tudo o que havia chegado à `main` quando foi gerado, portanto uma badge indicando sua versão se aplica a você, e a nota sobre a release anterior descreve a release estável da qual você veio.

## Os contratos versionados

Os valores abaixo são lidos diretamente do código-fonte; trate as referências de arquivos como a verdade e esta tabela como o mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado em | Verificado em | Direção de compatibilidade |
|---|---|---|---|---|
| 1 | Intervalo `rebase` em `rebase.json` | no projeto do usuário | CLI no build | o projeto declara quais runtimes aceita |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatibilidade com versões anteriores (backward compatible)** — o novo runtime lê bundles antigos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mesmo arquivo | mesmo arquivo | **correspondência exata, em ambas as direções** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | no boot, contra `rebase.schema_meta` | **apenas para frente (forward only)** — o novo runtime migra bancos de dados antigos |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado pelo SDK como `x-rebase-schema` quando configurado | consultivo — identifica contra qual schema um cliente foi compilado |
| 6 | Identificadores derivados de banco de dados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — um nome emitido por uma release nunca é rederivado |

### 1 — `rebase` em `rebase.json`

Um intervalo semver, lido como `engines` em um `package.json`: quais versões de runtime este projeto aceita. Denominado `rebase` em vez de `runtime` deliberadamente, porque `runtime` já significa *quem é o dono do processo* (`managed` | `custom`) em uma aplicação.

### 2 — `BUNDLE_FORMAT_VERSION` (atualmente 2)

O layout em disco de um bundle compilado. Um runtime aceita qualquer bundle cujo formato seja **menor ou igual ao** seu próprio, o que permite ao nível gerenciado mover um tenant para uma nova imagem sem que ninguém precise recompilar o projeto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` sendo um único diretório, `entry.admin` para um admin empacotado.
- **2** — `kind: "backend" | "static"`, `entry.static` sendo uma lista, `entry.admin` removido. O formato 1 ainda é lido, via `upgradeLegacyManifest`.

**Incremente-o quando** o layout mudar de tal forma que um runtime mais antigo interprete incorretamente um bundle mais recente. O incremento é o que converte "inicializa e não serve nada" em uma recusa de inicialização.

### 3 — `RUNTIME_CONTRACT_VERSION` (atualmente 1)

O major do contrato bundle↔runtime. Distinto da versão do pacote `@rebasepro/server`, que pode lançar qualquer número de minors e patches enquanto este permanece inalterado.

**Leia isto antes de mexer nele.** A verificação é `!==`, não `>`:

> um bundle que tem como alvo o contrato *N* executa **apenas** em um runtime que implementa *N*

portanto, incrementá-lo invalida **todos os bundles já construídos**, todos de uma vez, até que cada um seja recompilado. Essa é a severidade intencional — é a alavanca de "nada antigo pode rodar aqui" —, mas significa que um incremento é uma migração em toda a frota, não uma nota de lançamento. Para a camada gerenciada, ele deve ser sequenciado com a recompilação do bundle de cada tenant.

Se uma alteração for *aditiva* e os bundles antigos continuarem corretos, ela requer `BUNDLE_FORMAT_VERSION` (ou nada), e não este.

### 4 — `AUTH_SCHEMA_VERSION` (atualmente 2)

Carimbado em `rebase.schema_meta` e comparado na inicialização. Um runtime **recusa-se a iniciar** em relação a um banco de dados migrado por uma versão mais recente do framework, em vez de operar em uma estrutura que ele não compreende — durante um rolling deploy, essa é a diferença entre metade da frota apresentar erros e metade da frota corromper dados.

A migração progressiva (forward migration) é automática: `ensureAuthTablesExist` atualiza um banco de dados mais antigo. Observe que esse bloco de migração é deliberadamente envolvido em `try/catch` e registra logs em vez de lançar exceções — uma inicialização capenga é melhor que um crash loop —, portanto **"ele inicializou" não prova nada**. Cada asserção na suíte de upgrade lê o catálogo ou os dados.

**Incremente-o quando** uma migração não puder ser ignorada por um runtime mais antigo. Não incremente para uma coluna aditiva e compatível com versões anteriores; há um exemplo prático desse julgamento em `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Um hash das definições de collections compiladas, emitido no manifesto do bundle e replicado por um SDK gerado no cabeçalho `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Ele existe para que a plataforma possa dizer "este aplicativo foi construído contra um schema mais antigo" em vez de falhar misteriosamente na primeira requisição.

`rebase generate-sdk` escreve o valor em `schema.meta.ts`; passe-o para o cliente enviá-lo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

O backend lê esse cabeçalho em cada requisição de dados. A divergência (drift) nunca recusa uma chamada — um SDK um schema atrás geralmente ainda é compatível, e lançar o backend antes do frontend é a ordem normal de deploy —, mas quando uma requisição falha com um 400 ou 404, o erro carrega a divergência como sua causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

Assim, uma coluna renomeada é interpretada como "seu SDK está desatualizado, regenere-o" em vez de um campo que seus próprios tipos insistem que existe. Uma requisição bem-sucedida nunca é notificada.

Ele abrange **apenas collections**. A edição de um hook ou function não altera o contrato do cliente e não deve invalidar todos os SDKs gerados.

### Quem está chamando

Mais dois sinais de identificação, nenhum dos quais bloqueia nada por conta própria:

- **`GET /api/meta/schema-version`** não é autenticado e responde com o `schemaVersion` do projeto *e* seu `runtime` (`version` e `contract`). Um job de CI comparando seu SDK gerado com um projeto em execução não precisa de credenciais, assim como um cliente perguntando com qual runtime está se comunicando.
- **`User-Agent: rebase-cli/<version>`** vai em todas as requisições do `rebase cloud`. O formato de transmissão (wire format) do plano de controle avança mais rápido do que o publicado no npm, portanto ele precisa ser capaz de responder a um cliente antigo com `CLI_TOO_OLD` e a versão mínima — o que só pode fazer para um chamador que declare quem é.

### 6 — Identificadores derivados de banco de dados

Todo nome que este framework calcula por si mesmo em vez de ser informado: uma coluna de chave estrangeira, uma restrição (constraint) de chave estrangeira, uma tabela de junção e suas duas colunas de chave, um tipo enum, um nome de policy, a coluna `snake_case` de uma propriedade em `camelCase`.

> **Um identificador derivado é congelado no momento em que uma release o emite.**

Não "congelado até a próxima versão major" — congelado. A justificativa é diferente dos outros cinco contratos, e mais forte. Aqueles são versionados, de modo que uma divergência pode ser *detectada* e recusada. Este não pode: o nome é gravado no banco de dados do cliente no dia em que ele faz o deploy, e não há carimbo de versão em uma coluna. Cada banco de dados provisionado por qualquer release já lançada carrega o que quer que ela tenha derivado, e nenhum código neste repositório pode intervir e renomear todos eles.

A versão 0.13 é o exemplo prático. `generateForeignKeyName` aprendeu a singularizar adequadamente — `categorie_id` → `category_id`, `addres_id` → `address_id` —, o que é indiscutivelmente uma derivação melhor, e isso quebrou todos os bancos de dados antigos que tinham um plural irregular. O boot-ensure migrou a coluna, portanto os dados sobreviveram; o `schema.generated.ts` commitado do projeto não, e o boot morreu em uma coluna que existia. Três commits, um novo teste de seam e uma entrada permanente nas notas de upgrade, em troca de um nome de coluna mais bonito que ninguém havia pedido.

**Se uma derivação estiver genuinamente errada**, ela muda para collections criadas *depois*, sob uma estratégia de nomenclatura registrada no projeto — nunca retroativamente, e nunca como efeito colateral de melhorar a função subjacente.

**A única substituição legítima** é uma alteração que faz o código concordar com um nome que o banco de dados *já possui*. O exemplo prático é o truncamento de identificadores: o Postgres trunca silenciosamente um identificador para 63 bytes, de modo que um nome de constraint derivada mais longo nunca foi o nome no catálogo — a derivação estava descrevendo um objeto que não existia sob aquela grafia, e o boot-ensure reemitia `ADD CONSTRAINT` a cada inicialização porque sua comparação nunca correspondia. Truncar na construção altera o que este repositório *deriva* e não altera em nada o que qualquer banco de dados implantado *contém*. Esse é o teste a ser aplicado: não "o novo nome é melhor", mas "algum banco de dados existente precisa ser alterado".

O outro caso em que um nome pode mudar é um conjunto de nomes que nunca poderiam existir simultaneamente. Uma regra abrangendo várias operações em uma tabela de 42 bytes ou mais derivava `<table>_default_admin_write_insert`, `_update` e `_delete`, e todas as três eram truncadas para os mesmos 63 bytes. O Postgres armazenava uma policy, DELETE, e recusava todos os INSERT e UPDATE de admin. Somente quando os nomes de uma regra colidem dessa forma eles são derivados com o sufixo primeiro, como `<head>_<hash8>_<op>`. Todo nome que funciona hoje mantém sua grafia. O próximo boot ou push descarta a policy truncada única e cria uma policy para cada operação.

A única coisa que é sempre segura é *reconhecer* um nome antigo para migrá-lo: `legacyForeignKeyName` existe para ser detectado, nunca para ser gerado, e a baseline também fixa essas detecções. Remover uma reverte silenciosamente a migração de qualquer banco de dados que ainda carregue essa grafia.

**O gate.** `tooling/scripts/derived-names.mts` executa uma fixture de teste de estresse de nomenclatura — plurais irregulares, terminação em `ss`, uma sigla, uma junção a partir de um slug plural, substituições explícitas, um slug longo o suficiente para ser truncado — através de ambos os geradores de DDL de schema e renderiza cada identificador que qualquer um deles nomeia:

```bash
pnpm check:derived-names
```

Uma linha alterada ou removida falha como uma quebra de contrato, com a grafia antiga e a nova lado a lado. Uma alteração puramente aditiva também falha, mas com a mensagem "regenerate" — para que a baseline não sofra derivações debaixo de ninguém.

Ela também fixa que o `rebase db push` e o boot-ensure do runtime gerenciado derivem os *mesmos* nomes, o que é um segundo contrato oculto dentro do primeiro: eles compilam as mesmas collections por meio de códigos diferentes, e um projeto que passou por push uma vez e foi inicializado depois não deve acabar com dois schemas.

## O que *não* está congelado

Dito claramente, para que ninguém deduza uma promessa que nunca foi feita:

- A API TypeScript criada — configuração de collections, opções de `initializeRebaseBackend`, props de admin, nomes de métodos do SDK. Breaking changes chegam em versões minor e são anunciadas no changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — estes mudam mais rápido e têm menos consumidores.
- Qualquer coisa sob o `src/` de um pacote que não seja reexportada a partir de seu barrel. `packages/client/src/index.ts` traz uma nota explicando que sua lista de exportações é mantida cuidadosamente justamente para que uma exportação interna não se torne pública por acidente.
- O schema do banco de dados das *suas* collections. Esse pertence a você; o Rebase é proprietário apenas do schema `rebase` (e, em um banco de dados provisionado antes da 0.13, do antigo schema `auth` até que o boot o desative).

## Os gates que garantem isso

Nada do que foi dito acima é convenção — cada item possui um teste que falha quando é quebrado:

| Gate | O que ele fixa |
|---|---|
| `pnpm verify:corpus` | todos os formatos de bundle já lançados, inicializados no runtime atual. As fixtures em `tests/fixtures/bundles/` são **escritas à mão e congeladas** — uma fixture que o builder regenera muda sempre que o builder muda |
| `pnpm verify:selfhost` | um bundle real compilado, empacotado, inicializado e requisitado como um navegador faria |
| `upgrade-e2e.test.ts` | schemas de banco de dados antigos (`schema-snapshots/`) recebidos pelo runtime atual |
| `tests/e2e/tests/cli-init-e2e.ts` | um projeto gerado por scaffold instalado a partir de **tarballs reais**, não de links de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | o caminho do usuário final: register → sign in → leituras com escopo de RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | cada nome de coluna, constraint, junção, enum e policy que o framework deriva — e que o boot e o `db push` os derivem de forma idêntica |
| `pnpm rls:check` | as policies do schema gerado |
| `pnpm check:api-surface` | cada exportação, e seus membros, dos cinco pacotes fornecidos pela imagem — `@rebasepro/server`, `types`, `client`, `common`, `utils` — mais o ponto de entrada `@rebasepro/server/functions`, contra as seis seções de `contracts/server.api.txt`. Esses são os pacotes que `infra/docker/entrypoint.mjs` conecta via symlink sobre as próprias cópias de um bundle implantado, portanto remover uma exportação de um deles não é um erro de compilação para ninguém — é uma falha de inicialização em toda a frota, durante um rollout que ninguém pediu |
| `pnpm test:gates` | os próprios testes dos gates, sobre fixtures — quarenta e sete arquivos, incluindo `check:api-surface` e a verificação de release-bump abaixo — para que um gate que deixe de enxergar o que protege falhe aqui. O `check:api-surface` passou toda a sua existência incapaz de ver um membro desaparecer de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que o nível de bump sob o qual uma release é lançada corresponde ao que a release fez com as baselines acima — executado por `publish.yml` antes que o changelog seja carimbado |
| CI do saas | o plano de controle compilado contra a `main` deste repositório, em seus próprios pushes e nightly |

**Grave uma fixture de bundle e um snapshot de schema uma vez por release.** O valor de ambos os conjuntos (corpora) reside inteiramente em quão longe no tempo o mais antigo alcança, e nenhum deles pode ser preenchido retroativamente depois.

### Ainda não cobertos por gates

A tabela acima é o que está garantido. Estas são as partes da política que nada garante ainda, listadas para que ninguém veja uma promessa nelas:

- **Sem janela de descontinuação (deprecation) ou suporte.** Enquanto o Rebase for `0.x`, não há regra escrita sobre por quanto tempo uma exportação descontinuada sobrevive antes da remoção, ou por quanto tempo uma versão minor anterior recebe correções. Correções de segurança chegam apenas na versão minor mais recente.
- **O formato de transmissão HTTP não possui gate.** Nenhum script `check:*` compara os formatos de requisição e resposta contra uma baseline da forma como `check:api-surface` compara exportações; uma alteração no formato de resposta só é detectada por uma suíte e2e que por acaso a leia.
- **As flags da CLI não possuem baseline de compatibilidade.** O verificador de documentação falha quando uma flag usada pelas skills, pelos exemplos ou pelo site de marketing desaparece; nada nota se qualquer outra flag sumir ou mudar de significado.
- **Uma release de CI não registra nenhum dos conjuntos (corpus).** O fluxo de publicação não registra fixture de bundle nem snapshot de schema; apenas o script local de release tenta fazer isso, e ele apenas avisa em vez de parar quando não consegue. Da versão 0.18 até a 0.21 não há nenhum snapshot de projeto registrado.
- **A superfície de exportação é um gate, não um contrato.** Se as exportações públicas dos pacotes fornecidos pelo runtime se tornarão um sétimo contrato numerado — declarado como a baseline de `check:api-surface`, aditivamente compatível dentro de um major de contrato — é uma decisão em aberto.

## Alterando um contrato

1. Decida qual dos seis ele é. A maioria das alterações não é nenhum deles — mas "nenhum dos seis" não significa "incontestável". Remover ou renomear uma exportação de `@rebasepro/server`, ou um membro dela, não é nenhum dos seis e é a alteração mais perigosa de todo o repositório, porque o código que ela quebra já está compilado e não será recompilado. `pnpm check:api-surface` é o que segura essa linha; se isso se tornará um sétimo contrato numerado é uma decisão em aberto (consulte *Ainda não cobertos por gates*, acima).
2. Adicione uma fixture ou snapshot para a estrutura **antiga** primeiro e veja o teste passar.
3. Faça a alteração e incremente a constante.
4. Confirme que a fixture antiga ainda passa ou que agora ela falha *com a mensagem que o usuário precisaria*. Ambos são resultados válidos; o silêncio não é.
5. Para o contrato 3, planeje a recompilação de cada bundle implantado antes de realizar o merge.
6. O contrato 6 é a exceção aos passos 3 e 4: não há constante para incrementar e nenhuma versão para recusar, pois uma coluna não carrega carimbo de versão. O passo que os substitui é decidir não fazer a alteração — consulte a seção acima para ver como é a alternativa.

## Relacionado

- [Atualizações](/docs/upgrading/) — o que realmente quebrou, release por release
- [Changelog](/docs/changelog/) — cada alteração, incluindo as que não quebraram nada
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — o formato de bundle contra o qual um projeto implantado já foi construído
