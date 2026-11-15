# ABANDON ALL HOPE

Top-down nighttime cabin survival shooter built with **Three.js** and **procedural Web Audio**.

---

## 🎮 Controles

| Acción | Tecla / Control |
|---|---|
| **Moverse** | `W`, `A`, `S`, `D` o Flechas |
| **Apuntar** | Movimiento del Ratón |
| **Disparar** | Clic Izquierdo (mantener presionado para fuego continuo) |
| **Recargar** | `R` |
| **Pausar** | `ESC` o `P` |
| **Silenciar Audio** | `M` |
| **Elegir Mejora** | `1`, `2`, `3` o Clic en la carta |

---

## 🚀 Ejecución Local

El juego utiliza módulos ES6 nativos con un importmap para Three.js:

```bash
# Iniciar servidor local
python3 -m http.server 8080
```

Abre en tu navegador:
```
http://localhost:8080/
```

---

## 📁 Arquitectura Modular

```
gameZombie/
├── index.html            # Punto de entrada HTML limpio con importmap
├── css/
│   └── style.css         # Estilos completos, tipografías retro, HUD y overlays
└── js/
    ├── main.js           # Ciclo de animación (RAF loop) e inicialización
    ├── engine.js         # Instancia de WebGLRenderer, Scene, Camera y BlockBatch
    ├── utils.js          # RNG con semilla, interpolación (damp, ease, wrapA) y storage
    ├── ik.js             # Cinemática inversa de extremidades (ik2) y ciclo de paso
    ├── state.js          # Objeto reactivo de estado global, pools de entidades y materiales
    ├── audio.js          # Voces chip sintéticas (onda pulso, triangular, ruido LFSR) y música adaptativa
    ├── world.js          # Cabaña, bosque, linternas, puertas/ventanas rompibles y pathfinding
    ├── weather.js        # Shader de lluvia procedural, relámpagos y niebla dinámica
    ├── player.js         # Rig procedural del superviviente, retroceso y animación de recarga
    ├── zombies.js        # Modelado de zombies, poses de marcha, trepado y desmembramiento
    ├── weapon.js         # Mecánicas de disparo con dispersión (buckshot), penetración y trazadoras
    ├── drops.js          # Suministros flotantes (doble daño, cargador infinito, botiquines)
    ├── upgrades.js       # Sistema de cartas de perks entre oleadas con iconos SVG
    ├── particles.js      # Sistema de salpicaduras de sangre con física
    ├── hud.js            # Actualizaciones de HUD, indicadores de munición, toasts y banners
    ├── menu.js           # Menú principal, paneo cinemático de cámara y configuración
    ├── gameflow.js       # Control de partida: inicio, pausas, oleadas y fin de juego
    ├── update.js         # Bucle de actualización por frame: combate, colisiones e IA
    └── wavedash.js       # Integración opcional de tabla de puntuaciones y logros
```

