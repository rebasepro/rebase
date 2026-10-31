---
sourceHash: 3f0338ecb589f00b
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que ele é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você auto-hospedaria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e abre em lotes. [Solicite acesso](https://rebase.pro/pricing).

Ele não é self-service, portanto os comandos abaixo precisam de uma conta que tenha recebido acesso. Todo o resto neste site funciona sem uma.
:::

## O que é

Um **projeto** Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são o envio de um bundle, não a compilação de um contêiner |
| **Banco de dados** | Um PostgreSQL gerenciado, com backups automatizados e recuperação pontual no tempo (point-in-time recovery) |
| **Armazenamento** | Um bucket próprio, se o seu projeto usar armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é cobrado pelo que reserva em vez de ser por assento.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a rota de fuga é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime é executada.

## Conectar um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` não recebe argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal eles são solicitados, e uma execução headless que omita qualquer um deles encerra com `input_required` em vez de inventar um. **O subdomínio não pode ser editado posteriormente:** é o host `<slug>.rebase.website` no qual o projeto responde, portanto, escolha-o com cuidado.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma etapa de `link` separada. Ele grava `.rebase/cloud.json`, que registra o id e o slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam em `~/.rebase/credentials.json`, gravado pelo `login`.

No entanto, ele é commitado com o código, para que um repositório clonado possa nomear qualquer plano de controle. Quando o host vem apenas desse arquivo, e não é o da própria plataforma nem um no qual você já fez login antes, o `login` o nomeia e pergunta antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login lá intencionalmente.

**Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não tem senha, então faça login com um código:

```bash
rebase cloud login --code --email me@example.com
```

O plano de controle envia um código de 6 dígitos para o seu e-mail, válido por dez minutos, e você o digita no prompt. Executado normalmente em um terminal, `rebase cloud login` pergunta se deseja usar sua senha ou um código. Os códigos exigem que o plano de controle consiga enviar e-mails; se não puder, o `--code` avisa e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` solicitará o código do seu aplicativo autenticador ou um dos seus códigos de recuperação, independentemente de como você fez login. Nem o código de login nem o segundo fator podem ser digitados sem um terminal. Para um script, crie um token de acesso no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials` apresentando as mesmas duas formas de acesso, já que a causa comum é uma conta que nunca teve uma senha.

`billing setup` vincula um cartão à organização, uma única vez. Ele está intencionalmente em primeiro lugar na sequência: o primeiro deploy de um projeto é recusado sem um cartão, e descobrir isso após o upload do bundle ter terminado é a pior ordem possível.

Depois disso, a página **Billing** do console lista as faturas da organização, cada uma com a página hospedada do Stripe e o PDF, além de exibir uma prévia da próxima fatura de cada projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` exibem as mesmas informações. Ambos são destinados aos proprietários e administradores da organização. Onde a plataforma oferecer, **Manage billing** abre o portal do cliente do Stripe para gerenciar o cartão, os dados de faturamento e faturas anteriores.

Com um cartão já registrado, criar outro projeto no console não requer um segundo pagamento: o projeto é faturado nesse cartão e o deploy é realizado. Se o cartão for recusado, ou se o banco solicitar a confirmação do pagamento, o console direciona você para **Billing**, onde **Fix your card** salva outro cartão e **Complete the payment** abre a fatura do Stripe.

O que um projeto consumiu é exibido em sua visão geral, sob **Usage this month**, e para todos os projetos de uma só vez na página **Billing**: requisições em relação à cota inclusa (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento e qual é a projeção para o mês nesse ritmo. O excedente é calculado pelo mesmo código que o informa ao Stripe, portanto é o que constará na fatura; ele aparece na fatura do mês seguinte. `rebase cloud usage` exibe o mesmo, e `rebase cloud usage org` exibe para toda a organização. Qualquer membro pode visualizar. Os números informam o que ainda não é possível visualizar: o armazenamento de objetos não é medido, logo nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de app, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um projeto com autoscaling também exibe os pods executados acima de `--replicas`, em pod-horas, o custo de acordo com suas próprias taxas e se esta plataforma já os está cobrando. Um projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação: antes disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um único comando, sem flags para memorizar. O `rebase.json` gerado no scaffold declara `runtime: "managed"` para seu backend, e o `deploy` lê essa declaração — ele informa isso durante o processo (`rebase.json declares runtime: managed — deploying a bundle`), compila a aplicação em `dist-bundle`, faz o upload do bundle, o executa na imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona sem intervenção em CI.

Ele termina informando onde cada app agora responde e se a nova versão está ativa lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

“Live” significa que o endereço respondeu após a compilação: o `/health` de um backend retornou `ok`, e a página de uma aplicação estática carregou (a partir desta implantação, quando a plataforma a disponibiliza). A verificação aguarda até `--live-timeout` segundos, 60 por padrão; `0` pula a verificação. Se uma aplicação não responder a tempo, o deploy ainda assim sai com código zero, porque a implantação foi bem-sucedida, e a última linha informa qual app não respondeu e o motivo. Um deploy com falha termina em apenas uma linha, nomeando o app e o motivo, com `rebase cloud logs` para o log completo da compilação.

Scripts podem passar `--json` para obter um único objeto contendo os mesmos dados — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id da implantação. Ao contrário do restante do `rebase cloud`, o `deploy` não alterna automaticamente para JSON quando redirecionado via pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de payload, sistema de arquivos, segredos, armazenamento e rede de saída — está em sua própria página:
[Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

Para enviar um artefato construído anteriormente — por exemplo, um job de CI que compila uma vez e faz o deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais solicita isso: um build que migraria um projeto gerenciado para uma imagem de contêiner própria é recusado até que você determine explicitamente. Antigamente, `--force` significava isso, o que colocava a ação menos reversível da CLI sob a mesma palavra que "sobrescrever este arquivo"; agora ela é uma opção desconhecida em vez de um alias, portanto um script que a utilize será interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de uma aplicação estática são servidos exatamente como estão. Quando o seu `build` apenas copia scripts escritos manualmente para `output`, nada os analisou, e um arquivo com um erro de digitação pode ir para o ar e impedir o carregamento da página. Portanto, antes que qualquer coisa seja enviada, o `deploy` faz o parsing de cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estático, juntamente com todas as tags `<script>` inline em seus arquivos `.html`. Isso cobre tanto um app estático implantado individualmente quanto apps estáticos integrados ao bundle do backend. Um erro de sintaxe interrompe o deploy informando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que o navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` que não seja JavaScript, tags `<script src>` e scripts que ainda contenham marcações de template não renderizadas, como `{{ }}`. Um arquivo `.js` é validado se fizer o parse tanto como um script clássico quanto como um módulo, pois a página decide qual deles utilizar. Nada sob `node_modules` é lido, assim como um `--bundle-dir` pré-compilado. `--no-verify` ignora a verificação para um deploy específico.

Acompanhe:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

O `status` informa `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está genuinamente trabalhando e fazer polling é o correto a se fazer; quando ele especifica algo, esse algo está esperando por você.

## Pré-visualizar uma alteração

```bash
rebase cloud deploy --preview
```

Isso compila e faz o upload exatamente do que o `deploy` faria, mas disponibiliza o resultado em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que já servia antes. O deploy exibe o endereço do preview quando a compilação termina.

Para manter o mesmo endereço entre os deploys, nomeie o preview. Fazer o deploy com o mesmo nome novamente o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** pré-visualiza o backend, com seus apps estáticos integrados, da mesma forma como a produção os executa. Ele recebe um backend próprio em um **banco de dados vazio próprio**, nunca o de produção. Inicializar conectado ao banco de dados de produção aplicaria o esquema e as regras de acesso do preview a ele.
- **`rebase cloud deploy web --preview`** pré-visualizaria uma aplicação estática individualmente, com suas páginas chamando o backend de **produção**. Isso requer um plano de controle que sirva sites estáticos de forma autônoma, o que o Rebase Cloud ainda não faz: ele recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça o preview do backend, que serve as aplicações estáticas integradas a ele; um projeto sem backend gerenciado ainda não pode ser pré-visualizado.

Um preview não faz upload de código-fonte e não registra apps ou hostnames, pois qualquer uma dessas ações alteraria o projeto de produção. `--source` e `--eject` não podem ser combinados com `--preview`. Cada um deles compila uma imagem de contêiner para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` refere-se sempre à produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o log de compilação ou excluir cada um deles. A criação de um preview continua sendo uma etapa via CLI.

Um preview expira uma semana após o último deploy realizado nele.

Quando termina, o deploy verifica se o endereço do preview responde, assim como faz um deploy de produção (`--live-timeout <seconds>`, `0` para ignorar). O certificado de um novo preview pode levar um ou dois minutos, portanto um deploy bem-sucedido pode indicar que o endereço ainda não responde.

O preview de um backend é faturado como uma unidade de app no tamanho padrão (100m de CPU e 384 MiB de memória, na taxa da sua aplicação para sua região e capacidade), proporcional ao tempo em que existir, e aparece na estimativa mensal do projeto no console. `rebase cloud deploy --preview` exibe a mesma estimativa para ele, por mês (`cost` com `--json`). Iniciar um preview exige um cartão registrado, assim como um deploy de produção. Um primeiro deploy que falhe antes de qualquer execução é removido em vez de ser faturado. Um projeto pode executar até três previews de backend simultaneamente.

Cada novo endereço de preview recebe seu próprio certificado TLS da Let's Encrypt, que permite 50 novos certificados por semana para um domínio, compartilhados com todos os sites de produção nele. Previews podem utilizar 20 deles em qualquer período de 7 dias em toda a plataforma. Acima disso, um novo preview é recusado (`429`, `preview_cert_budget`) informando o horário em que poderá ser implantado; reimplantar um preview existente nunca conta para esse limite.

O banco de dados de um preview de backend é um segundo banco no Postgres de **produção**: dados próprios, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, para que os previews não esgotem as conexões de produção, e a 2 GB: um preview cujo banco de dados ultrapassar esse limite é pausado. Seu backend é interrompido, seu endereço para de responder, `rebase cloud previews` e o console o exibem como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até que ele expire. Faça o deploy novamente para iniciá-lo (ele será pausado de novo se o banco continuar grande demais) ou exclua-o. Um preview pausado continua sendo cobrado até ser excluído ou expirar. Exclua previews que você não precisa mais. Extensões instaladas na produção não são instaladas no banco de dados de um preview.

Os previews estão sendo disponibilizados gradualmente. Um plano de controle que ainda não ofereça suporte a eles recusa `--preview` com `previews_unavailable` e não realiza o deploy de nada.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que uma implantação anterior bem-sucedida enviou e nunca recompila — a vantagem de um rollback é que ele entrega um artefato que já foi executado.

Quais implantações se qualificam depende de como o projeto faz deploy, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (compilação a partir do código-fonte) | A imagem que essa compilação publicou |
| `rebase cloud deploy --bundle` (runtime da plataforma) | O bundle enviado nesse deploy, na versão de runtime que o projeto está executando agora |

Aplicações estáticas integradas ao bundle do backend (um simples `rebase cloud deploy` em um projeto com backend) fazem parte desse bundle, portanto sofrem rollback junto com ele.

Uma aplicação estática implantada isoladamente (`rebase cloud deploy <app>`) ainda não pode sofrer rollback. Sua implantação registra qual app foi publicado, mas nenhum bundle, de modo que o plano de controle não tem de onde restaurá-la. A solução é fazer o deploy da última versão válida novamente, por exemplo a partir do commit anterior ao problemático. Após tal deploy, o `deploy` informa isso em vez de indicar o `rollback`, e um `rollback` sem um ID recusa a operação em vez de reimplantar o backend que está em execução.

Portanto, um rollback necessita de uma implantação que tenha registrado um dos dois, o que significa um projeto que tenha realizado deploy com sucesso pelo menos duas vezes. `rebase cloud deployments` marca as que se qualificam, e `--json` informa `rollbackable` por linha, juntamente com a `image` ou `bundle` que seria restaurado.

Dois tipos de implantações são recusados, e a CLI indica quais: uma que não teve sucesso e uma anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há o que adivinhar em nenhum dos casos — adivinhar enviaria o que quer que tenha sido compilado ou enviado mais recentemente alegando restaurar esta — portanto, faça o deploy da versão desejada diretamente.

Todo deploy bem-sucedido termina indicando o caminho de retorno (`rebase cloud rollback`), para que fique visível no momento em que uma versão com problemas for detectada.

Um rollback adiciona uma nova implantação em vez de reverter o histórico e aguarda a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, a partir de **Database → Backups** no console ou com a CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Isso requer duas etapas. Primeiro, uma cópia recuperada é preparada (staged) ao lado do banco de dados ativo; sua aplicação continua rodando no banco ativo, e o armazenamento da cópia é faturado até que você faça o cutover ou a descarte.
Em seguida, assim que a cópia estiver pronta, realizar o cutover reaponta a aplicação para ela e a reinicia. Qualquer coisa gravada após o horário-alvo não estará na cópia. O banco de dados original é mantido como opção de retorno e continua cobrando armazenamento; voltar atrás, removê-lo ou realizar uma segunda restauração requer suporte. Apenas um proprietário ou administrador pode preparar, realizar o cutover ou descartar, e o console solicita o nome do projeto antes de executar o cutover.

## Proteja sua conta

Sua conta do console tem acesso a bancos de dados de produção, segredos e faturamento, portanto proteja-a adequadamente. Abra **Account security** no menu sob o seu avatar no console (ou acerte `/account`). A página é sua, não de uma organização: o que você configurar ali se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um link que abre o app com a chave preenchida em um celular, e então solicita o código de 6 dígitos exibido no app. A partir de então, cada login solicitará um código, quer você faça login com senha, Google ou GitHub.
- **Códigos de recuperação.** Ativá-la fornece dez códigos de uso único, exibidos uma única vez. Cada um permite fazer login no lugar do código do autenticador caso perca o celular, portanto salve-os antes de fechar a caixa de diálogo. **New recovery codes** os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas e obter novos códigos exigem a confirmação de um código antes.
- **Senha.** Alterá-la desconecta você de todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não possui senha; a página oferece o envio de um link por e-mail para definir uma.
- **Dispositivos conectados.** Cada navegador e terminal conectado à sua conta, com seu endereço e quando o login foi feito. Desconecte qualquer dispositivo que você não reconheça, ou todos de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo fator, portanto o CI continua fazendo deploys depois de ativá-la. Revogue um token em que não confia mais em **Settings → Access tokens**.

## Convide sua equipe

**Members → Invite member** fornece um link para copiar (enviado por e-mail quando este plano de controle envia e-mails) que funciona uma única vez, durante 7 dias, para uma conta que tenha verificado aquele endereço; ninguém entra até aceitar. Convide um administrador ou membro e torne-o proprietário depois que tiver entrado. Proprietários e administradores podem visualizar, reenviar ou revogar o convite em **Pending invitations**; a partir de um terminal, utilize [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` mostram aos proprietários e administradores da organização quem fez deploy, definiu ou revelou uma variável de ambiente (por nome, nunca por valor), alterou um domínio, restaurou um backup, redimensionou, interrompeu ou excluiu um projeto, alterou a função de um membro ou criou um token, e quando. A página **Settings** de um projeto vincula às suas próprias entradas; entradas sobre projetos excluídos permanecem. Um script pode lê-las com um token criado com `--can audit` na organização. Os registros são mantidos por um ano. Os filtros estão em [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Dê a ele um token restrito a algumas ações em um projeto, criado a partir de um terminal autenticado com `rebase cloud tokens create --project shop --can deploy,logs`, e defina-o como `REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação de uma organização são permissões próprias (`--can billing`, `audit`, `notifications`) que um token detém apenas quando solicitado. As permissões, um fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão em [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` fornece a uma aplicação um backend ativo antes de qualquer pessoa se cadastrar, e exibe uma URL de reivindicação para que a pessoa possa mantê-lo; um projeto que ninguém reivindicar dentro de 72 horas é excluído. O que o token do projeto não reivindicado pode fazer, o `REBASE_API_TOKEN` que ele grava e o que muda após a reivindicação estão em [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação e custos

O preço de um projeto é calculado a partir do que ele reserva, não a partir de um plano. `compute` exibe cada parâmetro e a cotação detalhada da própria plataforma para eles. (`rebase cloud resources` é algo diferente: os bancos de dados e buckets declarados pelo código e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e o que significa |
|---|---|
| `--cpu`, `--memory` | Solicitação do app por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `100m` e `384Mi`, com burst de até 2 CPUs e `2Gi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que ele pode atingir. As instâncias que o autoscaler adiciona acima de `--replicas` são medidas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma ativou essa opção; **Usage this month** indica isso. `--no-autoscale` o desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação à solicitação e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo número: um parâmetro vazio segue o padrão da plataforma e muda quando o padrão mudar.

Nada é validado pela CLI, intencionalmente — os limites pertencem ao cluster no qual o projeto é executado e variam entre provedores. O plano de controle recusa qualquer valor que não possa atender e indica o campo. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; qualquer alteração se aplica imediatamente, de forma proporcional a partir de hoje, exceto as que reiniciam o banco de dados, que aguardam uma janela de manutenção.

## O restante da superfície

| Grupo de comandos | O que cobre |
|---|---|
| `login`, `logout`, `whoami` | Sua sessão |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` exibe esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Enviar e monitorar |
| `previews` | Builds servidos em seu próprio endereço através de `deploy --preview` e exclusão dos mesmos. Consulte [Pré-visualizar uma alteração](#pré-visualizar-uma-alteração) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura, a menos que a plataforma cobre projetos interrompidos apenas pelo armazenamento e pela taxa da plataforma; a linha **Billing** do console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que ele está fazendo e por que não está |
| `cron` | Os cron jobs da aplicação implantada e suas execuções registradas, lidos com o seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `app-key` | A chave que `init --claim` gravou em `.env` como `REBASE_API_TOKEN`, transferida na reivindicação; `rotate` a substitui e revoga a antiga. Proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API da aplicação: quando foi rotacionada pela última vez; `rotate` fornece uma nova à aplicação. Proprietários e administradores |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em vários domínios, cada um verificado individualmente; `verify` e `remove` recebem o domínio sobre o qual agir, que só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Conectar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `guests` | <span class="since-badge" data-since="0.27">Since 0.27</span> Os usuários convidados que o login anônimo deixou para trás: conte-os, exclua um, remova aqueles não vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Proprietários e administradores |
| `extensions` | A allowlist de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterá-lo |
| `usage` | Requisições utilizadas este mês em relação à cota inclusa e o excedente até o momento, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters nos quais os tenants são executados. Somente para administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações e seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e administradores. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications`, `webhooks` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Notificações Cloud](/docs/deployment/cloud-notifications/)). `webhooks` foi descontinuado e encerra com código 1 e `command_retired` |

Cada grupo nessa tabela responde ao `--help` com uma página própria — uma linha de uso, suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o índice para as páginas, portanto, um grupo adicionado sem uma página faz o build falhar em vez de responder com o índice. O comando `verify:docs` vincula a própria tabela a esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, portanto, um grupo adicionado sem uma linha também faz o build falhar.

Quando redirecionado via pipe, o `--help` responde em JSON: a mesma linha de uso, flags e exemplos estruturados para leitura em vez de sessenta linhas de caracteres de escape do terminal.

## O que o beta não inclui

Falando abertamente, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo roda em uma única região atualmente. O modelo de posicionamento existe na plataforma, mas um projeto não pode escolher uma região. `projects create --provider` e `--region` não são a exceção que parecem ser: registram a qual dos alvos de deploy registrados no plano de controle um projeto pertence, e há apenas um, portanto ambos assumem esse valor padrão e nenhum deles move o projeto para outro lugar. `rebase cloud projects create --help` diz o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há opção de se cadastrar e pagar imediatamente.
- **Sem SLA publicado**, e sem SOC 2. Se você precisa de qualquer um dos dois, mencione ao solicitar acesso em vez de assumir que existe.
- **Sem deploys de branch**, e sem GitHub App oficial. Deploy hooks — URLs secretas para as quais você aponta um webhook de repositório — são a automação suportada. [Deploys de preview](#pré-visualizar-uma-alteração) estão sendo disponibilizados e são iniciados a partir da CLI.
- **Tokens agem como uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é emitido por uma conta e atua como ela; ainda não existe uma identidade de máquina de propriedade da organização. Se você fizer login a partir do CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um cofre de segredos — `--password` coloca a senha no histórico do seu shell e na tabela de processos, e avisa sobre isso antes de autenticar você. Se o `.rebase/cloud.json` do repositório especificar um plano de controle diferente do da própria plataforma, passe-o como `--url` também: sem um terminal, o `login` se recusa a enviar uma senha para um host nomeado apenas pelo arquivo baixado no checkout.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não fica exposto à internet, portanto o host exibido no console é o endereço interno do seu backend e não resolve para nada na sua máquina. `rebase cloud db connect` abre uma porta local conectada a esse banco de dados, roteada através do plano de controle, enquanto você a mantiver em execução — mas não há um hostname permanente ao qual um serviço de terceiros possa se conectar. Esse túnel e a senha exibida por `rebase cloud db info --reveal` exigem a função de proprietário ou administrador da organização: a mesma exigida pelo editor SQL do Studio, pois todos os três resultam em uma sessão sobre os seus dados de produção.
- **Fazer deploy é executar código com os segredos de produção.** O ambiente da aplicação contém `REBASE_SERVICE_KEY` (admin em sua própria API), `DATABASE_URL` e `JWT_SECRET`, de modo que o código implantado por um membro pode lê-los, mesmo que apenas proprietários e administradores possam revelá-los no console. Convide como membro apenas pessoas a quem você confiaria esses valores.
- **A service key pode ser substituída.** As **Settings** do projeto (ou `rebase cloud service-key rotate`) emitem uma nova `REBASE_SERVICE_KEY` e reiniciam a aplicação com ela. A chave antiga funciona até que o reinício tenha sido concluído, e nada após isso, de forma que qualquer coisa que a tenha copiado será recusada a partir de então. Reivindicar um projeto faz o mesmo.

## Auto-hospedagem como alternativa

Nada aqui é um aprisionamento tecnológico. O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a mesma imagem e bundle com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) renderiza a mesma topologia a partir do Helm chart.
