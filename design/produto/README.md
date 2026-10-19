# Honto · direção de design do MVP

> **Atenção: as fotos são placeholders.** As imagens em `assets/` (e as que aparecem em `index.html` e `png/`) vêm do Wikimedia Commons, sob as licenças listadas em [`assets/CREDITS.md`](assets/CREDITS.md). Servem só como referência interna de design e **não podem ir para builds da loja** (App Store / Google Play), nem para a landing ou qualquer material público. Troque por fotos próprias antes.
>
> Nesta cópia do repositório ficaram só `README.md`, `index.html`, `png/` e `assets/`. Os scripts de render (`src/`, `shoot.py`) e as capturas de referência (`_ref/`) mencionados abaixo continuam fora do repo. Os PNGs passaram por compressão sem perda (oxipng); só o `png/_gallery.png` (captura da galeria inteira) foi reduzido para 1200 px de largura. Os frames individuais seguem em @2x.

Referência para o Código, não é código de produção. Abra `index.html` (galeria) ou veja `png/`. Para re-renderizar: `python3 src/build.py && python3 shoot.py` (Playwright + Chrome/Chromium). Os dados são de exemplo: Mia em Lisboa, Leo em São Paulo, 23 dias até o encontro, 412 dias juntos, hoje é seg, 19/10/2026.

**Princípio:** a foto do parceiro é a protagonista. O papel washi e a tinta ficam no fundo; o vidro só aparece sobre foto ou sobre conteúdo que rola. No máximo 3 a 4 blocos por tela, e muito ar.

## Cor
| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `paper` | #F7F2E9 | #0F141E | fundo (washi, com ruído sutil de fibra ~5%) |
| `paper-2` | #EFE8DB | #161C28 | dia sem foto, campo desativado |
| `card` | #FFFCF7 | #1A2130 | cards e listas agrupadas |
| `ink` (sumi) | #17243D | #F1ECE3 | texto principal, botão primário; é o navy do site atual |
| `ink-2` | #55607A | #B5BAC5 | texto secundário |
| `ink-3` | #8F95A3 | #7C8390 | legenda, placeholder |
| `line` | ink 10% | branco 8% | divisórias, bordas de 1px |
| `shu` (vermelho hanko) | #D2483A | #E5604E | acento único: aba ativa, hanko, CTA "Share/Send", Thinking of you, "agora" no calendário |
| `sakura` / `sakura-ink` | #F0C7CE / #9C4A5A | #5A3A44 / #F2C4CD | cor da parceira (blocos e avatar) |
| `ai` (índigo) / `ai-ink` | #C8D4EA / #34507F | #2F3D5A / #C9D6F0 | cor do usuário (você) |
| `matcha` | #7D9B69 | #93B27F | livre, os dois livres, toggle ligado |
| âmbar status | #E8A23A | igual | ponto "Busy until..." |

Regra: só um acento vermelho por tela. Sem gradiente decorativo; gradiente só para escurecer a foto e garantir a leitura.

## Tipografia
SF Pro (`-apple-system`) no iOS e na web Apple; Inter como fallback (Android e web). Nada de serifa display e nunca Fraunces. Kanji só em Noto Sans JP, e apenas no hanko 本 e no mês (十月).
| Estilo | Tamanho/linha | Peso | Uso |
|---|---|---|---|
| Large title | 34/41, -2.5% | 700 | título da aba |
| Title 1 | 30/36, -2.5% | 650 | onboarding |
| Title 2 | 24/30 | 650 | paywall, web |
| Title 3 | 20/25 | 600 | legenda da foto, mês |
| Number | 44/50 (widget 34) | 300, tabular | countdown e hora, o número fino é a assinatura |
| Body | 16/23 | 400 | |
| Callout | 15/20 | 400–500 | |
| Footnote | 13/18 | 400 | metadados |
| Caption | 11/14, +8%, CAIXA ALTA | 600 | rótulos ("NEXT MEETING") |
Use Dynamic Type no app; os números sempre com `tabular-nums`.

## Forma e espaço
- Grid de 4 pt. Margem de tela: 16 (cards) / 24 (texto). Espaço entre blocos: 24–32.
- Raios: chip 12 · campo 18 · card 24 · card sobre foto 30 · sheet 40 · botão em pílula (altura/2) · célula do calendário 12 (web 18) · widget = raio do sistema.
- Botões: 52 de altura (sm 44); círculos de vidro 44 (grande 54); câmera 64; obturador 80.

## Vidro (Liquid Glass)
iOS 26: material nativo de verdade. Tab bar = `UITabBar` nativa via plugin (3 abas: Today, Calendar, Memories) e um botão de câmera circular separado à direita (`UIButton.Configuration.glass()`); Settings fica num botão de vidro no topo. Sheets nativas (o Memories > dia usa sheet com detents). No iOS 17–25 (o alvo mínimo é iOS 17), o mesmo plugin cai no material padrão (`.systemThinMaterial`); os frames mostram o visual do iOS 26. Só retrato.
Em Flutter (cards sobre a foto), aproximar com:
| Material | Fundo | Blur | Borda | Sombra |
|---|---|---|---|---|
| Sobre foto | branco 16% | 26, saturação 170% | 1px branco 34% + realce interno no topo 45% | 0 12 36 preto 22% |
| Sobre papel (UI) | paper 58% (escuro: #283040 55%) | 22, sat 180% | 1px branco 75% (escuro 14%) | 0 8 28 ink 10% |
| Escuro (câmera, lock) | #1E1E22 42–48% | 20–30 | 1px branco 16% | nenhuma |
| Sheet | paper 90% | 30 | 1px branco 80% | 0 -10 50 ink 18% |
Vidro nunca fica sobre vidro, e nunca fica sobre texto denso. Sobre foto, o texto é branco, com o degradê de escurecer embaixo.

## Tema japonês (sutil)
- Hanko 本 (vermelho shu, cantos de 24%, filete interno claro) é o logo, o selo do Premium e o selo de "dias juntos".
- Fundo de papel washi (ruído + fibra, opacidade baixa). Wallpaper de montanhas em camadas, índigo e creme, para mockups e marketing.
- Mês com kanji pequeno (十月) em ink-3. Paleta sazonal opcional: trocar o acento secundário por estação (outono kohaku #C98A2E, inverno ai, primavera sakura, verão matcha), sem mexer no shu.
- Nada de anime, ondas Hokusai, sakura caindo, lanterna ou fonte "oriental".

## Ícones
Só SVG de linha, sem emoji em lugar nenhum (UI, push, widget, loja). Grid de 24, traço 1.75 (2 em tamanhos ≤16), cantos e pontas redondos, `currentColor`, sem preenchimento (exceção: logos Apple/Google). Tamanhos: 24 na tab bar, 19–22 em linhas e botões, 13–16 inline. No iOS, prefira o SF Symbol equivalente (sun.max, calendar, photo.on.rectangle, camera, heart, airplane, eye.slash, moon); no Android, Material Symbols Rounded peso 400. Ícones do protótipo: em `src/build.py`.

## Movimento
- Molas curtas: resposta 0.35 s, amortecimento 0.85. Nada de bounce exagerado.
- Foto nova do parceiro: cross-fade de 400 ms e leve zoom de 1.04 para 1.
- Enviar: o botão vira check e a foto encolhe para o dia de hoje no Memories (shared element).
- Thinking of you: o coração pulsa uma vez (escala 1 para 1.12 para 1, 300 ms) com háptico leve. No widget é sem abrir o app (App Intent).
- Countdown: dígitos com `contentTransition(.numericText())`.
- Respeitar Reduce Motion (cai para fade) e Reduce Transparency (vidro vira `card` sólido).

## Modo escuro
Mesma estrutura e tokens da coluna Escuro: papel vira "noite sumi" (#0F141E), o washi cai para 35%, o shu clareia (#E5604E) e as cores do casal escurecem e mantêm o tom. Sobre foto não muda nada. A tela da câmera e o lock screen já são escuros. Veja o frame `memories-dark`.

## Android
Material 3: `NavigationBar` com as mesmas 3 abas (indicador em pílula com o shu a 12%) e FAB de câmera. As cores vêm dos tokens, sem dynamic color no MVP (marca consistente). AppWidget (Glance): foto + countdown 4x2 e o botão Thinking of you 2x1. No dia da viagem, notificação contínua com barra de progresso (ProgressStyle no Android 16, senão `setProgress`) e ações "Thinking of you" / "Open Honto".

## Web (hontogame.com/app)
Mesmos tokens, largura de 1440 com margem de 64. Faixa no topo com a foto do dia da parceira e chips de vidro (status, countdown, dias juntos), calendário grande e o dia aberto ao lado. Só leitura. Mostra o status do Premium, mas não vende assinatura (sem checkout na web do app).

## Paywall e textos
Por casal: US$4.99/mês ou US$29.99/ano (economiza 50%), 7 dias grátis, botão de fechar sempre visível e "Restore". Free: pareamento, foto do dia, widget de foto, countdown + hora do parceiro, Thinking of you, 7 dias de histórico. Premium: histórico completo (app + web), calendário do casal, widgets extras, Live Activity da viagem, decks premium do jogo. Interface em inglês, frases curtas, sem ponto de exclamação.

## Do site atual
Mantido: o navy `#17243D` (vira o `ink`), o creme `#FFF7E8` (refinado para `paper`), o vermelho `#F04444` (aprofundado para o shu `#D2483A`), o rosa `#FF8EAB` (suavizado para sakura), a tagline "Together, even when apart." e a ideia do ícone em blocos de cor (que vira o hanko). Fica de fora no app: o estilo neo-brutalista (bordas de 2–3px, sombra dura), o amarelo `#FFD644`, o "HONTO?!" com pontuação e a fonte arredondada. O jogo web pode manter esse estilo como modo "date night".

## Arquivos
`index.html` (galeria) · `png/*.png` (um por frame, @2x) · `shoot.py` · `src/build.py` + `src/style.css` (fonte da galeria) · `assets/` (fotos placeholder, ver CREDITS.md) · `_ref/` (captura do site atual).
