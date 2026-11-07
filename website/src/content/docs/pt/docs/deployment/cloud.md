---
sourceHash: d4b6c7f0879d6a75
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você hospedaria por conta própria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e abre o acesso em lotes. [Solicitar acesso](https://rebase.pro/pricing).

Ele não é self-service, portanto os comandos abaixo precisam de uma conta que já tenha sido autorizada. Tudo o mais neste site funciona sem ela.
:::

## O que é

Um **projeto** no Cloud é composto por três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Os deploys são um upload de bundle, não o build de um container |
| **Banco de dados** | Um PostgreSQL gerenciado, com backups automatizados e recuperação point-in-time |
| **Armazenamento** | Um bucket próprio, se o seu projeto usar armazenamento de arquivos |

Cada um é provisionado quando você faz o deploy pela primeira vez, e cada um é faturado pelo que reserva, e não por assento/usuário.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a alternativa de saída é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime execute.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

O `projects create` não recebe argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal eles são solicitados de forma interativa, e uma execução headless que omita qualquer um deles é encerrada com `input_required` em vez de inventar um. **O subdomínio não pode ser editado posteriormente:** ele é o host `<slug>.rebase.website` no qual o projeto responde, portanto escolha-o com cuidado.

A flag `--link` vincula esse diretório ao projeto na mesma chamada, portanto não há uma etapa de `link` separada. Ela grava o arquivo `.rebase/cloud.json`, que armazena o id e o slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — essas residem em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado com o código, de modo que um repositório clonado pode apontar para qualquer control plane. Quando o host provém apenas desse arquivo, e não é o próprio da plataforma nem um no qual você já tenha feito login anteriormente, o comando `login` informa o nome dele e pede confirmação antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa a operação com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login lá intencionalmente.

**Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não possui senha, então faça login usando um código:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia por e-mail um código de 6 dígitos, válido por dez minutos, e você o digita no prompt. Executado normalmente em um terminal, o comando `rebase cloud login` pergunta se você deseja usar sua senha ou um código. Os códigos exigem que o control plane consiga enviar e-mails; se não conseguir, `--code` informa isso e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` em seguida solicita o código do seu aplicativo autenticador, ou um de seus códigos de recuperação, independentemente de como você tenha feito login. Nem o código de login nem o segundo fator podem ser digitados sem um terminal. Para um script, crie um token de acesso no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials` e oferece as mesmas duas formas de acesso, já que a causa mais comum é uma conta que nunca teve senha.

O comando `billing setup` vincula um cartão à organização uma única vez. Ele está no início da sequência de propósito: o primeiro deploy de um projeto é recusado sem ele, e descobrir isso após o upload de um bundle ter terminado seria a pior ordem.

Depois disso, a página **Billing** do console lista as faturas da organização, cada uma com a página hospedada da Stripe e o PDF, e exibe uma prévia da próxima fatura de cada projeto. Os comandos `rebase cloud billing invoices` e `rebase cloud billing upcoming` exibem as mesmas informações. Ambos destinam-se a proprietários e administradores da organização. Onde a plataforma disponibiliza, o botão **Manage billing** abre o portal de clientes da Stripe para gerenciamento do cartão, dos detalhes de cobrança e das faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não exige nenhum pagamento adicional: o projeto é cobrado nesse cartão e tem seu deploy realizado. Se o cartão for recusado ou o banco exigir a confirmação do pagamento, o console direciona você para **Billing**, onde a opção **Fix your card** salva outro cartão e **Complete the payment** abre a fatura da Stripe.

O que um projeto utilizou é exibido em sua visão geral, em **Usage this month**, e para todos os projetos simultaneamente na página **Billing**: requisições em relação à cota incluída (a barra fica âmbar aos 80%), erros 5xx, o excedente acumulado até o momento e qual é a tendência para o restante do mês nesse ritmo. O excedente é calculado pelo mesmo código que o reporta à Stripe, portanto é exatamente o que constará na fatura; ele aparece na fatura do mês seguinte. O comando `rebase cloud usage` exibe essas mesmas informações, e `rebase cloud usage org` exibe as de toda a organização. Qualquer membro pode consultá-las. Os números explicitam o que ainda não é possível visualizar: o armazenamento de objetos não é mensurado, logo nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de app, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um projeto com autoescalonamento também exibe os pods que executou acima de `--replicas`, em pod-horas, quanto custaram em suas próprias tarifas e se esta plataforma já os cobra. Um projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação: antes disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a necessidade de criar um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Fazer deploy

```bash
rebase cloud deploy
```

Um único comando, e nenhuma flag para memorizar. O arquivo `rebase.json` de um scaffold declara `runtime: "managed"` para seu backend, e o comando `deploy` lê essa declaração — ele informa isso durante o processo (`rebase.json declares runtime: managed — deploying a bundle`), faz o build do app no diretório `dist-bundle`, faz o upload do bundle, executa-o na imagem de runtime publicada e acompanha a implantação até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona sem intervenção manual em CI.

Ele termina informando onde cada app responde agora e se a nova versão está ativa nesse endereço:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após o build: o endpoint `/health` de um backend retornou `ok`, e a página de um app estático foi carregada (a partir deste deploy, quando a plataforma o serve). A verificação aguarda até `--live-timeout` segundos, cujo padrão é 60; o valor `0` a ignora. Se um app não responder a tempo, o deploy ainda assim termina com código zero, porque a implantação foi bem-sucedida, e a última linha informa qual app não respondeu e o motivo. Um deploy com falha, por outro lado, termina em uma única linha, indicando o app e o motivo, com `rebase cloud logs` disponível para o log de build completo.

Scripts podem passar `--json` para obter um único objeto contendo os mesmos dados — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id do deployment. Diferente do restante do `rebase cloud`, o `deploy` não alterna automaticamente para JSON quando redirecionado em um pipe.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de corpo de requisição, o sistema de arquivos, segredos, armazenamento e rede de saída — está detalhado em sua própria página:
[Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e faz o deploy duas vezes —, aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais a solicita: um build que moveria um projeto gerenciado para uma imagem de container da qual ele próprio passe a ser responsável é recusado até que você determine isso explicitamente. A flag `--force` costumava significar isso, o que colocava a ação menos reversível que a CLI pode executar sob a mesma palavra que "sobrescrever este arquivo"; agora ela é uma opção desconhecida em vez de um alias, de modo que um script que a utilize é interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando seu `build` apenas copia scripts feitos à mão para o diretório `output`, nada os analisou sintaticamente, e um arquivo com um erro de digitação pode ir ao ar e impedir o carregamento da página. Portanto, antes de qualquer coisa ser enviada, o comando `deploy` analisa sintaticamente cada arquivo `.js`, `.mjs` e `.cjs` no diretório `output` de cada app estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso abrange tanto um app estático implantado isoladamente quanto apps estáticos incorporados ao bundle do backend. Um erro de sintaxe interrompe o deploy indicando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o campo `code` do erro é `syntax_error`. Scripts inline que um navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` não-JavaScript, tags `<script src>` e scripts que ainda contenham marcações de template não renderizadas, como `{{ }}`. Um arquivo `.js` é aprovado se for analisado com sucesso como um script clássico ou como um módulo, já que a página decide qual deles utilizar. Nada dentro de `node_modules` é lido, assim como nenhum diretório pré-compilado informado via `--bundle-dir`. A flag `--no-verify` ignora essa verificação para uma implantação específica.

Acompanhe a execução:

```bash
rebase cloud logs               # o log de build
rebase cloud logs --runtime -f  # o que o app em execução imprime, ao vivo, até Ctrl-C
rebase cloud status             # o que a plataforma considera que o projeto está fazendo
```

O comando `status` informa os campos `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está de fato trabalhando e fazer polling é a atitude correta; quando indicar algo, esse algo está aguardando você.

## Pré-visualizar uma alteração

```bash
rebase cloud deploy --preview
```

Isso compila e envia exatamente o que o `deploy` faria, mas serve o resultado em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que servia antes. O deploy exibe o endereço do preview quando o build termina.

Para manter o mesmo endereço entre deploys, dê um nome ao preview. Fazer o deploy com o mesmo nome novamente irá atualizá-lo:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** pré-visualiza o backend, com seus apps estáticos incorporados, da mesma forma como a produção os executa. Ele recebe um backend próprio em um **banco de dados vazio próprio**, nunca o de produção. A inicialização contra o banco de dados de produção aplicaria a ele o schema e as regras de acesso do preview.
- **`rebase cloud deploy web --preview`** pré-visualizaria um único app estático isoladamente, com suas páginas chamando o backend de **produção**. Isso exige um control plane que sirva sites estáticos por conta própria, o que o Rebase Cloud ainda não faz: ele recusa a operação com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, faça o preview do backend, que serve os apps estáticos incorporados a ele; um projeto sem backend gerenciado ainda não pode ser pré-visualizado.

Um preview não envia código-fonte e não registra apps ou hostnames, pois cada uma dessas ações alteraria o projeto de produção. As flags `--source` e `--eject` não podem ser combinadas com `--preview`. Cada uma delas gera uma imagem de container para produção.

```bash
rebase cloud previews                      # nome, endereço, app, backend, expiração
rebase cloud logs --preview new-checkout   # seu log de build; -f acompanha um build ainda em execução
rebase cloud logs --runtime --preview new-checkout -f  # o que seu backend imprime
rebase cloud previews delete new-checkout  # interrompe o serviço e exclui seu banco de dados
```

O comando `rebase cloud logs` sem a flag `--preview` sempre se refere à produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o log de build ou excluir cada um deles. Criar um preview continua sendo uma etapa via CLI.

Um preview expira uma semana após o último deploy realizado nele.

Quando termina, o deploy verifica se o endereço do preview responde, da mesma forma que um deploy de produção faz (`--live-timeout <seconds>`, `0` para ignorar). O certificado de um novo preview pode levar um ou dois minutos para ser emitido, de modo que um deploy bem-sucedido pode relatar que o endereço ainda não responde.

Um preview de backend é faturado como uma unidade de app no tamanho padrão (100m de CPU e 384 MiB de memória, na tarifa do seu app para a região e capacidade correspondentes), proporcional ao tempo em que existir, e aparece na estimativa mensal do projeto no console. O comando `rebase cloud deploy --preview` exibe a mesma estimativa para ele, por mês (`cost` sob `--json`). Iniciar um preview exige um cartão cadastrado, assim como um deploy de produção. Um primeiro deploy que falhe antes que qualquer coisa entre em execução é removido em vez de faturado. Um projeto pode executar três previews de backend simultaneamente.

Cada novo endereço de preview recebe um certificado TLS próprio da Let's Encrypt, que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de produção nele. Os previews podem consumir 20 deles em qualquer período de 7 dias, em toda a plataforma. Acima disso, um novo preview é recusado (`429`, `preview_cert_budget`) com o horário em que poderá ser implantado; reimplantar um preview que já existe nunca consome essa cota.

O banco de dados de um preview de backend é um segundo banco de dados no Postgres de **produção**: dados próprios, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, de modo que os previews não esgotem as conexões de produção, e a 2 GB: um preview cujo banco de dados ultrapasse esse limite é pausado. Seu backend para, seu endereço deixa de responder, o comando `rebase cloud previews` e o console passam a exibi-lo como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até que ele expire. Faça um novo deploy para iniciá-lo (ele será pausado novamente caso o banco de dados continue grande demais) ou exclua-o. Um preview pausado continua sendo faturado até ser excluído ou expirar. Exclua previews dos quais não precise mais. Extensões instaladas na produção não são instaladas no banco de dados de um preview.

Os previews estão sendo disponibilizados gradualmente. Um control plane que ainda não os suporte recusará `--preview` com `previews_unavailable` e não implantará nada.

## Reverter (Rollback)

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que foi publicado em um deploy bem-sucedido anterior e nunca recompila — a grande vantagem de um rollback é que ele coloca em produção um artefato que já foi executado.

Quais deploys estão qualificados depende de como o projeto realiza seus deploys, e ambos os tipos são suportados:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (um build a partir do código-fonte) | A imagem publicada por aquele build |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle enviado por aquele deploy, na versão do runtime em que o projeto está rodando agora |

Apps estáticos incorporados ao bundle do backend (um `rebase cloud deploy` padrão em um projeto com backend) fazem parte desse bundle, portanto sofrem o rollback junto com ele.

Um app estático implantado isoladamente (`rebase cloud deploy <app>`) ainda não pode ser revertido via rollback. Seu deployment registra qual app foi publicado, mas nenhum bundle, portanto o control plane não tem de onde restaurá-lo. A solução é implantar a última versão em bom estado novamente, por exemplo, a partir do commit anterior ao problemático. Após um deploy desse tipo, o comando `deploy` avisa isso em vez de indicar o `rollback`, e executar `rollback` sem um id recusa a ação em vez de reimplantar o backend em execução.

Portanto, um rollback necessita de um deployment que tenha registrado um dos dois itens, o que significa um projeto que tenha sido implantado com sucesso pelo menos duas vezes. O comando `rebase cloud deployments` destaca quais estão qualificados, e a opção `--json` reporta `rollbackable` por linha, junto com o campo `image` ou `bundle` que seria restaurado.

Dois tipos de deployment são recusados, e a CLI informa qual deles é o caso: um que não foi bem-sucedido e outro realizado antes de a plataforma registrar seu artefato. Não há como adivinhar em nenhum dos casos — adivinhar significaria enviar o que foi compilado ou enviado mais recentemente enquanto se alega restaurar aquele específico —, portanto, implante diretamente a versão desejada.

Todo deploy bem-sucedido termina informando o comando de retorno (`rebase cloud rollback`), mantendo-o visível no momento exato em que um lançamento incorreto for percebido.

Um rollback adiciona um novo deployment em vez de voltar o histórico no tempo, e aguarda a versão restaurada estar respondendo antes de relatar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, a partir de **Database → Backups** no console ou via CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
O processo ocorre em duas etapas. Primeiro, uma cópia recuperada é preparada em paralelo ao banco de dados ativo; seu app continua rodando no banco ativo, e o armazenamento da cópia é faturado até que você realize o cutover ou a descarte.
Em seguida, assim que a cópia estiver pronta, a operação de cutover reaponta o app para ela e o reinicia. Qualquer dado gravado após o horário de destino não constará na cópia. O banco de dados original é mantido como caminho de retorno e continua com o armazenamento faturado; reverter a troca, removê-lo ou realizar uma segunda restauração requer suporte. Apenas proprietários ou administradores podem preparar, realizar o cutover ou descartar, e o console solicita a confirmação do nome do projeto antes de efetuar o cutover.

## Proteja sua conta

Sua conta no console tem acesso a bancos de dados de produção, segredos e faturamento, portanto proteja-a como tal. Abra **Account security** a partir do menu sob seu avatar no console (ou acesse `/account`). A página pertence a você, não a uma organização: o que você definir lá se aplica a todas as organizações às quais pertencer.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um link que abre o aplicativo com a chave preenchida em um celular, solicitando em seguida o código de 6 dígitos exibido pelo aplicativo. A partir desse momento, todo login exigirá um código, quer você faça login com senha, Google ou GitHub.
- **Códigos de recuperação.** A ativação fornece dez códigos de uso único, exibidos uma única vez. Cada um deles permite fazer login no lugar do código do autenticador caso perca seu celular, portanto salve-os antes de fechar o diálogo. A opção **New recovery codes** os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas e obter novos códigos exigem a digitação prévia de um código.
- **Senha.** Alterá-la desconecta você em todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não possui senha; a página oferece o envio de um link por e-mail para cadastrar uma.
- **Dispositivos conectados.** Lista todos os navegadores e terminais conectados à sua conta, com seus respectivos endereços e quando se conectaram. Desconecte qualquer dispositivo que não reconhecer ou todos eles de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não exigem um segundo fator, de modo que o CI continua implantando normalmente após a ativação. Revogue um token no qual não confie mais em **Settings → Access tokens**.

## Convide sua equipe

A opção **Members → Invite member** fornece um link para cópia (enviado por e-mail quando este control plane puder enviar e-mails) que funciona uma única vez, durante 7 dias, para uma conta que tenha verificado aquele endereço; ninguém ingressa até que o convite seja aceito. Convide um administrador ou um membro e transforme-o em proprietário após o ingresso. Proprietários e administradores podem visualizar, reenviar ou revogar convites em **Pending invitations**; a partir de um terminal, utilize [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` exibem aos proprietários e administradores da organização quem fez deploy, definiu ou revelou uma variável de ambiente (pelo nome, nunca pelo valor), alterou um domínio, restaurou um backup, redimensionou, interrompeu ou excluiu um projeto, alterou o papel de um membro ou criou um token, e quando isso aconteceu. A seção **Settings** de um projeto inclui links para suas próprias entradas; um registro referente a um projeto excluído é preservado. Um script pode lê-los utilizando um token criado com a permissão `--can audit` na organização. Os registros são mantidos por um ano. Os filtros estão descritos em [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token restrito a algumas ações em um único projeto, criado a partir de um terminal autenticado com `rebase cloud tokens create --project shop --can deploy,logs`, e defina-o como `REBASE_TOKEN`. O faturamento, o log de atividades e as configurações de notificação de uma organização são capacidades próprias (`--can billing`, `audit`, `notifications`) que um token só possui quando expressamente solicitado. As capacidades, um fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão descritos em [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

O comando `rebase cloud init --claim` disponibiliza para um app um backend ativo antes mesmo de qualquer pessoa ter criado uma conta, e exibe uma URL de reivindicação para que a pessoa possa mantê-lo; um projeto que ninguém reivindicar dentro de 72 horas é excluído. O que o token de um projeto não reivindicado pode fazer, a variável `REBASE_API_TOKEN` que ele grava e o que a reivindicação altera estão descritos em [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação e quanto custa

O preço de um projeto é calculado com base no que ele reserva, e não a partir de planos fixos. O comando `compute` exibe cada parâmetro e a cotação discriminada gerada pelo próprio control plane. (O comando `rebase cloud resources` é diferente: trata-se dos bancos de dados e buckets declarados pelo código, e se cada um está provisionado — consulte a [referência da CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade e significado |
|---|---|
| `--cpu`, `--memory` | Solicitação do app por instância, ex.: `500m` e `2Gi`. Vazio indica o padrão da plataforma — `100m` e `384Mi`, com burst de até 2 CPUs e `2Gi` |
| `--replicas` | Instâncias existentes de forma permanente: o piso do autoescalonador e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | De 1 a 16. O teto máximo que pode ser atingido. Instâncias que o autoescalonador adicionar acima de `--replicas` são cobradas por pod-segundo nas mesmas tarifas, e apenas onde a plataforma tiver ativado essa cobrança; **Usage this month** informa qual é o caso. `--no-autoscale` desativa esse recurso |
| `--autoscale-cpu-target` | De 10 a 95. A utilização de CPU que o autoescalonador mantém, calculada sobre a solicitação (request) e não sobre o limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata, porém reiniciada sem aviso prévio |
| `--db-instances` | De 1 a 3. `1` indica instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor numérico: um parâmetro vazio acompanha o valor padrão da plataforma e é ajustado quando este muda.

Nada é validado pela CLI de forma proposital — os limites pertencem ao cluster no qual o projeto é executado e variam entre provedores. O control plane recusa um valor que não consiga atender e indica o campo correspondente. Execute `rebase cloud compute` para visualizar o valor em €/mês antes e depois; uma alteração entra em vigor imediatamente, calculada proporcionalmente a partir de hoje, exceto mudanças que exijam a reinicialização do banco de dados, que aguardam uma janela de manutenção.

## O restante da superfície

| Grupo de comandos | O que cobre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` exibe o bearer token que a CLI enviaria no momento, para scripts e o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um restrito a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar à sua conta um servidor Rebase auto-hospedado, para que o [conector Rebase](/docs/ai/rebase-connector/) no Claude o alcance ao lado dos seus projetos Cloud. `--list` mostra-os, `--remove` retira um. Proprietários e administradores |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` exibe esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Publicação e monitoramento |
| `previews` | Builds servidos em endereço próprio gerados por `deploy --preview`, e sua exclusão. Consulte [Pré-visualizar uma alteração](#pré-visualizar-uma-alteração) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto interrompido mantém sua assinatura, a menos que a plataforma cobre projetos parados apenas pelo armazenamento e taxa da plataforma; a linha **Billing** do console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que está em execução e por que algo não está |
| `cron` | Cron jobs do app implantado e suas execuções registradas, lidos com seu login do `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca imprime valores; `--secret` é somente escrita |
| `app-key` | A chave gravada por `init --claim` em `.env` como `REBASE_API_TOKEN`, transferida no momento da reivindicação; `rotate` a substitui e revoga a antiga. Proprietários e administradores |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` gera uma nova para o app. Proprietários e administradores |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em múltiplos domínios, cada um verificado separadamente; `verify` e `remove` recebem o domínio sobre o qual atuar, o qual só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). O comando `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Os usuários convidados deixados pelo login anônimo: conte-os, exclua um, limpe os não vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Proprietários e administradores |
| `extensions` | A lista de permissões de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterar |
| `events` | O que aconteceu com o backend, do mais recente: a app escalando, alterações no banco de dados agendadas e aplicadas, um standby assumindo, o disco crescendo |
| `usage` | Requisições utilizadas este mês em relação à franquia incluída e o excedente acumulado, conforme contabilizado na fatura. O comando `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters em que os tenants são executados. Apenas administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações, seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem implantou, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Proprietários e administradores. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications`, `webhooks` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Notificações no Cloud](/docs/deployment/cloud-notifications/)). `webhooks` foi descontinuado e encerra com código 1 e o código de erro `command_retired` |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso, suas flags e exemplos — e `--help` nunca executa o comando em si. Um teste mantém o índice para as páginas, portanto um grupo adicionado sem uma página faz o build falhar em vez de responder com o índice. O comando `verify:docs` vincula a própria tabela a esse índice: cada grupo despachado pela CLI aparece aqui exatamente uma vez, de forma que um grupo adicionado sem uma linha correspondente também faz o build falhar.

Quando redirecionado em um pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos estruturados para leitura em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Exposto com clareza, pois descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo é executado em uma única região atualmente. O modelo de posicionamento geográfico existe na plataforma, mas um projeto ainda não pode escolher uma região.
  Os comandos `projects create --provider` e `--region` não são a exceção que aparentam ser: eles apenas registram a qual dos alvos de deploy registrados no control plane o projeto pertence, e há somente um, portanto ambos adotam esse padrão e nenhum deles move o projeto para outro local. O comando `rebase cloud projects create --help` informa o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não existe um fluxo de cadastrar-e-pagar.
- **Sem SLA publicado** e sem certificação SOC 2. Se você precisa de qualquer um deles, mencione isso ao solicitar acesso em vez de presumir que existam.
- **Sem deploys por branch** e sem aplicativo nativo de GitHub (GitHub App). Deploy hooks — URLs secretas para as quais você aponta um webhook de repositório — são a automação suportada. [Deploys de preview](#pré-visualizar-uma-alteração) estão sendo disponibilizados e são iniciados a partir da CLI.
- **Tokens atuam como uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é gerado por uma conta e atua em nome dela; ainda não há identidade de máquina pertencente à organização. Se você fizer login via CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um cofre de segredos — o uso de `--password` expõe a senha no histórico da sua shell e na tabela de processos, informando isso antes de efetuar o login. Se o arquivo `.rebase/cloud.json` do repositório apontar para um control plane diferente do oficial da plataforma, passe-o também via `--url`: sem um terminal, o `login` recusa-se a enviar uma senha para um host nomeado apenas pelo arquivo obtido no clone.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não fica exposto à internet, portanto o host exibido no console é o endereço interno do seu backend e não resolverá nada na sua máquina. O comando `rebase cloud db connect` abre uma porta local conectada a esse banco de dados, encapsulada em um túnel pelo control plane, enquanto você mantiver o comando em execução — mas não existe um hostname permanente ao qual um serviço de terceiros possa se conectar. Esse túnel e a senha revelada por `rebase cloud db info --reveal` exigem o papel de proprietário ou administrador na organização: o mesmo exigido pelo editor SQL do Studio, pois todos os três resultam em uma sessão sobre os seus dados de produção.
- **Fazer deploy é executar código com os segredos de produção.** O ambiente do app armazena `REBASE_SERVICE_KEY` (admin em sua própria API), `DATABASE_URL` e `JWT_SECRET`, portanto o código implantado por um membro pode lê-los, muito embora apenas proprietários e administradores possam revelá-los no console. Convide como membro apenas pessoas a quem confiaria esses valores.
- **A service key pode ser substituída.** A seção **Settings** do projeto (ou o comando `rebase cloud service-key rotate`) emite uma nova `REBASE_SERVICE_KEY` e reinicia o app com ela. A chave antiga funciona até que a reinicialização termine, e perde a validade logo em seguida, de modo que qualquer recurso que a tenha copiado será recusado a partir de então. Reivindicar um projeto faz o mesmo.

## Auto-hospedagem como alternativa

Nada aqui representa aprisionamento tecnológico (lock-in). O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa exatamente a mesma imagem e o mesmo bundle com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) gera a mesma topologia a partir do Helm chart.
