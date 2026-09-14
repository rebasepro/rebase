---
sourceHash: ec13f8f9c203aae2
slug: pt/docs/compatibility
title: Compatibilidade
description: O que o Rebase promete entre versões e o que não promete — os seis contratos versionados, como cada um falha e o que ainda pode mudar em uma versão minor.
---

O que o Rebase promete entre versões, e o que não promete.

Este é o documento a ser lido antes de alterar qualquer coisa da qual um projeto
implantado ou um tenant em execução no Rebase Cloud já dependa. É também a resposta
honesta para "se eu construir no Rebase hoje, o que vai quebrar sob meus pés mais tarde?"

## O que "beta" significa aqui

O Rebase está em beta público. A maioria dos projetos usa essa palavra para significar
"qualquer coisa pode quebrar", o que não diz nada a um leitor com o qual ele possa se
planejar; portanto, aqui está a linha que este projeto realmente define:

> **A API contra a qual você escreve pode mudar em uma versão minor, com uma entrada no changelog.
> Seus dados não podem quebrar silenciosamente.**

A primeira metade é o comportamento comum de `0.x` e é descrita abaixo. A segunda metade
é a parte que vale a pena verificar, pois é uma afirmação sobre mecanismos em vez de
intenções: os contratos versionados na próxima seção são carimbados em um artefato ou banco
de dados, cada um é verificado na inicialização (boot) ou na entrada (intake), e cada um
**falha de forma ruidosa e específica** em vez de degradar. Um push de schema que removeria
uma coluna é recusado por um gate destrutivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e o próprio caminho de
atualização é um teste: `upgrade-e2e.test.ts` restaura bancos de dados como versões mais
antigas os deixaram, executa o caminho de migração atual sobre cada um e assegura que as
linhas sobrevivam — e não apenas que a inicialização tenha ocorrido.

O que beta realmente significa: recursos ainda estão ausentes, alguns subsistemas são mais
novos que outros, e o formato de uma aresta bruta é que algo está ausente ou incômodo, não
que corrompa algo silenciosamente. Quais subsistemas são quais é algo publicado e datado
em vez de deixado para ser descoberto — a tabela abaixo é essa publicação.

## Prontidão por subsistema

**Última revisão em 14 de setembro de 2026, com base na 0.21.0.** Releia a cada minor; uma
classificação que não mudou em três lançamentos está consolidada ou esquecida, e esta nota
está aqui para que a diferença seja verificada.

As três classificações significam:

- **Estável** — a estrutura está consolidada e coberta por um gate no CI. Ainda pode
  ganhar recursos; não será reprojetada sob seus pés dentro de 0.x, e uma alteração que
  possa quebrá-lo será anunciada no changelog.
- **Beta** — funciona e é usado em produção, e sabe-se que algo nele é imperfeito: um
  limite que você pode atingir, uma aresta incômoda, uma decisão de design ainda não tomada.
  A parte imperfeita é indicada nas notas, porque "beta" por si só não diz nada com o qual
  você possa se planejar.
- **Experimental** — disponibilizado para que possa ser usado e reportado. Espere encontrar
  as partes que ninguém testou ainda.

| Subsistema | Classificação | Em que se baseia a classificação |
|---|---|---|
| API REST + SDK gerado | Estável | O contrato de rede (wire contract) é versionado e controlado por gate; `client-sdk-e2e` executa ponta a ponta: cadastro → login → leituras com escopo de RLS → atualização (refresh) → armazenamento → realtime |
| Autenticação — e-mail/senha, OAuth, OIDC, magic link, código único | Estável | Doze provedores OAuth são fornecidos. O schema de autenticação é um contrato versionado, carimbado e verificado na inicialização |
| Autenticação — MFA (TOTP) | Beta | Registro, verificação e recuperação funcionam e são testados. A rotação de chaves está implementada para a chave de criptografia; não há interface administrativa para redefinir o fator de um usuário bloqueado |
| Segurança em nível de linha (RLS) | Estável | O diferencial do produto. `pnpm rls:check` audita um banco de dados em execução contra quinze verificações, e a suíte e2e de RLS é executada em cada push |
| Armazenamento (Storage) | Estável | Local, S3 e GCS. Bloqueio por padrão (default-deny) em produção desde a 0.17.0, e o scaffold inclui um hook de autorização |
| Realtime | **Beta** | As assinaturas são correspondidas apenas pelo caminho da coleção, portanto N assinantes em uma coleção custam N buscas adicionais (refetches) com escopo de RLS por escrita. Isso limita uma implantação a poucas centenas de assinantes simultâneos. Correto em qualquer escala; caro além dessa marca |
| Busca vetorial (pgvector) | Beta | Cada coluna vetorial recebe um índice HNSW para distância de cosseno por padrão, ajustável por propriedade via `VectorIndexConfig` (método, distâncias, parâmetros de construção) ou desativado, o que resulta em uma varredura exata. O pgvector não pode indexar uma coluna com mais de 2.000 dimensões, portanto essas são deixadas sem índice e usam varredura |
| Sincronização offline | Beta | As mutações carregam chaves de idempotência respeitadas pelo servidor, e os defeitos de perda de dados encontrados na auditoria de julho foram corrigidos. O modelo de conflito é a última escrita vence (last-write-wins) sem mesclagem por campo |
| Histórico de entidades | Estável | Baseado em snapshots, protegido por sua própria suíte de testes |
| Functions e crons | Estável | O ponto de entrada portátil (`@rebasepro/server/functions`) é um contrato versionado com sua própria seção de superfície de API |
| Servidor MCP + agent skills | Beta | `@rebasepro/mcp` roda sobre stdio: quarenta e duas ferramentas, autenticação bearer por projeto, ferramentas destrutivas recusam alvos não locais a menos que haja consentimento explícito. Desde a 0.21, o servidor também pode montar um endpoint `/mcp` remoto — OAuth 2.1, seis ferramentas de dados, cada chamada sob o próprio RLS do usuário autenticado — desativado a menos que `REBASE_MCP_ENABLED=true`, e apenas Postgres |
| Studio (SQL, schema, RLS, explorador de API) | Beta | Usado diariamente em projetos reais. O suporte a branches está presente no pacote OSS e deliberadamente não exposto no Rebase Cloud, pois mover uma implantação ativa para uma branch ainda não possui suporte definido |
| CMS + painel administrativo | Beta | Completo para CRUD, relações, campos de armazenamento e funções (roles). **A tabela de dados não possui semântica de grid** — sem `role`, sem `aria-rowindex`, `tabIndex` removido — portanto usuários de teclado e leitor de tela não conseguem operar a visualização principal. Sem rascunhos, sem conteúdo por localidade, sem rich-text em blocos |
| Banco de desenvolvimento gerenciado PGlite | Beta | `rebase dev` com configuração zero sem Docker. Uma sessão por vez, de modo que as requisições são serializadas e a concorrência não pode ser reproduzida nele; comandos baseados em Atlas (`db push`, `generate`, `migrate`) não funcionam lá e informam isso explicitamente |
| Helm chart | Beta | Renderiza a topologia de processos divididos e é publicado no registro OCI a cada lançamento. O padrão continua sendo um único contêiner |
| `@rebasepro/server-mongo` | **Experimental** | Um driver funcional com realtime via change-stream e histórico por snapshot. **Sem segurança em nível de linha (RLS)** — todo o modelo de isolamento acima não se aplica a ele — e sem relações. Change streams precisam de um replica set: em um `mongod` standalone nada os substitui, de modo que uma assinatura vê as escritas feitas por meio daquele processo Rebase e perde todas as outras. Sem MFA: o registro responde 501, e as verificações respondem "no factor", portanto o login nunca solicita um. O aggregate de admin não pode ter uma coleção como alvo — ele lê o nome de um estágio `$from` que o MongoDB não tem — portanto não retorna nada |
| `@rebasepro/firebase` | Experimental | Executa o painel administrativo e o SDK contra o Firestore. Sem RLS, sem interface SQL; o conjunto de recursos do Postgres não é transferido. O driver do Firestore ignora grupos de filtros `or(...)`/`and(...)`, portanto uma consulta que usa um deles lê todas as linhas permitidas por seus filtros simples |
| Rebase Cloud | **Beta privado** | Em produção, executando tenants reais, liberado em lotes. Sem autoatendimento (self-serve) |

Duas entradas acima são o custo honesto de publicar esta tabela: o refetch do
realtime e a acessibilidade da tabela de dados são defeitos abertos, não itens de
roadmap, e ambos estão listados em vez de deixados para o leitor descobrir.

Esta tabela é o que existe. O que ainda não existe está no
[roadmap](https://rebase.pro/roadmap), uma entrada por issue do GitHub, com o
subconjunto necessário para a versão 1.0 marcado.

## A promessa do 0.x

O Rebase está na versão `0.x`. Esta seção foi escrita para ser válida para todas as
versões 0.x, e não para apenas uma delas, de modo a não se tornar obsoleta a cada
lançamento. **Mudanças da API TypeScript desenvolvida que quebrem a compatibilidade
(breaking changes) ainda são permitidas em versões minor**, e o changelog é onde
elas são anunciadas. O que *não* tem permissão para quebrar silenciosamente é o
conjunto de contratos versionados abaixo: cada um é carimbado em um artefato ou banco
de dados, cada um é verificado na inicialização ou no intake, e cada um falha **de
forma ruidosa e específica** em vez de se degradar.

Essa distinção é toda a promessa. Uma exportação renomeada custa um erro de compilação
e cinco minutos. Um bundle que inicializa contra o runtime errado e serve dados
sutilmente incorretos custa um incidente, e os contratos existem para que a segunda
categoria não possa acontecer silenciosamente.

O Rebase Cloud consome exatamente esses contratos e nada mais. Qualquer coisa não
listada aqui é um detalhe de implementação do qual a plataforma não depende.

## Os contratos versionados

Os valores abaixo são lidos do código-fonte; trate as referências de arquivos como a
verdade e esta tabela como o mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado em | Verificado em | Direção de compatibilidade |
|---|---|---|---|---|
| 1 | intervalo `rebase` em `rebase.json` | projeto do usuário | CLI no build | o projeto declara quais runtimes aceita |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatibilidade com versões anteriores (backward)** — novo runtime lê bundles antigos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mesmo arquivo | mesmo arquivo | **correspondência exata, ambas as direções** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | na inicialização, contra `rebase.schema_meta` | **somente para a frente (forward only)** — novo runtime migra bancos de dados antigos |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado pelo SDK como `x-rebase-schema` quando configurado | consultivo — identifica contra qual schema o cliente foi compilado |
| 6 | Identificadores de banco de dados derivados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — um nome emitido por uma versão nunca é rederivado |

### 1 — `rebase` em `rebase.json`

Um intervalo semver, lido como `engines` em um `package.json`: quais versões de
runtime este projeto aceita. Nomeado como `rebase` em vez de `runtime` deliberadamente,
porque `runtime` já significa *quem é o dono do processo* (`managed` | `custom`) em
uma aplicação.

### 2 — `BUNDLE_FORMAT_VERSION` (atualmente 2)

O layout em disco de um bundle compilado. Um runtime aceita qualquer bundle cujo formato
seja **menor ou igual** ao seu próprio, o que permite que a camada gerenciada migre um
tenant para uma nova imagem sem que ninguém precise recompilar seu projeto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` um único diretório,
  `entry.admin` para um painel administrativo empacotado.
- **2** — `kind: "backend" | "static"`, `entry.static` uma lista, `entry.admin`
  removido. O formato 1 ainda é lido, via `upgradeLegacyManifest`.

**Incremente quando** o layout mudar de modo que um runtime mais antigo interpretaria
incorretamente um bundle mais novo. O incremento é o que converte "inicializa e não
serve nada" em uma recusa de inicialização.

### 3 — `RUNTIME_CONTRACT_VERSION` (atualmente 1)

A versão major do contrato bundle↔runtime. Diferente da versão do pacote
`@rebasepro/server`, que pode lançar qualquer número de minors e patches enquanto
esta permanece inalterada.

**Leia isto antes de mexer aqui.** A verificação é `!==`, não `>`:

> um bundle que tem como alvo o contrato *N* roda **apenas** em um runtime que implementa *N*

portanto, incrementá-lo invalida **todos os bundles já compilados**, de uma só vez,
até que cada um seja recompilado. Essa é a severidade pretendida — é a alavanca "nada
antigo pode rodar aqui" —, mas significa que um incremento é uma migração para toda a
frota, não uma nota de lançamento. Para a camada gerenciada, isso deve ser coordenado
com a recompilação do bundle de cada tenant.

Se uma alteração for *aditiva* e os bundles antigos continuarem corretos, ela requer
`BUNDLE_FORMAT_VERSION` (ou nada), e não este contrato.

### 4 — `AUTH_SCHEMA_VERSION` (atualmente 2)

Carimbado em `rebase.schema_meta` e comparado na inicialização. Um runtime **se recusa
a iniciar** contra um banco de dados migrado por uma versão mais recente do framework,
em vez de operar em uma estrutura que ele não compreende — durante um rolling deploy,
essa é a diferença entre metade da frota dar erro e metade da frota corromper dados.

A migração para frente é automática: `ensureAuthTablesExist` atualiza um banco de dados
mais antigo. Note que este bloco de migração é deliberadamente envolvido em `try/catch`
e gera logs em vez de lançar erros — uma inicialização capenga é melhor que um crash
loop —, portanto **"ele inicializou" não prova nada**. Cada asserção na suíte de upgrade
lê o catálogo ou os dados em vez disso.

**Incremente quando** uma migração não puder ser ignorada por um runtime mais antigo.
Não incremente para uma coluna aditiva e retrocompatível; há um exemplo prático desse
julgamento em `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Um hash das definições compiladas de coleções, emitido no manifesto do bundle e
reproduzido por um SDK gerado no cabeçalho `x-rebase-schema` (`SCHEMA_VERSION_HEADER`).
Ele existe para que a plataforma possa dizer "esta aplicação foi compilada contra um
schema mais antigo" em vez de falhar misteriosamente na primeira requisição.

`rebase generate-sdk` grava o valor em `schema.meta.ts`; passe-o para o cliente enviá-lo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

O backend lê esse cabeçalho a cada requisição de dados. O descompasso (drift) nunca
recusa uma chamada — um SDK um schema atrás geralmente ainda é compatível, e implantar
o backend antes do frontend é a ordem normal de deploy —, mas quando uma requisição
falha com 400 ou 404, o erro traz o drift como sua causa:

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

Assim, uma coluna renomeada é interpretada como "seu SDK está desatualizado, gere-o
novamente", em vez de um campo que seus próprios tipos insistem que existe. Uma
requisição bem-sucedida nunca é informada disso.

Cobre **apenas coleções**. A edição de um hook ou function não altera o contrato do
cliente e não deve invalidar todos os SDKs gerados.

### Quem está chamando

Mais dois sinais identificadores, nenhum dos quais bloqueia algo por si só:

- **`GET /api/meta/schema-version`** não requer autenticação e responde com o
  `schemaVersion` do projeto *e* seu `runtime` (`version` e `contract`). Um job
  de CI que compara seu SDK gerado contra um projeto ativo não precisa de credenciais,
  assim como um cliente que pergunta com qual runtime está conversando.
- **`User-Agent: rebase-cli/<version>`** é enviado em todas as requisições para o
  `rebase cloud`. O formato de transmissão (wire format) do control plane evolui mais
  rápido do que o publicado no npm, de modo que ele precisa ser capaz de responder a um
  cliente antigo com `CLI_TOO_OLD` e a versão mínima — o que ele só pode fazer para
  um chamador que informa quem é.

### 6 — Identificadores de banco de dados derivados

Cada nome que este framework calcula por conta própria em vez de receber explicitamente:
uma coluna de chave estrangeira, uma restrição (constraint) de chave estrangeira, uma
tabela de junção e suas duas colunas de chave, um tipo enum, um nome de política, uma
coluna em `snake_case` de uma propriedade em `camelCase`.

> **Um identificador derivado é congelado no momento em que uma versão o emite.**

Não "congelado até a próxima major" — congelado. A lógica é diferente dos outros cinco
contratos e mais rígida. Aqueles são versionados, portanto uma incompatibilidade pode
ser *detectada* e recusada. Este não: o nome é gravado no banco de dados de um cliente no
dia em que ele faz o deploy, e não há carimbo de versão em uma coluna. Todo banco de
dados provisionado por qualquer versão já lançada carrega o que quer que ela tenha
derivado, e nenhum código neste repositório pode acessá-los e renomear a todos.

A versão 0.13 é o exemplo prático. `generateForeignKeyName` aprendeu a singularizar
adequadamente — `categorie_id` → `category_id`, `addres_id` → `address_id` —, o que é
indiscutivelmente uma derivação melhor, e quebrou todos os bancos de dados antigos que
tinham um plural irregular. O boot-ensure migrou a coluna, de modo que os dados
sobreviveram; o `schema.generated.ts` versionado do projeto não, e a inicialização
falhou em uma coluna existente. Três commits, um novo seam test e uma entrada
permanente nas notas de upgrade, em troca de um nome de coluna mais bonito pelo qual
ninguém havia pedido.

**Se uma derivação estiver genuinamente errada**, ela é alterada para coleções criadas
*posteriormente*, sob uma estratégia de nomenclatura registrada no projeto — nunca
retroativamente e nunca como efeito colateral do aprimoramento da função subjacente.

**A única sobreposição legítima** é uma alteração que faz o código concordar com um
nome que o banco de dados *já possui*. O exemplo prático é o truncamento de
identificadores: o Postgres corta silenciosamente um identificador para 63 bytes,
portanto um nome de restrição derivado mais longo nunca foi o nome no catálogo — a
derivação estava descrevendo um objeto que não existia sob aquela grafia, e o
boot-ensure reemitia `ADD CONSTRAINT` a cada inicialização porque sua comparação nunca
coincidia. Truncar na construção altera o que este repositório *deriva* e não altera em
nada o que qualquer banco de dados implantado *contém*. Esse é o teste a ser aplicado:
não "o novo nome é melhor?", mas "algum banco de dados existente precisa ser alterado?".
A única coisa que é sempre segura é *reconhecer* um nome antigo para migrá-lo:
`legacyForeignKeyName` existe para ser detectado, nunca para ser gerado, e a linha de
base (baseline) fixa essas detecções também. Remover uma desfaz silenciosamente a
migração de qualquer banco de dados que ainda carregue essa grafia.

**O gate.** `tooling/scripts/derived-names.mts` executa uma fixture de teste de estresse
de nomenclatura — plurais irregulares, terminação em `ss`, um acrônimo, uma junção a
partir de um slug no plural, sobreposições explícitas, um slug longo o suficiente para
ser truncado — através de ambos os produtores de DDL de schema e renderiza cada
identificador que qualquer um deles nomeia:

```bash
pnpm check:derived-names
```

Uma linha alterada ou removida falha como uma quebra de contrato, com a grafia antiga
e a nova lado a lado. Uma alteração puramente aditiva também falha, mas com a mensagem
"regenerate" — para que a baseline não mude sem que ninguém perceba.

Também garante que `rebase db push` e o boot-ensure do runtime gerenciado derivem os
*mesmos* nomes, o que é um segundo contrato oculto dentro do primeiro: eles compilam
as mesmas coleções por meio de códigos diferentes, e um projeto enviado uma vez via
push e inicializado posteriormente não deve terminar com dois schemas.

## O que *não* está congelado

Dito de forma direta, para que ninguém deduza uma promessa que nunca foi feita:

- A API TypeScript desenvolvida — configuração de coleções, opções de
  `initializeRebaseBackend`, props de admin, nomes de métodos do SDK. Breaking changes
  chegam em minors e são anunciadas no changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estes mudam mais rápido e têm menos consumidores.
- Qualquer coisa sob o `src/` de um pacote que não seja reexportada do seu barrel.
  `packages/client/src/index.ts` traz uma nota explicando que sua lista de exportações
  é mantida rigorosamente para que uma exportação interna não se torne pública por
  acidente.
- O schema do banco de dados das *suas* coleções. Esse pertence a você; o Rebase é
  proprietário apenas dos schemas `rebase` e `auth`.

## Os gates que garantem isso

Nada do que foi dito acima é uma convenção — cada item tem um teste que falha quando é quebrado:

| Gate | O que ele garante |
|---|---|
| `pnpm verify:corpus` | cada formato de bundle já lançado, inicializado no runtime atual. As fixtures em `tests/fixtures/bundles/` são **escritas à mão e congeladas** — uma fixture que o builder regenera muda sempre que o builder muda |
| `pnpm verify:selfhost` | um bundle real compilado, empacotado, inicializado e requisitado como um navegador faria |
| `upgrade-e2e.test.ts` | schemas antigos de banco de dados (`schema-snapshots/`) atendidos pelo runtime atual |
| `tests/e2e/tests/cli-init-e2e.ts` | um projeto gerado por scaffolding instalado a partir de **tarballs reais**, e não de links de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | o fluxo do usuário final: cadastro → login → leituras com escopo de RLS → atualização (refresh) → armazenamento → realtime |
| `pnpm check:derived-names` | cada nome de coluna, restrição, junção, enum e política que o framework deriva — e que o boot e o `db push` os derivem de forma idêntica |
| `pnpm rls:check` | as políticas do schema gerado |
| `pnpm check:api-surface` | cada exportação, e seus membros, dos cinco pacotes fornecidos pela imagem — `@rebasepro/server`, `types`, `client`, `common`, `utils` — além do ponto de entrada `@rebasepro/server/functions`, contra as seis seções de `contracts/server.api.txt`. Estes são os pacotes que `infra/docker/entrypoint.mjs` conecta via symlink sobre as cópias do próprio bundle implantado, portanto remover uma exportação de um deles não é um erro de compilação para ninguém — é uma falha de inicialização em toda a frota durante um rollout que ninguém solicitou |
| `pnpm test:gates` | os testes dos próprios gates, sobre fixtures — onze arquivos, entre eles `check:api-surface` e a verificação de release-bump abaixo —, de modo que um gate que deixe de enxergar o que protege falha aqui. `check:api-surface` passou toda a sua vida incapaz de ver um membro desaparecer de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | se o nível de incremento (bump) com o qual uma versão é lançada corresponde ao que o lançamento fez com as linhas de base acima — executado por `publish.yml` antes que o changelog seja carimbado |
| CI do SaaS | o control plane compilado contra a `main` deste repositório, em seus próprios pushes e nightly |

**Grave uma fixture de bundle e um snapshot de schema uma vez por lançamento.** O
valor de ambos os corpora está inteiramente em quão longe no passado o mais antigo vai,
e nenhum deles pode ser preenchido retroativamente depois do fato.

### Ainda sem gates

A tabela acima é o que está garantido. Estas são as partes da política que nada
garante ainda, listadas para que ninguém veja nelas uma promessa que não existe:

- **Sem janela de depreciação ou suporte.** Enquanto o Rebase for `0.x`, não há regra
  escrita sobre por quanto tempo uma exportação depreciada sobrevive antes da remoção, ou
  por quanto tempo uma minor mais antiga recebe correções. Correções de segurança são
  aplicadas apenas na minor mais recente.
- **O formato de transmissão HTTP (wire format) não tem gate.** Nenhum script `check:*`
  compara diferenças nos formatos de requisição e resposta contra uma linha de base da
  mesma forma que `check:api-surface` compara exportações; uma alteração no formato de
  resposta só é detectada por uma suíte e2e que por acaso a leia.
- **As flags da CLI não têm linha de base de compatibilidade.** O verificador de
  documentação falha quando uma flag usada pelas skills, pelos exemplos ou pelo site de
  marketing desaparece; nada percebe a remoção de qualquer outra flag ou uma alteração em
  seu significado.
- **Um lançamento via CI não registra nenhum dos dois corpora.** O fluxo de trabalho de
  publicação não registra nenhuma fixture de bundle nem snapshot de schema; apenas o script
  local de release tenta fazê-lo, e ele apenas avisa em vez de interromper quando não consegue.
  As versões 0.18 a 0.21 não têm snapshots de projeto registrados.
- **A superfície de exportação é um gate, não um contrato.** Se as exportações públicas dos
  pacotes fornecidos pelo runtime se tornarão um sétimo contrato numerado — declarado como a
  linha de base de `check:api-surface`, compatível aditivamente dentro de uma major de
  contrato — é uma decisão em aberto.

## Alterando um contrato

1. Decida qual dos seis é. A maioria das alterações não é nenhum deles — mas "nenhum dos
   seis" não significa "incontroverso". Remover ou renomear uma exportação de
   `@rebasepro/server`, ou um membro dela, não é nenhum dos seis e é a alteração isolada
   mais perigosa no repositório, porque o código que ela quebra já está compilado e não
   será recompilado. `pnpm check:api-surface` é o que sustenta essa barreira; se isso se
   tornará um sétimo contrato numerado é uma decisão em aberto (veja *Ainda sem gates*, acima).
2. Adicione uma fixture ou snapshot para a estrutura **antiga** primeiro e certifique-se
   de que ele passe.
3. Faça a alteração e incremente a constante.
4. Confirme que a fixture antiga ainda passa, ou que agora falha *com a mensagem de que o
   usuário precisa*. Ambos são resultados válidos; o silêncio não é.
5. Para o contrato 3, planeje a recompilação de cada bundle implantado antes de fazer o merge.
6. O contrato 6 é a exceção aos passos 3 e 4: não há constante para incrementar nem versão
   na qual recusar, porque uma coluna não traz carimbo de versão. O passo que os substitui
   é decidir não fazer a alteração — veja a seção acima para entender como é a alternativa.

## Relacionado

- [Atualização](/docs/upgrading/) — o que realmente quebrou, versão por versão
- [Changelog](/docs/changelog/) — todas as alterações, incluindo aquelas que não quebraram nada
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — o formato de bundle contra o qual um projeto implantado já está compilado

---
