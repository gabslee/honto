# HONTO?! — spot vertical de 20s

Peça de motion graphics para TikTok / Instagram Reels / Shorts.
1080×1920, 60 fps, 20,000 s exatos, h264 + AAC.

| arquivo | uso |
| --- | --- |
| `honto-20s-vertical.mp4` | versão final com trilha (postar essa) |
| `honto-20s-vertical-silent.mp4` | sem áudio, para colar sobre trending sound |
| `honto-20s-score.wav` | trilha isolada, 48 kHz estéreo, −17,9 LUFS |
| `honto-cover.png` | frame de capa (lockup + CTA) |

## Roteiro

| tempo | cena |
| --- | --- |
| 0,0–2,0 | 本当?! bate em tela cheia → vira o lockup HONTO?! |
| 2,0–4,25 | "Draw a card. / Read each other." + "Who takes the sip?" |
| 4,25–8,25 | baralho abre em leque, carta vira, duas mentiras riscadas, uma verdade |
| 8,25–11,0 | grid dos sete mini games com ticker de nomes + AI question helper |
| 11,0–13,5 | roleta gira e para em "2 SIPS" |
| 13,5–16,0 | mesa: grátis para dois, até 6 com Premium, room code |
| 16,0–20,0 | CTA: TRY IT FREE + hontogame.com |

Cada cena termina com meio segundo ou mais de quadro parado depois que o último
elemento aterrissa — é o tempo de leitura. Os seis cortes caem na grade musical
de 120 BPM ancorada em 2,00 s, então os impactos da trilha batem junto.

Começa e termina no azul-tinta, então o loop do TikTok emenda sem corte.
Todo o texto vive entre y≈220 e y≈1560 para não cair atrás da UI das plataformas.

## Como re-renderizar

O vídeo é desenhado por código (canvas 2D determinístico), não por timeline.
Paleta, ícones dos mini games e tipografia vêm do próprio produto
(`app/globals.css`, `app/game-client.tsx`, Geist).

```bash
cd marketing/studio
npm i playwright-core                  # precisa do chromium do playwright em cache
node capture.mjs all                   # 1200 PNGs em ../frames (~4,5 min)
FROM=800 TO=960 node capture.mjs all   # re-renderiza só um trecho
PICKS="0,120,480" node capture.mjs sheet  # frames avulsos para revisão

python3 audio.py honto-20s-score.wav

ffmpeg -y -framerate 60 -i ../frames/f%05d.png -c:v libx264 -preset slow -crf 17 \
  -pix_fmt yuv420p -movflags +faststart -r 60 silent.mp4
ffmpeg -y -i silent.mp4 -i honto-20s-score.wav -c:v copy -c:a aac -b:a 192k \
  -shortest -movflags +faststart final.mp4
```

Para trocar copy, timing ou cores: `studio/scene.js` — cada cena é uma função
`s<Nome>(ctx, t)` e a timeline fica no array `SCENES`. Os acentos da trilha em
`studio/audio.py` seguem a lista `CUTS`; mexeu no corte, mexa lá também.
