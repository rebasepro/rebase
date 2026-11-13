---
sourceHash: 9e1445cbb512338c
title: Runtime gerenciado de backend
sidebar_label: Runtime Gerenciado
description: O que um backend com runtime "managed" pode e não pode fazer no Rebase Cloud — pacotes e binários, memória e CPU, timeouts e tamanhos de body, o sistema de arquivos, estado em memória, segredos, armazenamento para arquivos gerados e rede de saída.
---

Um app backend declarado desta forma no `rebase.json` roda no **runtime
gerenciado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Gerenciado significa que você envia um bundle, não uma imagem. O `rebase cloud deploy`
compila suas tabelas, `backend/functions/` e crons no `dist-bundle`, faz o upload
e o Rebase Cloud o inicializa na imagem publicada `rebasepro/server`. Você nunca
escreve um Dockerfile e também não pode alterar o que está na imagem. Esta página
lista o que isso permite, para que você possa planejar uma funcionalidade antes de
construí-la.

Os números aqui vêm do runtime e da plataforma como eles são hoje. Alguns são
parâmetros ajustáveis que você pode alterar, e a página indica quais são. As poucas
coisas que ainda não foram prometidas estão reunidas [no final](#ainda-não-prometido).

## Visão geral

| Pergunta | Resposta |
|---|---|
| Versão do Node | Node 22, no Debian slim, `linux`/`x64` |
| Pacotes npm | Sim, do registro público ou de um privado. Instalados no bundle quando você faz o deploy |
| Módulos nativos (`.node`, node-gyp) | Não. O `rebase cloud deploy` recusa o bundle |
| WebAssembly | Sim |
| Criar processo filho (spawn) | Sim, para um binário `linux`/`x64` fornecido por um pacote npm. Veja [Binários](#binários-e-processos-filhos) |
| Memória e CPU | Definido por projeto com `rebase cloud compute`. Veja [Computação](#computação-e-instâncias) |
| Instâncias | 1 por padrão, sempre ativa. Você pode fixar até 5 ou deixar o autoscaler subir até 16 |
| Timeout de função | 30 segundos, depois `504 FUNCTION_TIMEOUT`. Configurável até 10 minutos |
| Corpo da requisição (Request body) | 10 MiB, depois `413`. Configurável, até os 64 MiB que a borda aceita |
| Sistema de arquivos com permissão de escrita | Sim, mas é temporário e pertence a uma única instância |
| Estado a nível de módulo (um cache `Map`) | Sobrevive entre requisições em uma mesma instância. Perdido a cada deploy e reinicialização, e não compartilhado entre instâncias |
| Variáveis de ambiente e segredos | `rebase cloud env set`, aplicados no próximo deploy |
| Armazenamento de arquivos | Um bucket por projeto, servido pelo seu backend em `/api/storage/file/…` |
| HTTP de saída | Sim, nas portas 80 e 443 (e 465, 587, 993 para e-mail). Outras portas são bloqueadas. Um IP de saída fixo: `207.175.138.15` |

## Código e pacotes

**Node e a imagem.** A imagem do runtime é construída sobre `node:22-slim`
(Debian), e seu bundle roda em `linux`/`x64` como um usuário não root. Seu
`tsconfig` e a versão do Node na sua máquina não alteram isso.

**Dependências.** O `rebase cloud deploy` instala as dependências declaradas
nos seus arquivos `package.json` dentro do bundle, para `linux`/`x64`, e faz
o upload delas junto com ele, de modo que uma nova instância não precise instalar
nada. Um bundle que ultrapassaria o limite de upload de 1 GB com elas é enviado
sem elas, e o deploy avisa isso: cada instância as instala ao iniciar, com
`npm ci` (ou `npm install` caso não haja um lockfile). Quatro coisas decorrem
de como elas são instaladas:

- **Scripts de instalação nunca são executados.** A instalação usa `--ignore-scripts`.
  Um pacote que baixa um binário ou compila algo em `postinstall` é instalado sem
  isso.
- **Apenas versões de registro são instaladas.** Uma dependência `file:`, `link:`,
  `git+…` ou `github:` causa falha no build, pois o runtime não tem como
  resolvê-la.
- **Alguns pacotes vêm da imagem, não de você.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` e `zod` são removidos das
  dependências do bundle e as cópias da própria imagem são vinculadas, portanto
  a sua versão deles não é aplicada. Outros pacotes `@rebasepro/*`, como o driver
  de banco de dados, são instalados a partir do seu `package.json` como qualquer
  dependência. `typescript` e `tsx` também são removidos; eles são ferramentas
  de build.
- **Pacotes privados precisam de um `.npmrc`.** O `rebase build` copia o `.npmrc`
  do projeto (e `backend/.npmrc`) para dentro do bundle, para que a instalação use
  as mesmas configurações de registro da sua máquina. Toda credencial nele deve ser
  uma referência a variável de ambiente, nunca o token em si; um token literal
  falhará o build, pois o bundle é enviado com o seu código:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

O upload do bundle é limitado a 1 GB, comprimido.

**Módulos nativos são recusados.** Um pacote que fornece um binário `.node` compilado
não pode ser carregado no runtime gerenciado. O `rebase build` avisa sobre isso, e
o `rebase cloud deploy` é interrompido antes do upload:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

A verificação procura por pacotes nativos conhecidos (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
por `binding.gyp` ou `gypfile`, por scripts de instalação que chamam `node-gyp` ou
`prebuild`, e por arquivos `.node`. O
[guia de deploy](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
lista as soluções alternativas comuns. A versão resumida: faça o trabalho em tempo de build,
chame um serviço externo ou faça deploy com `runtime: "custom"`.

**WebAssembly funciona.** Um pacote que fornece um arquivo `.wasm` e o carrega a partir
de JavaScript não é um módulo nativo, e o Node 22 o executa. Testado na imagem base
do runtime com as configurações de segurança do pod, usando `esbuild-wasm`. Lembre-se
do [limite de memória](#computação-e-instâncias) se o módulo for grande, como um modelo
de fala ou ML.

### Binários e processos filhos

O `child_process` funciona. A imagem em si possui muito pouco para executar: `node`,
`npm`, `sh`, `tar` e as ferramentas de cliente do PostgreSQL (`pg_dump`, `pg_restore`).
Não há `ffmpeg`, nem ImageMagick, nem Python e nem compilador, e você não pode
adicionar pacotes de sistema, porque não há Dockerfile e o processo não é root.

Um binário que um pacote npm traz **dentro de seu próprio tarball** é instalado
com o pacote e executado. Ele deve ser compilado para `linux`/`x64` contra glibc
(Debian) e roda como um usuário sem privilégios e sem Linux capabilities. Testado
com `@esbuild/linux-x64` na imagem base do runtime. Um binário que um pacote *baixa*
no `postinstall` nunca chega, porque os scripts de instalação não rodam; pacotes
como o `ffmpeg-static` funcionam dessa forma.

Se uma funcionalidade precisa de um binário, use uma API hospedada para esse
trabalho ou migre o backend para `runtime: "custom"`, onde você constrói sua
própria imagem.

## Computação e instâncias

Cada projeto roda em seus próprios pods. Memória e CPU são por instância, e você
os define com os [parâmetros de computação](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Um projeto que nunca configurou um parâmetro roda como um pod burstable: ele reserva
`100m` de CPU e `384Mi` de memória, podendo atingir picos de até 2 CPU e 2 GiB. Uma
requisição configurada mantém essa proporção entre solicitação e limite. Execute
`rebase cloud compute` para ver o que o seu projeto possui.

Instâncias:

- **Uma por padrão, sempre em execução.** `--replicas` fixa entre 1 e 5.
  Nada escala um backend para zero.
- **O autoscaling é opcional.** `--autoscale-max` define um teto de até 16, e
  `--autoscale-cpu-target` (padrão 70) o uso de CPU que o autoscaler busca atingir.
- **Deploys são graduais (rolling).** Uma nova instância inicia e fica pronta
  antes que a antiga seja interrompida, portanto, por um breve período, duas versões
  atendem ao tráfego simultaneamente.

`--spot` fica desativado por padrão; instâncias spot são mais baratas e podem ser
reiniciadas sem aviso prévio.

## Memória e estado a nível de módulo

Um valor a nível de módulo, como `const cache = new Map()` no topo de um arquivo
de função, reside no processo do Node. Ele sobrevive de uma requisição para a
seguinte na mesma instância. Ele é perdido sempre que esse processo é encerrado:

- em **cada deploy**, pois cada deploy inicia novas instâncias;
- quando uma **variável de ambiente** é alterada e passa por deploy;
- quando uma instância é reiniciada, reagendada ou (com `--spot`) revogada.

Com mais de uma instância, cada uma possui sua própria cópia, de modo que duas
requisições podem ver caches diferentes.

Use um `Map` a nível de módulo como um cache que você pode se dar ao luxo de perder:
algo que torna a próxima requisição mais rápida, mas não é a única cópia de nada.
Mantenha qualquer coisa custosa para produzir, como áudio gerado ou uma resposta cara
de API, no banco de dados ou no [armazenamento](#armazenamento-para-arquivos-gerados). Para
clientes que você instancia uma única vez, como o SDK de uma API, use `lazyResource`
para que o cliente seja criado no primeiro uso a partir do ambiente da requisição. Veja
[Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

[Executar mais de uma instância](/docs/deployment/multiple-instances/) lista o
estado que o próprio Rebase mantém por processo, como contadores de limite de taxa
(rate-limit) e canais em tempo real.

## O sistema de arquivos

O sistema de arquivos do container permite escrita, e o `/tmp` funciona. Mas tudo o
que for gravado ali:

- pertence a uma única instância, e as outras instâncias não o veem;
- é excluído quando a instância para, ou seja, no mais tardar no próximo deploy;
- compartilha um limite de armazenamento efêmero de 6 GiB com o bundle e seus
  `node_modules` instalados. Uma instância que ultrapassar esse limite é despejada.

Use-o para arquivos temporários durante uma única requisição. Não o use como cache
entre deploys ou como armazenamento para uploads. É também por isso que
[`STORAGE_TYPE=local` fica desativado em produção](/docs/backend/storage/#environment-variables).

## Requisições

| Limite | Padrão | Altere com |
|---|---|---|
| Timeout de função | 30 s, depois `504` com código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` desativa) |
| Espera pela sua instância, na borda | 10 minutos entre leituras ou gravações | Fixo |
| Corpo da requisição, rotas `/api/*` sem um limite próprio | 10 MiB, depois `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, em bytes |
| Corpo da requisição na borda | 64 MiB | Fixo |
| Um único arquivo via `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chamadas anônimas para `/api/functions/*` | 3000 por IP a cada 15 minutos | `rateLimit.anonymousFunctions` |

Alguns detalhes:

- **O timeout libera quem fez a chamada, não o processamento.** Aos 30 segundos,
  o cliente recebe um `504`, e o `getSignal(c)` é abortado. Passe esse sinal para
  `fetch` e qualquer outra chamada que aceite um signal, para que o trabalho também
  seja interrompido. Veja
  [Timeouts e Limites de Taxa](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **A borda espera mais tempo que o runtime.** O ingress na frente das suas
  instâncias aguarda até 10 minutos, portanto o limite atingido por uma requisição
  é o do runtime, que responde em JSON e aborta o sinal. Aumente
  `REBASE_FUNCTIONS_TIMEOUT_MS` até esse limite. Para tarefas que demoram mais ou
  que precisam sobreviver a um deploy (uma instância faz drain por 15 segundos),
  responda imediatamente e execute o processamento em um
  [job](/docs/backend/jobs/).
- **Uploads maiores que 64 MiB** precisam do upload retomável (TUS), que envia
  o arquivo em partes (chunks). O `client.storage.putObject()` muda para ele
  automaticamente acima de 8 MiB.
- **Tamanho da resposta.** Nem o runtime nem a borda definem um limite para o
  tamanho da resposta. Uma resposta grande ainda será mantida na memória se o seu
  handler a construir inteira de uma vez só, portanto faça streaming ou sirva-a a
  partir do armazenamento.

## Variáveis de ambiente e segredos

Configure-os pela CLI ou no console. Não há um campo para eles no `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Uma alteração é aplicada no próximo deploy.** As instâncias em execução
  mantêm os valores com os quais iniciaram. `set` e `unset` lembram você disso
  (`Pending redeploy`).
- **Limites:** até 100 variáveis por projeto, 32 KiB por valor e 256 KiB no
  total. Os nomes seguem `[A-Za-z_][A-Za-z0-9_]*`.
- **Alguns nomes são reservados.** A própria plataforma define `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV`, e fixa como o processo é executado
  (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). A tentativa de definir um desses
  nomes é recusada, e o erro lista todos eles.
- **`CORS_ORIGINS` inicia a partir dos seus domínios.** A plataforma o define
  para o host do projeto e seus [domínios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface)
  verificados. Um `CORS_ORIGINS` que você definir é adicionado a essa lista, para
  um frontend servido de outro lugar: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **As variáveis de armazenamento são padrões.** A plataforma define as
  variáveis `STORAGE_*` e `S3_*` para o bucket dela, e um valor definido por
  você tem precedência.
- **Nomes de build-time são recusados.** Variáveis `VITE_`, `NEXT_PUBLIC_`,
  `PUBLIC_` e `REACT_APP_` são destinadas a frontends em tempo de build, e o backend
  nunca as vê a tempo. A flag `--force` permite armazená-las mesmo assim.

Em uma função, leia-as dentro do handler, nunca no topo do arquivo:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Uma leitura de `process.env` no escopo do módulo que retorne vazio faz com que o
arquivo inteiro falhe ao carregar, e suas rotas passem a responder `404`. Veja
[Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

## Armazenamento para arquivos gerados

Um projeto Cloud ganha armazenamento de arquivos assim que você o cria:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Ou aponte o projeto para um bucket que você já possui com
`rebase cloud storage attach` (S3, R2, MinIO, qualquer bucket compatível com S3).
Sem nenhum dos dois, os uploads responderão `501 STORAGE_NOT_CONFIGURED`. Mais
buckets podem ser declarados em `backend/resources.ts`; veja
[Múltiplos Buckets](/docs/backend/storage/#several-buckets).

Um deploy com armazenamento é recusado até que o projeto defina quem pode ler e
gravar arquivos. O arquivo `backend/storage.ts` do scaffold exporta um hook
`storageAuthorize` para isso. Veja
[Autorização por Objeto](/docs/backend/storage-authorization/).

**Como os arquivos são servidos.** Seu backend serve cada arquivo em
`GET /api/storage/file/<key>`. Ele lê o objeto do bucket e faz o streaming dele,
com `Content-Type`, requisições parciais (range requests) e cabeçalhos de cache.
Não há uma URL direta do bucket para compartilhar.

- Uma chave em **`public/`** é servida para qualquer pessoa, sem token, em uma URL
  que nunca muda. Use-a para arquivos que qualquer visitante possa carregar, como
  áudio gerado para um jogo público.
- Qualquer outra chave é privada. O cliente solicita a `/api/storage/metadata/<key>`
  uma URL de download que contém um token, válido por 300 segundos por padrão
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, configurável até uma semana).

A partir de uma função, grave com `rebase.storage` (o bucket padrão) ou
`rebase.bucket(…)` (um bucket nomeado). Seu hook `storageAuthorize` ainda decide
se a gravação é permitida.

Transformações de imagem (`?width=`, `?format=`) precisam do `sharp`, que é um
módulo nativo e não está presente na imagem gerenciada. No runtime gerenciado, uma
requisição de transformação retorna a imagem original.

### Exemplo: cache de áudio gerado

Uma função que converte texto em fala usando uma API hospedada, armazena cada
resultado uma única vez e o serve a partir do armazenamento depois disso. O `Map`
apenas economiza uma consulta ao armazenamento em uma instância já inicializada
(warm); o bucket é o cache real, portanto um deploy não perde nada.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

A rota é pública, como toda rota em `backend/functions/` até que você a proteja.
Uma rota real verificaria quem tem permissão para criar novos áudios, para que
terceiros não consumam a cota da sua API de fala.

## Rede de saída

Funções podem chamar serviços externos. Conexões de saída das suas instâncias são
permitidas para qualquer endereço da internet apenas nestas portas TCP:

| Porta | Finalidade |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Envio de e-mail via SMTP com TLS ou STARTTLS |
| 993 | IMAP com TLS |

Todo o restante é bloqueado. Isso inclui a porta 25, IMAP sem criptografia e bancos
de dados ou caches em suas próprias portas: Redis na 6379 ou MongoDB na 27017 fora
do Rebase Cloud não podem ser acessados. O endereço de metadados da nuvem
(`169.254.169.254`) também é bloqueado.

A única exceção é o seu próprio banco de dados. Se o projeto trouxer seu próprio
PostgreSQL (BYODB), cada deploy também libera conexões para o host desse banco de
dados na porta indicada em sua string de conexão, e para mais nada nessa porta.
O host é resolvido para seus endereços IP no momento do deploy, portanto, se seu
provedor mover o banco de dados para outro endereço, faça deploy novamente. O banco
de dados deve aceitar conexões da internet: a aplicação se conecta diretamente à
string de conexão. As configurações de bastion SSH são usadas apenas pelo teste de
conexão, não pela aplicação em produção.

A plataforma não adiciona proxy nem limite de taxa de saída; os serviços chamados
possuem os seus próprios. Passe `getSignal(c)` para o `fetch` para que uma chamada
seja cancelada se a requisição atingir o timeout.

Todo o tráfego de saída parte de **um único endereço IP fixo, `207.175.138.15`**.
Adicione-o a uma lista de permissões (allowlist) de terceiros quando um serviço
exigir uma. O endereço é compartilhado por todos os projetos no Rebase Cloud,
portanto uma lista de permissões prova apenas que a chamada parte do Rebase Cloud,
não que pertence especificamente ao seu projeto: continue autenticando-se no
serviço também com uma chave.

## Inicialização e encerramento

- **Cold start.** Uma nova instância faz o download e descompacta o bundle antes
  de atender requisições, portanto uma árvore de dependências grande torna cada
  escalonamento (scale-up) mais lento. Um bundle enviado sem suas dependências
  também as instala, o que adiciona de 40 a 60 segundos. A plataforma aguarda
  até 300 segundos para que uma instância fique online.
- **Health check.** A plataforma verifica `/livez` (o processo está em execução)
  e `/health` (ele consegue alcançar o banco de dados). Ambos são servidos pelo
  runtime, então você não precisa implementá-los.
- **Shutdown (Encerramento).** Em um deploy ou reinicialização, a instância para
  de aceitar novas requisições, aguarda 5 segundos para que o tráfego seja
  redirecionado e recebe o sinal `SIGTERM`. Requisições em andamento têm até 15
  segundos para serem concluídas. Promises passadas para `waitUntil` recebem até
  5 segundos desse tempo. Uma promise que você não passou para `waitUntil` é
  descartada. Veja [Trabalho em Segundo Plano](/docs/backend/custom-functions/#background-work).

## Quando o runtime gerenciado não é a escolha certa

Migre o backend para `"runtime": "custom"` quando ele precisar de:

- um módulo nativo, ou um binário do sistema que nenhum pacote npm forneça,
  como `sharp`, ImageMagick ou um motor de fala local;
- pacotes do sistema ou uma imagem base diferente;
- uma conexão de longa duração com algo fora das portas permitidas.

Um runtime customizado compila seu próprio Dockerfile, e você passa a gerenciar a
imagem a partir de então. O comando `rebase cloud deploy --eject` faz essa transição.
Veja [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Ainda não prometido

- **Histórico de logs.** O `rebase cloud logs --runtime` lê das instâncias em
  execução, e o `rebase cloud debug logs --previous` lê da última execução de uma
  instância que foi reiniciada. A saída de uma instância que foi substituída por
  um deploy é perdida. Grave qualquer informação que precise manter no banco de
  dados ou em um serviço de logs próprio.
- **Escalar para zero** não é oferecido. Todo backend executa pelo menos uma
  instância o tempo todo.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculação, deploy, os parâmetros de
  computação e o que o beta não inclui
- [Custom Functions](/docs/backend/custom-functions/): escrevendo as rotas em
  `backend/functions/`
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/): o que é um bundle
  e como o runtime o inicializa
- [Armazenamento](/docs/backend/storage/): buckets, endpoints, limites de tamanho
  e regras de acesso
- [Executando mais de uma instância](/docs/deployment/multiple-instances/): o
  estado que o Rebase mantém por processo
