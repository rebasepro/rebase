---
sourceHash: 4561f107537e7ada
title: Pooling de conexões
sidebar_label: Pooling de conexões
description: O serviço pgbouncer incluído no arquivo compose do self-hosted para chamadores que não conseguem manter uma conexão, e o que o pooling de transações deixa de suportar através de sua porta.
---

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. O que precisa é todo o resto que se comunica com o mesmo banco de dados e não pode manter uma conexão: uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa de poucas centenas e cada conexão é um *processo*, de modo que um fan-out de lambdas o esgota muito antes de o banco de dados estar ocupado.

O arquivo compose inclui um serviço `pgbouncer` para esse tráfego, protegido por um profile para que uma implantação sem esses chamadores não execute um processo para o qual não tem utilidade:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

A autenticação do cliente é gerada a partir da `DATABASE_URL` na inicialização, de modo que a senha não precise ser gravada duas vezes. O pooler se autentica no Postgres com `scram-sha-256`, que o Postgres 18 armazena — o padrão `md5` da imagem falha no login do *servidor* com `FATAL: server login failed: wrong password type`, o que parece uma senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` em todos os poolers confortavelmente abaixo do `max_connections` do banco de dados — o runtime consome da mesma cota.

## O que o pooling de transações altera

Um cliente em pool mantém uma conexão com o servidor durante a duração de uma transação e depois a libera, o que permite que 500 clientes compartilhem 20 conexões. Três recursos deixam de funcionar através dessa porta, e cada um deles é algo que o próprio Rebase utiliza — que é exatamente o motivo pelo qual o runtime se conecta diretamente e esta porta é destinada a outros chamadores:

- **`LISTEN`/`NOTIFY`.** O [Realtime](/docs/backend/realtime/) é construído sobre isso, e um listener precisa de uma conexão que dure mais do que uma transação. O `LISTEN` é *aceito* através do pooler — ele responde ao `LISTEN`, e então nenhuma notificação é entregue.
- **Estado de sessão**: `SET` (em oposição a `SET LOCAL`), advisory locks mantidos entre comandos, cursores `WITH HOLD`, tabelas temporárias. A próxima transação pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos falham da mesma forma inconveniente: com um único cliente ocioso, o estado geralmente ainda está lá, portanto funciona enquanto você testa e deixa de funcionar sob a concorrência para a qual você introduziu o pooler.
- **Prepared statements no nível do protocolo.** A maioria dos drivers pode ser configurada para não utilizá-los — o node-postgres não os utiliza por padrão; o asyncpg precisa de `statement_cache_size=0`.

O `SET LOCAL` possui escopo de transação e funciona, sendo a forma como a row-level security é configurada — portanto, o RLS se comporta de forma idêntica através da porta em pool.

Deixe o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Uma porta não utilizada é superfície de ataque.

## Próximos passos

- [Self-hosting](/docs/deployment/self-hosting/): o arquivo compose do qual este serviço faz parte.
- [Mais de uma instância](/docs/deployment/multiple-instances/): o estado que cada processo do runtime mantém, antes de adicionar uma réplica.
