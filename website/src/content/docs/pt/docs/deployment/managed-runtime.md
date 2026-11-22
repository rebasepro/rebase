---
sourceHash: a657ab288833ddd3
title: Runtime de backend gerenciado
sidebar_label: Runtime Gerenciado
description: O que um backend com runtime "managed" pode e não pode fazer no Rebase Cloud — pacotes e binários, memória e CPU, limites de tempo e tamanhos de corpo, o sistema de arquivos, estado em memória, segredos, armazenamento para arquivos gerados e rede de saída.
---

Um aplicativo de backend declarado desta forma no `rebase.json` é executado no **runtime gerenciado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Gerenciado significa que você envia um bundle, não uma imagem. O comando `rebase cloud deploy` compila suas tabelas, `backend/functions/` e crons no `dist-bundle`, faz o upload dele e o Rebase Cloud o inicializa na imagem publicada `rebasepro/server`. Você nunca precisa escrever um Dockerfile e também não pode alterar o conteúdo da imagem. Esta página lista o que isso permite, para que você possa planejar uma funcionalidade antes de desenvolvê-la.

Os números aqui apresentados provêm do runtime e da plataforma como são hoje. Alguns são ajustes que você pode alterar, e a página indica quais são. As poucas coisas que ainda não estão garantidas estão reunidas [ao final](#ainda-não-prometido).

## Visão geral

| Pergunta | Resposta |
|---|---|
| Versão do Node | Node 22, no Debian slim, `linux`/`x64` |
| Pacotes npm | Sim, do registro público ou de um privado. Instalados no bundle quando você faz o deploy |
| Módulos nativos (`.node`, node-gyp) | Não. O `rebase cloud deploy` recusa o bundle |
| WebAssembly | Sim |
| Criar um processo filho (child process) | Sim, para um binário `linux`/`x64` fornecido por um pacote npm. Consulte [Binários](#binários-e-processos-filhos) |
| Memória e CPU | Definidos por projeto com `rebase cloud compute`. Consulte [Computação](#computação-e-instâncias) |
| Instâncias | 1 por padrão, sempre ativa. Você pode fixar até 5, ou permitir que o autoscaler suba até 16 |
| Limite de tempo da função (timeout) | 30 segundos, depois `504 FUNCTION_TIMEOUT`. Configurável em até 10 minutos |
| Corpo da requisição | 10 MiB, depois `413`. Configurável, até os 64 MiB aceitos pelo edge |
| Sistema de arquivos gravável | Sim, mas é temporário e pertence a uma única instância |
| Estado em nível de módulo (um cache `Map`) | Sobrevive entre requisições na mesma instância. Perdido em cada deploy e reinicialização, e não compartilhado entre instâncias |
| Variáveis de ambiente e segredos | `rebase cloud env set`, aplicados no próximo deploy |
| Armazenamento de arquivos | Um bucket por projeto, servido pelo seu backend em `/api/storage/file/…` |
| HTTP de saída | Sim, nas portas 80 e 443 (e 465, 587, 993 para e-mail). Outras portas são bloqueadas. Um IP de saída fixo: `207.175.138.15` |

## Código e pacotes

**Node e a imagem.** A imagem do runtime é baseada em `node:22-slim` (Debian), e seu bundle roda em `linux`/`x64` como um usuário não-root. O seu `tsconfig` e a versão do Node na sua máquina não alteram isso.

**Dependências.** O `rebase cloud deploy` instala as dependências que seus arquivos `package.json` declaram no bundle, para `linux`/`x64`, e faz o upload delas junto com ele, para que uma nova instância não precise instalar nada. Um bundle que ultrapassaria o limite de upload de 1 GB com elas é enviado sem elas, e o deploy avisa: cada instância as instala ao iniciar, com `npm ci` (ou `npm install` sem um arquivo lockfile). Quatro regras decorrem da forma como são instaladas:

- **Scripts de instalação nunca são executados.** A instalação usa `--ignore-scripts`. Um pacote que baixa um binário ou compila algo no `postinstall` é instalado sem isso.
- **Apenas versões de registro são instaladas.** Dependências do tipo `file:`, `link:`, `git+…` ou `github:` falham na compilação, porque o runtime não tem como resolvê-las.
- **Alguns pacotes vêm da imagem, não de você.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` e `zod` são removidos das dependências do bundle e as próprias cópias da imagem são vinculadas, portanto a sua versão deles não é aplicada. Outros pacotes `@rebasepro/*`, como o driver de banco de dados, são instalados a partir do seu `package.json` como qualquer dependência. `typescript` e `tsx` também são removidos; eles são ferramentas de compilação (build).
- **Pacotes privados precisam de um `.npmrc`.** O `rebase build` copia o `.npmrc` do projeto (e `backend/.npmrc`) para o bundle, para que a instalação use as mesmas configurações de registro da sua máquina. Cada credencial nele deve ser uma referência de variável de ambiente, nunca o token em si; um token literal causará falha na compilação, pois o bundle é enviado junto com o seu código:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

O upload do bundle tem limite máximo de 1 GB, compactado.

**Módulos nativos são recusados.** Um pacote que fornece um binário compilado `.node` não pode ser carregado no runtime gerenciado. O `rebase build` avisa sobre isso, e o `rebase cloud deploy` é interrompido antes do upload:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

A verificação busca pacotes nativos conhecidos (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), por `binding.gyp` ou `gypfile`, por scripts de instalação que chamam `node-gyp` ou `prebuild`, e por arquivos `.node`. O [guia de deploy](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) lista as soluções comuns. Em resumo: faça o processamento em tempo de build, chame um serviço externo ou faça deploy com `runtime: "custom"`.

**WebAssembly funciona.** Um pacote que fornece um arquivo `.wasm` e o carrega a partir de JavaScript não é um módulo nativo, e o Node 22 o executa. Testado na imagem base do runtime com as configurações de segurança do pod, usando `esbuild-wasm`. Lembre-se do [limite de memória](#computação-e-instâncias) caso o módulo seja grande, como um modelo de voz ou ML.

### Binários e processos filhos

O `child_process` funciona. A imagem em si tem muito pouco para executar: `node`, `npm`, `sh`, `tar` e as ferramentas cliente do PostgreSQL (`pg_dump`, `pg_restore`). Não há `ffmpeg`, nem ImageMagick, nem Python e nem compilador, e você não pode adicionar pacotes do sistema, porque não há Dockerfile e o processo não é root.

Um binário que um pacote npm inclui **dentro do seu próprio tarball** é instalado com o pacote e executado. Ele deve ser compilado para `linux`/`x64` contra a glibc (Debian), e roda como um usuário sem privilégios e sem Linux capabilities. Testado com `@esbuild/linux-x64` na imagem base do runtime. Um binário que um pacote *baixa* no `postinstall` nunca chega a existir, pois os scripts de instalação não são executados; pacotes como `ffmpeg-static` funcionam dessa forma.

Se um recurso precisar de um binário, use uma API hospedada para essa tarefa ou mude o backend para `runtime: "custom"`, onde você cria sua própria imagem.

## Computação e instâncias

Cada projeto roda em seus próprios pods. Memória e CPU são por instância, e você os define com os [ajustes de computação](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Um projeto que nunca configurou esses valores roda como um pod burstable. Na Bélgica (europe-west1), o padrão reserva 100m de CPU e 384Mi, podendo fazer burst até 2 CPU e 2 GiB; em Falkenstein e Helsinque, a memória pode se estender até 1,4× a solicitação e a CPU até 10× (no máximo 1.7 vCPU). O comando `rebase cloud compute` exibe os números do seu projeto.

Instâncias:

- **Uma por padrão, sempre em execução.** `--replicas` fixa entre 1 e 5. Nada escala um backend para zero.
- **Autoscaling é opcional (opt-in).** `--autoscale-max` define um teto de até 16, e `--autoscale-cpu-target` (padrão 70) o uso de CPU que o autoscaler busca manter.
- **Os deploys são graduais (rolling).** Uma nova instância é iniciada e se torna pronta antes que a antiga seja interrompida, de modo que, por um breve momento, duas versões atendem ao tráfego.

`--spot` fica desativado por padrão; instâncias spot são mais baratas e são reiniciadas sem aviso prévio.

## Memória e estado em nível de módulo

Um valor em nível de módulo, como `const cache = new Map()` no topo de um arquivo de função, reside no processo Node. Ele sobrevive de uma requisição para a próxima na mesma instância. Ele é perdido sempre que esse processo é encerrado:

- a **cada deploy**, pois cada deploy inicia novas instâncias;
- quando uma **variável de ambiente** é alterada e publicada no deploy;
- quando uma instância é reiniciada, reagendada ou (com `--spot`) recuperada.

Com mais de uma instância, cada uma possui sua própria cópia, de forma que duas requisições podem enxergar caches diferentes.

Use um `Map` em nível de módulo como um cache que você pode se dar ao luxo de perder: um que torne a próxima requisição mais rápida, mas que não seja a única cópia de nada. Guarde tudo o que custou recursos para produzir, como um áudio gerado ou uma resposta cara de API, no banco de dados ou no [armazenamento](#armazenamento-para-arquivos-gerados). Para clientes instanciados uma única vez, como o SDK de uma API, use `lazyResource` para que o cliente seja instanciado no primeiro uso a partir do ambiente da requisição. Consulte [Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

A seção [Executando mais de uma instância](/docs/deployment/multiple-instances/) lista o estado que o próprio Rebase mantém por processo, como contadores de limite de taxa (rate-limit) e canais em tempo real.

## O sistema de arquivos

O sistema de arquivos do container é gravável, e `/tmp` funciona. No entanto, tudo o que for gravado ali:

- pertence a uma única instância, e outras instâncias não têm acesso;
- é excluído quando a instância para, portanto, no mais tardar no próximo deploy;
- compartilha um limite de 6 GiB de armazenamento efêmero com o bundle e seus `node_modules` instalados. Uma instância que exceder esse limite é despejada (evicted).

Use-o para arquivos temporários durante uma única requisição. Não o utilize como cache entre deploys nem como armazenamento para uploads. Essa é também a razão pela qual [`STORAGE_TYPE=local` fica desativado em produção](/docs/backend/storage/#environment-variables).

## Requisições

| Limite | Padrão | Altere com |
|---|---|---|
| Timeout de função | 30 s, depois `504` com o código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` desativa), ou no próprio `defineFunction(…, { timeoutMs })` de uma função |
| Timeout próprio de uma função, no máximo | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Espera na sua instância, no edge | 10 minutos entre leituras ou gravações | Fixo |
| Corpo da requisição, rotas `/api/*` sem limite próprio | 10 MiB, depois `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, em bytes |
| Corpo da requisição no edge | 64 MiB | Fixo |
| Um arquivo via `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chamadas anônimas para `/api/functions/*` | 3000 por IP a cada 15 minutos | `rateLimit.anonymousFunctions` |

Alguns detalhes:

- **O timeout libera quem fez a chamada, não o processamento.** Aos 30 segundos, o originador da chamada recebe um `504`, e `getSignal(c)` é abortado. Passe esse sinal para `fetch` e para qualquer outra coisa que aceite um signal, para que o trabalho também seja interrompido. Consulte [Timeouts e Limites de Taxa](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **O edge espera mais tempo do que o runtime.** O ingress na frente das suas instâncias aguarda até 10 minutos, portanto o limite atingido pela requisição é o do runtime, que responde com JSON e aborta o sinal. Aumente `REBASE_FUNCTIONS_TIMEOUT_MS` até esse valor, ou atribua à função que necessita o seu próprio [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits). Para trabalhos que demoram mais ou que precisam sobreviver a um deploy (uma instância faz drain por 15 segundos), responda imediatamente e processe o trabalho em um [job](/docs/backend/jobs/).
- **Uploads maiores que 64 MiB** exigem o upload com retomada (TUS), que envia o arquivo em partes (chunks). `client.storage.putObject()` migra para ele automaticamente acima de 8 MiB.
- **Tamanho da resposta.** Nem o runtime nem o edge definem um limite no tamanho da resposta. Ainda assim, uma resposta grande é mantida na memória se o seu handler a construir inteira de uma só vez; portanto, envie-a via stream ou sirva-a a partir do storage.

### Monitores e tarefas agendadas em `/metrics`
<span class="since-badge" data-since="0.35">Desde 0.35</span>

Uma requisição vinda de um monitor de uptime conhecido (identificado pelo seu `User-Agent`), ou uma que carregue o cabeçalho `x-rebase-probe` com qualquer valor, é atendida mas contabilizada em `rebase_probe_requests_total` em vez de `rebase_requests_total`, para que um monitor não seja interpretado como tráfego. `rebase_scheduled_jobs` é o número de cron jobs ativados e registrados no aplicativo, e `rebase_background_workers` é 1 enquanto esse processo executa um worker de fila de jobs; ambos param enquanto uma implantação é escalada para zero, razão pela qual uma plataforma que suspende projetos inativos os lê.

## Variáveis de ambiente e segredos

Defina-os usando a CLI ou no console. Não há campo para eles no `rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Uma alteração entra em vigor no próximo deploy.** As instâncias em execução mantêm os valores com os quais iniciaram. Os comandos `set` e `unset` lembram você disso (`Pending redeploy`).
- **Limites:** até 100 variáveis por projeto, 32 KiB por valor e 256 KiB no total. Os nomes seguem `[A-Za-z_][A-Za-z0-9_]*`.
- **Alguns nomes são reservados.** A própria plataforma define `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV`, e determina a forma de execução do processo (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Tentar definir um desses é recusado, e o erro lista todos eles.
- **`CORS_ORIGINS` começa a partir dos seus domínios.** A plataforma o define com o host do projeto e seus [domínios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados. Um `CORS_ORIGINS` configurado por você é adicionado a essa lista, para um frontend hospedado em outro lugar: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **As variáveis de storage são padrões.** A plataforma define as variáveis `STORAGE_*` e `S3_*` para o seu bucket, e um valor definido por você tem precedência.
- **Nomes de build-time são recusados.** Variáveis como `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e `REACT_APP_` são destinadas a frontends em tempo de build, e o backend nunca as recebe a tempo. `--force` força o salvamento de uma delas mesmo assim.

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

A leitura de `process.env` no escopo do módulo que retorne vazia faz com que todo o arquivo falhe ao carregar, e suas rotas responderão com `404`. Consulte [Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

## Armazenamento para arquivos gerados

Um projeto Cloud ganha armazenamento de arquivos assim que você o cria:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Ou aponte o projeto para um bucket que você já possui com `rebase cloud storage attach` (S3, R2, MinIO, ou qualquer bucket compatível com S3). Sem nenhum dos dois, uploads respondem com `501 STORAGE_NOT_CONFIGURED`. Mais buckets podem ser declarados em `backend/resources.ts`; consulte [Vários Buckets](/docs/backend/storage/#several-buckets).

Um deploy com storage é recusado até que o projeto defina quem pode ler e gravar arquivos. O scaffold `backend/storage.ts` exporta um hook `storageAuthorize` para isso. Consulte [Autorização por Objeto](/docs/backend/storage-authorization/).

**Como os arquivos são servidos.** Seu backend serve cada arquivo em `GET /api/storage/file/<key>`. Ele lê o objeto do bucket e o transmite via stream, com `Content-Type`, requisições de intervalo (range requests) e cabeçalhos de cache. Não há uma URL direta do bucket para compartilhar.

- Uma chave sob **`public/`** é servida para qualquer pessoa, sem token, em uma URL que nunca muda. Use-a para arquivos que qualquer visitante pode carregar, como áudio gerado para um jogo público.
- Qualquer outra chave é privada. Um cliente requisita a `/api/storage/metadata/<key>` uma URL de download contendo um token, válido por 300 segundos por padrão (`STORAGE_DOWNLOAD_TOKEN_TTL`, até uma semana).

A partir de uma função, grave com `rebase.storage` (o bucket padrão) ou `rebase.bucket(…)` (um bucket nomeado). Seu hook `storageAuthorize` ainda decide se a gravação é permitida.

Transformações de imagem (`?width=`, `?format=`) precisam do `sharp`, que é um módulo nativo e não está presente na imagem gerenciada. No runtime gerenciado, uma requisição de transformação retorna a imagem original.

### Exemplo: armazenar em cache áudio gerado

Uma função que transforma texto em fala usando uma API hospedada, armazena cada resultado uma única vez e o serve a partir do storage nas vezes seguintes. O `Map` serve apenas para evitar uma busca no storage em uma instância aquecida; o bucket é o cache real, de forma que um deploy não perde nada.

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

A rota é pública, como todas as rotas em `backend/functions/` até que você a proteja. Uma implementação real verificaria quem tem permissão para criar novos áudios, para que terceiros não consumam seu orçamento na API de fala.

## Rede de saída

As funções podem chamar serviços externos. Conexões de saída das suas instâncias são permitidas para qualquer endereço da internet apenas nestas portas TCP:

| Porta | Finalidade |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Envio de e-mail via SMTP com TLS ou STARTTLS |
| 993 | IMAP via TLS |

Tudo o mais é bloqueado. Isso inclui a porta 25, IMAP sem criptografia, e bancos de dados ou caches em suas próprias portas: Redis na porta 6379 ou MongoDB na 27017 fora do Rebase Cloud não podem ser acessados. O endereço de metadados de nuvem (`169.254.169.254`) também é bloqueado.

A única exceção é o seu próprio banco de dados. Se o projeto utiliza seu próprio PostgreSQL (BYODB), cada deploy também permite conexões ao host desse banco de dados na porta especificada em sua connection string, e a nada mais nessa porta. O host é resolvido para seus endereços IP no momento do deploy, portanto, se seu provedor mover o banco de dados para outro endereço, faça deploy novamente. O banco de dados deve aceitar conexões da internet: o aplicativo se conecta diretamente à connection string. As configurações do bastion SSH são usadas apenas pelo teste de conexão, não pelo aplicativo em produção.

A plataforma não adiciona proxy e nenhum rate limit de saída; os serviços chamados possuem seus próprios limites. Passe `getSignal(c)` para o `fetch` para que uma chamada pare quando a requisição atingir o timeout.

Todo o tráfego de saída parte de **um único endereço IP fixo, `207.175.138.15`**. Adicione-o à lista de permissões (allowlist) de terceiros quando um serviço exigir uma. O endereço é compartilhado por todos os projetos no Rebase Cloud, de modo que constar na lista de permissões prova que a chamada vem do Rebase Cloud, mas não que se trata do seu projeto: continue autenticando no serviço com uma chave também.

## Inicialização e encerramento

- **Cold start.** Uma nova instância baixa e descompacta o bundle antes de começar a atender, portanto uma árvore de dependências grande torna cada escalonamento mais lento. Um bundle enviado sem suas dependências também as instala nessa etapa, o que adiciona de 40 a 60 segundos. A plataforma aguarda até 300 segundos para que uma instância suba.
- **Saúde (Health).** A plataforma verifica `/livez` (o processo está em execução) e `/health` (ele consegue alcançar o banco de dados). Ambos são servidos pelo runtime, de modo que você não precisa implementá-los.
- **Encerramento.** Em um deploy ou reinicialização, a instância para de aceitar novas requisições, aguarda 5 segundos para que o tráfego seja redirecionado e então recebe o sinal `SIGTERM`. Requisições em andamento têm até 15 segundos para serem concluídas. Promises passadas para `waitUntil` recebem até 5 segundos desse tempo. Uma promise que você não entregou ao `waitUntil` é descartada. Consulte [Trabalho em Segundo Plano](/docs/backend/custom-functions/#background-work).

## Quando o gerenciado não é o ideal

Mude o backend para `"runtime": "custom"` quando ele precisar de:

- um módulo nativo, ou um binário de sistema que nenhum pacote npm forneça, como `sharp`, ImageMagick ou um motor de voz local;
- pacotes de sistema ou uma imagem base diferente;
- uma conexão de longa duração com algo fora das portas permitidas.

Um runtime customizado compila seu próprio Dockerfile, e você passa a gerenciar a imagem a partir de então. O comando `rebase cloud deploy --eject` faz essa transição. Consulte [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Ainda não prometido

- **Histórico de logs.** `rebase cloud logs --runtime` lê das instâncias em execução, e `rebase cloud debug logs --previous` da última execução de uma que reiniciou. A saída de uma instância substituída por um deploy é perdida. Escreva qualquer informação que precise reter no banco de dados ou em um serviço de logs próprio.
- **Escalar para zero** não é oferecido. Todo backend executa pelo menos uma instância o tempo todo.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculação, deploy, configurações de computação e o que a versão beta não contempla
- [Funções Customizadas](/docs/backend/custom-functions/): escrevendo as rotas em `backend/functions/`
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/): o que é um bundle e como o runtime o inicializa
- [Armazenamento](/docs/backend/storage/): buckets, endpoints, limites de tamanho e regras de acesso
- [Executando mais de uma instância](/docs/deployment/multiple-instances/): o estado que o Rebase mantém por processo
