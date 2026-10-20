---
sourceHash: f02c2b6d0bb6de5f
title: Runtime de backend gerenciado
sidebar_label: Runtime Gerenciado
description: O que um backend com runtime "managed" pode e não pode fazer no Rebase Cloud — pacotes e binários, memória e CPU, timeouts e tamanhos de corpo, o sistema de arquivos, estado em memória, segredos, armazenamento para arquivos gerados e rede de saída.
---

Uma aplicação backend declarada desta forma no `rebase.json` é executada no **runtime gerenciado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Gerenciado significa que você envia um bundle, não uma imagem. O `rebase cloud deploy` compila suas collections, `backend/functions/` e crons no `dist-bundle`, faz o upload, e o Rebase Cloud o inicializa na imagem pública `rebasepro/server`. Você nunca precisa escrever um Dockerfile, e também não pode alterar o conteúdo da imagem. Esta página lista o que isso permite, para que você possa planejar uma funcionalidade antes de construí-la.

Os números aqui apresentados vêm do runtime e da plataforma como estão hoje. Alguns são ajustes que você pode alterar, e a página indica quais são. As poucas coisas que ainda não são garantidas estão reunidas [ao final](#ainda-não-garantido).

## Visão geral

| Pergunta | Resposta |
|---|---|
| Versão do Node | Node 22, no Debian slim, `linux`/`x64` |
| Pacotes npm | Sim, do registro público ou de um privado. Instalados quando cada instância inicia |
| Módulos nativos (`.node`, node-gyp) | Não. O `rebase cloud deploy` recusa o bundle |
| WebAssembly | Sim |
| Criar um processo filho (child process) | Sim, para um binário `linux`/`x64` fornecido por um pacote npm. Consulte [Binários](#binários-e-processos-filhos) |
| Memória e CPU | Definido por projeto com `rebase cloud compute`. Consulte [Computação](#computação-e-instâncias) |
| Instâncias | 1 por padrão, sempre ativas. Você pode fixar até 5, ou permitir que o autoscaler chegue a até 16 |
| Timeout de função | 30 segundos, depois `504 FUNCTION_TIMEOUT`. Configurável até 10 minutos |
| Corpo da requisição (request body) | 10 MiB, depois `413`. Configurável, até os 64 MiB aceitos pelo edge |
| Sistema de arquivos com permissão de escrita | Sim, mas é temporário e pertence a uma única instância |
| Estado em nível de módulo (um cache com `Map`) | Sobrevive entre requisições em uma mesma instância. Perdido a cada deploy e reinicialização, e não compartilhado entre instâncias |
| Variáveis de ambiente e segredos | `rebase cloud env set`, aplicados no próximo deploy |
| Armazenamento de arquivos | Um bucket por projeto, servido pelo seu backend em `/api/storage/file/…` |
| HTTP de saída | Sim, nas portas 80 e 443 (e 465, 587, 993 para e-mail). Outras portas são bloqueadas. Sem IP de saída fixo |

## Código e pacotes

**Node e a imagem.** A imagem do runtime é construída sobre `node:22-slim` (Debian), e seu bundle roda em `linux`/`x64` como um usuário sem privilégios de root. O seu `tsconfig` e a versão do Node na sua máquina não alteram isso.

**Dependências.** O bundle lista as dependências declaradas pelos seus arquivos `package.json`. O upload não inclui a pasta `node_modules`. Cada instância instala as dependências quando inicializa, com `npm ci` (ou `npm install` caso não haja um lockfile). Disso decorrem quatro coisas:

- **Scripts de instalação nunca são executados.** A instalação usa `--ignore-scripts`. Um pacote que baixa um binário ou compila algo no `postinstall` será instalado sem isso.
- **Apenas versões de registro são instaladas.** Uma dependência `file:`, `link:`, `git+…` ou `github:` causa falha na compilação, pois o runtime não tem como resolvê-la.
- **Alguns pacotes vêm da imagem, não de você.** `@rebasepro/*`, `hono`, `@hono/node-server` e `zod` são removidos das dependências do bundle e as cópias da própria imagem são vinculadas, portanto a sua versão deles não se aplica. `typescript` e `tsx` também são removidos; eles são ferramentas de compilação.
- **Pacotes privados precisam de um `.npmrc`.** O `rebase build` copia o `.npmrc` do projeto (e `backend/.npmrc`) para o bundle, para que a instalação use as mesmas configurações de registro da sua máquina. Toda credencial nele deve ser uma referência a variável de ambiente, nunca o token em si; um token literal falha a compilação, pois o bundle é enviado junto com o seu código:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

O upload do bundle é limitado a 100 MB, compactado, sem dependências.

**Módulos nativos são recusados.** Um pacote que inclui um binário `.node` compilado não pode ser carregado no runtime gerenciado. O `rebase build` emite um aviso sobre isso, e o `rebase cloud deploy` interrompe antes do upload:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

A verificação procura por pacotes nativos conhecidos (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), por `binding.gyp` ou `gypfile`, por scripts de instalação que chamam `node-gyp` ou `prebuild`, e por arquivos `.node`. O [guia de implantação](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) lista as soluções usuais. A versão resumida: faça o processamento no momento da compilação (build time), chame um serviço externo ou faça o deploy com `runtime: "custom"`.

**WebAssembly funciona.** Um pacote que fornece um arquivo `.wasm` e o carrega a partir do JavaScript não é um módulo nativo, e o Node 22 o executa. Testado na imagem base do runtime com as configurações de segurança do pod, usando `esbuild-wasm`. Lembre-se do [limite de memória](#computação-e-instâncias) caso o módulo seja grande, como um modelo de fala ou ML.

### Binários e processos filhos

`child_process` funciona. A imagem em si tem pouquíssimos utilitários para executar: `node`, `npm`, `sh`, `tar` e as ferramentas de cliente do PostgreSQL (`pg_dump`, `pg_restore`). Não há `ffmpeg`, nem ImageMagick, nem Python e nenhum compilador, e você não pode adicionar pacotes do sistema, pois não há Dockerfile e o processo não roda como root.

Um binário que um pacote npm inclui **dentro do seu próprio tarball** é instalado com o pacote e executado. Ele deve ser compilado para `linux`/`x64` com glibc (Debian), e roda como um usuário sem privilégios e sem Linux capabilities. Verificado com `@esbuild/linux-x64` na imagem base do runtime. Um binário que um pacote *baixa* durante o `postinstall` nunca chega a existir, pois scripts de instalação não são executados; pacotes como `ffmpeg-static` funcionam dessa forma.

Se uma funcionalidade precisa de um binário, utilize uma API externa hospedada para esse trabalho ou migre o backend para `runtime: "custom"`, onde você constrói sua própria imagem.

## Computação e instâncias

Cada projeto roda em seus próprios pods. Memória e CPU são alocadas por instância, e você as define por meio dos [ajustes de computação](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Um projeto que nunca configurou esses parâmetros roda como um pod com capacidade de rajada (burstable): ele reserva `100m` de CPU e `384Mi` de memória, podendo atingir picos de até 2 CPUs e 2 GiB. Uma configuração explícita mantém essa proporção entre solicitação (request) e limite (limit). Execute `rebase cloud compute` para ver a alocação atual do seu projeto.

Instâncias:

- **Uma por padrão, sempre em execução.** `--replicas` fixa entre 1 e 5. Nada escala um backend para zero.
- **O autoscaling é opcional.** `--autoscale-max` define um teto de até 16, e `--autoscale-cpu-target` (padrão 70) define o uso de CPU que o autoscaler busca manter.
- **Os deploys são graduais (rolling).** Uma nova instância inicia e fica pronta antes que a antiga seja interrompida, de modo que por um breve período duas versões atendem ao tráfego.

`--spot` fica desativado por padrão; instâncias spot são mais baratas e reiniciadas sem aviso prévio.

## Memória e estado em nível de módulo

Um valor no nível do módulo, como `const cache = new Map()` no topo de um arquivo de função, reside no processo do Node. Ele sobrevive de uma requisição para a próxima na mesma instância. Ele é perdido sempre que esse processo é encerrado:

- a **cada deploy**, pois cada deploy inicia novas instâncias;
- quando uma **variável de ambiente** é alterada e aplicada via deploy;
- quando uma instância é reiniciada, reagendada ou (com `--spot`) revogada.

Com mais de uma instância, cada uma tem sua própria cópia, de modo que duas requisições podem ver caches diferentes.

Use um `Map` em nível de módulo como um cache que você pode se dar ao luxo de perder: algo que torna a próxima requisição mais rápida, mas que não é a única cópia do dado. Guarde tudo o que custou para ser gerado, como áudio gerado ou uma resposta dispendiosa de API, no banco de dados ou no [armazenamento](#armazenamento-para-arquivos-gerados). Para clientes instanciados uma única vez, como um SDK de API, use `lazyResource` para que o cliente seja criado no primeiro uso a partir do ambiente da requisição. Consulte [Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

[Executando mais de uma instância](/docs/deployment/multiple-instances/) lista o estado que o próprio Rebase mantém por processo, como contadores de limite de taxa (rate limit) e canais em tempo real.

## O sistema de arquivos

O sistema de arquivos do container permite escrita, e `/tmp` funciona. Mas tudo o que é gravado ali:

- pertence a uma única instância, e outras instâncias não o enxergam;
- é excluído quando a instância é interrompida, portanto, o mais tardar no próximo deploy;
- compartilha um limite de 6 GiB de armazenamento efêmero com o bundle e seus `node_modules` instalados. Uma instância que exceder esse limite é despejada (evicted).

Use-o para arquivos temporários de rascunho durante uma requisição. Não o use como cache entre deploys nem como armazenamento para uploads. É também por isso que [`STORAGE_TYPE=local` é desativado em produção](/docs/backend/storage/#environment-variables).

## Requisições

| Limite | Padrão | Alterar com |
|---|---|---|
| Timeout de função | 30 s, depois `504` com código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` desativa) |
| Espera na sua instância, no edge | 10 minutos entre leituras ou gravações | Fixo |
| Corpo da requisição, todas as rotas `/api/*` | 10 MiB, depois `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, em bytes |
| Corpo da requisição no edge | 64 MiB | Fixo |
| Um arquivo via `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chamadas anônimas para `/api/functions/*` | 3.000 por IP a cada 15 minutos | `rateLimit.anonymousFunctions` |

Alguns detalhes:

- **O timeout libera o chamador, não o processamento.** Aos 30 segundos, quem fez a requisição recebe um `504`, e `getSignal(c)` é abortado. Passe esse signal para `fetch` e qualquer outra chamada que aceite um, para que o processamento também seja interrompido. Consulte [Timeouts e Limites de Taxa](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **O edge espera mais tempo do que o runtime.** O ingress na frente das suas instâncias aguarda até 10 minutos, portanto o limite atingido por uma requisição é o do runtime, que responde em JSON e aborta o signal. Aumente `REBASE_FUNCTIONS_TIMEOUT_MS` até esse limite. Para tarefas que demoram mais ou que precisam sobreviver a um deploy (uma instância faz drain por 15 segundos), responda imediatamente e execute o trabalho em um [job](/docs/backend/jobs/).
- **Uploads maiores que 64 MiB** precisam do upload resumível (TUS), que envia o arquivo em partes (chunks). O `client.storage.putObject()` alterna para ele automaticamente acima de 8 MiB.
- **Tamanho da resposta.** Nem o runtime nem o edge impõem um limite para o tamanho da resposta. Uma resposta grande ainda é mantida na memória se o seu handler a construir inteira de uma vez, portanto envie-a como stream ou sirva-a a partir do storage.

## Variáveis de ambiente e segredos

Defina-as com a CLI ou no console. Não há um campo para elas no `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Uma alteração é aplicada no próximo deploy.** Instâncias em execução mantêm os valores com os quais iniciaram. `set` e `unset` alertam sobre isso (`Pending redeploy`).
- **Limites:** até 100 variáveis por projeto, 32 KiB por valor e 256 KiB no total. Os nomes seguem `[A-Za-z_][A-Za-z0-9_]*`.
- **Alguns nomes são reservados.** A plataforma define `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV` por conta própria, e fixa a forma como o processo executa (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Definir qualquer um desses é recusado, e o erro lista todos eles.
- **`CORS_ORIGINS` começa a partir dos seus domínios.** A plataforma o define para o host do projeto e seus [domínios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados. Um `CORS_ORIGINS` que você definir é adicionado a essa lista, permitindo frontends servidos em outro local: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **As variáveis de storage são padrões.** A plataforma preenche as variáveis `STORAGE_*` e `S3_*` para o bucket dela, e qualquer valor que você definir tem precedência.
- **Nomes de build-time são recusados.** As variáveis `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e `REACT_APP_` destinam-se a frontends durante o build, e o backend nunca tem acesso a elas a tempo. O uso de `--force` armazena mesmo assim.

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

Uma leitura de `process.env` no escopo do módulo que retorne vazio faz com que o arquivo inteiro falhe ao carregar, e suas rotas respondam com `404`. Consulte [Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

## Armazenamento para arquivos gerados

Um projeto Cloud ganha armazenamento de arquivos assim que você o cria:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Ou aponte o projeto para um bucket que você já possui com `rebase cloud storage attach` (S3, R2, MinIO, qualquer bucket compatível com S3). Sem nenhum dos dois, uploads retornam `501 STORAGE_NOT_CONFIGURED`. Buckets adicionais são declarados em `config/resources.ts`; consulte [Múltiplos Buckets](/docs/backend/storage/#several-buckets).

Um deploy com storage configurado é recusado até que o projeto defina quem pode ler e gravar arquivos. O arquivo `config/storage.ts` gerado pelo scaffold exporta um hook `storageAuthorize` para isso. Consulte [Autorização por Objeto](/docs/backend/storage/#per-object-authorization).

**Como os arquivos são servidos.** Seu backend serve cada arquivo em `GET /api/storage/file/<key>`. Ele lê o objeto do bucket e o transmite via stream, com `Content-Type`, suporte a requisições de intervalo (range requests) e cabeçalhos de cache. Não há uma URL direta do bucket para disponibilizar.

- Uma chave sob **`public/`** é servida para qualquer pessoa, sem token, em uma URL que nunca muda. Use-a para arquivos que qualquer visitante possa carregar, como áudio gerado para um jogo público.
- Qualquer outra chave é privada. O cliente solicita a `/api/storage/metadata/<key>` uma URL de download contendo um token, válido por padrão por 300 segundos (`STORAGE_DOWNLOAD_TOKEN_TTL`, configurável até uma semana).

A partir de uma função, grave com `rebase.storage` (o bucket padrão) ou `rebase.bucket(…)` (um bucket nomeado). Seu hook `storageAuthorize` continuará decidindo se a gravação é permitida.

Transformações de imagem (`?width=`, `?format=`) precisam do `sharp`, que é um módulo nativo e não está presente na imagem gerenciada. No runtime gerenciado, uma requisição de transformação retorna a imagem original.

### Exemplo: fazer cache de áudio gerado

Uma função que converte texto em fala usando uma API hospedada, armazena cada resultado uma única vez e o serve a partir do storage nas requisições seguintes. O `Map` serve apenas para economizar uma consulta ao storage em uma instância ativa ("warm"); o bucket é o cache real, portanto um deploy não perde nada.

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

A rota é pública, como qualquer rota em `backend/functions/` até que você a proteja. Uma implementação real verificaria quem tem permissão para criar novos áudios, para evitar que terceiros consumam seu orçamento na API de fala.

## Rede de saída

Funções podem chamar serviços externos. Conexões de saída a partir das suas instâncias são permitidas para qualquer endereço de internet apenas nestas portas TCP:

| Porta | Finalidade |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Envio de e-mail via SMTP com TLS ou STARTTLS |
| 993 | IMAP sobre TLS |

Todo o restante é bloqueado. Isso inclui a porta 25, IMAP sem criptografia, e bancos de dados ou caches em suas portas padrão: um PostgreSQL na porta 5432, Redis na 6379 ou MongoDB na 27017 fora do Rebase Cloud não podem ser acessados. O endereço de metadados da nuvem (`169.254.169.254`) também é bloqueado.

A plataforma não adiciona proxy nem limite de taxa de saída; os serviços que você chama possuem seus próprios limites. Passe `getSignal(c)` para o `fetch` para que uma chamada seja cancelada caso a requisição sofra timeout.

**Não há endereço IP de saída fixo**. O tráfego sai por um endereço compartilhado por todos os projetos, que o provedor de nuvem atribui e pode alterar, portanto não o adicione a uma lista de permissões (allowlist) de terceiros. Em vez disso, autentique-se nesses serviços com uma chave ou token.

## Inicialização e encerramento

- **Cold start.** Uma nova instância baixa o bundle e instala suas dependências antes de começar a atender. Essa instalação representa a maior parte do cold start, durando tipicamente de 40 a 60 segundos. A plataforma aguarda até 300 segundos para que uma instância fique ativa. Uma árvore de dependências grande torna cada deploy e cada aumento de escala (scale-up) mais lento.
- **Health check.** A plataforma verifica `/livez` (se o processo está rodando) e `/health` (se consegue alcançar o banco de dados). Ambos são servidos pelo runtime, portanto você não precisa implementá-los.
- **Encerramento.** Em um deploy ou reinicialização, a instância para de aceitar novas requisições, aguarda 5 segundos para a transição do tráfego e recebe um `SIGTERM`. Requisições em andamento têm até 15 segundos para serem concluídas. Promises passadas para `waitUntil` recebem até 5 segundos desse tempo. Uma promise que não foi repassada para `waitUntil` é descartada. Consulte [Trabalho em Segundo Plano](/docs/backend/custom-functions/#background-work).

## Quando o modo gerenciado não é o ideal

Mude o backend para `"runtime": "custom"` quando ele precisar de:

- um módulo nativo ou um binário do sistema que nenhum pacote npm forneça, como `sharp`, ImageMagick ou um motor de fala local;
- pacotes do sistema operacional ou uma imagem base diferente;
- uma conexão de longa duração com algo fora das portas permitidas.

Um runtime customizado compila seu próprio Dockerfile, e você passa a gerenciar a imagem a partir de então. O comando `rebase cloud deploy --eject` realiza essa transição. Consulte [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Ainda não garantido

- **Histórico de logs.** `rebase cloud logs --runtime` lê das instâncias que estão em execução, e `rebase cloud debug logs --previous` lê da última execução de uma instância que foi reiniciada. A saída de uma instância substituída por um deploy é perdida. Escreva qualquer dado que você precise manter no banco de dados ou em um serviço próprio de logs.
- **Escalar para zero (scale to zero)** não é oferecido. Todo backend executa pelo menos uma instância em tempo integral.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculação, deploy, parâmetros de computação e o que o beta não inclui
- [Funções Customizadas](/docs/backend/custom-functions/): escrevendo as rotas em `backend/functions/`
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/): o que é um bundle e como o runtime o inicializa
- [Storage](/docs/backend/storage/): buckets, endpoints, limites de tamanho e regras de acesso
- [Executando mais de uma instância](/docs/deployment/multiple-instances/): o estado mantido pelo Rebase por processo
