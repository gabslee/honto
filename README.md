# HONTO?!

**Duas mentiras. Uma verdade. Quem vai beber?**

HONTO?! é um party game online para 2–8 pessoas. Cada rodada escolhe uma pessoa para escrever três histórias sobre um tema; duas são mentiras e uma é verdade. Os demais tentam descobrir a verdade. Quem erra bebe; quando acertam, quem contou bebe. “Hontō?” (本当?) significa “é verdade?” em japonês.

## MVP

- entrada sem cadastro por nome, código ou link da sala;
- lobby com 10, 20 ou 30 rodadas;
- lembretes opcionais por tempo e brinde coletivo a cada 3 ou 5 rodadas;
- turnos alternados, verdade secreta, palpite e revelação;
- sessão e placar persistidos em banco SQLite/D1;
- atualização da sala por polling leve, adequada ao ritmo por turnos;
- 12 temas locais para o jogo funcionar sem IA e sem custo;
- interface responsiva para celular e desktop;
- linguagem inclusiva: qualquer bebida pode ser usada.

## Arquitetura

O projeto usa React/TypeScript com rotas de servidor no mesmo deploy. O estado compartilhado fica no D1; o navegador guarda apenas o token opaco que permite retomar a própria sessão. O endpoint `/api/game` concentra as ações da sala e nunca revela a verdade antes do palpite.

A geração de temas por IA é a próxima integração planejada. Ela deve acontecer apenas no servidor, com saída estruturada, limite curto e fallback para os temas locais. Nenhuma chave de API deve ir para o navegador.

## Próximos passos sugeridos

1. Ativar sugestões de tema por IA e histórico anti-repetição por sala.
2. Adicionar modo seguro/ousado e categorias escolhidas no lobby.
3. Permitir que todos palpitem em salas com 3+ pessoas.
4. Adicionar reconexão administrativa e encerramento de salas antigas.
5. Criar localização completa em inglês e português.

## Desenvolvimento

```bash
npm install
npm run dev
```

O schema está em `db/schema.ts` e as migrações versionadas ficam em `drizzle/`.
