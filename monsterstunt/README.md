# Monster Stunt Arena

Jogo 3D de manobras com monster truck, feito em HTML, CSS e JavaScript com [Three.js](https://threejs.org/). Dirija pela arena, suba nas rampas, faça mortais no ar e esmague os carros para pontuar antes que o tempo acabe.

## Como jogar

O projeto é estático, sem build. Basta servir a pasta e abrir no navegador:

```bash
python3 -m http.server 8080
```

Depois acesse `http://127.0.0.1:8080`.

### Controles no computador

| Tecla | Ação |
| --- | --- |
| `W` / `↑` | Acelerar |
| `S` / `↓` | Frear / dar ré |
| `A` / `←` | Virar à esquerda |
| `D` / `→` | Virar à direita |
| `Q` | Mortal para frente (no ar) |
| `E` | Mortal para trás (no ar) |
| `R` | Recuperar o caminhão |

### Controles no celular

- **Joystick** à esquerda para virar (só funciona em movimento).
- **▲** acelera e **▼** freia/dá ré à direita.
- **↺ / ↻** fazem mortais quando o caminhão está no ar.

Os controles de toque aparecem automaticamente em aparelhos com tela sensível ao toque.

## Regras

- 100 segundos por partida.
- Saltos e mortais dão pontos; quanto maior a manobra e o tempo no ar, mais pontos.
- Pousar de rodas dá bônus; capotar cancela o combo.
- Esmagar carros aumenta o combo (até x5). Os carros reaparecem depois de alguns segundos.
- O recorde fica salvo no `localStorage` do navegador.

## Estrutura

```
index.html          marcação da HUD, menus e controles de toque
style.css           visual da interface e layout responsivo
src/main.js         cena Three.js, caminhão, arena, efeitos, áudio e loop do jogo
src/physics.js      simulação arcade do caminhão (suspensão, tração, direção e saltos)
vendor/three.module.js  Three.js r169 (MIT)
```

A física é separada da renderização e usa apenas a matemática do Three.js, então também roda em Node para testes.

## Modo leve

Em navegadores que usam renderização por software (SwiftShader/llvmpipe), o jogo desliga as sombras automaticamente. Também é possível forçar com `?low=1` na URL.

## Créditos

- Three.js r169 — MIT License, Copyright 2010-2024 Three.js Authors.
