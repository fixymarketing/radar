# Fixy Radar

Dashboard interno de Fixy. Se actualiza solo todos los días a las **7:00 de la mañana** (hora de Argentina) y se publica en GitHub Pages. No hay que ejecutar scripts, tocar archivos ni apretar botones.

---

## Lo único que tenés que hacer

### 1. Agregar el secreto de la API

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

| Nombre exacto | Dónde se obtiene |
| --- | --- |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → `API keys` → `Create key`. Requiere una cuenta con crédito cargado en `Billing`. |

Es el único secreto del proyecto. La búsqueda web está incluida en esa misma API, así que no hace falta ninguna otra cuenta ni servicio. El costo estimado es de unos pocos centavos de dólar por día.

La clave nunca se expone en el sitio: vive solo dentro de GitHub Actions.

### 2. Subir el logo oficial

Reemplazar el archivo **`assets/logo-fixy.png`** por el logo oficial de Fixy, con ese mismo nombre.

Hoy hay un placeholder neutro que dice "PLACEHOLDER". El logo no fue recreado, redibujado ni imitado en ninguna parte del proyecto: se usa el archivo tal cual, sin recortes ni cambios de proporción. Si el original es SVG, subilo como `logo-fixy.svg` y cambiá la extensión en la línea `<img class="brand__logo" ...>` de `index.html`.

---

## Eso es todo

Con esos dos pasos el radar queda funcionando solo. Lo demás ya está configurado: la tarea programada, la publicación, el criterio editorial, la deduplicación y el histórico.

---

## Dos cosas que conviene saber

**Las marcas Vamos / Evaluar / No vamos.** Se guardan en el navegador de quien las marca y la automatización nunca las toca. Si querés que el equipo entero las vea, la sección **Hoy** muestra un botón *Descargar* cuando hay cambios pendientes: ese archivo va a `data/internal/event-status.json` en el repositorio. Ese archivo está deliberadamente fuera del alcance de la actualización diaria.

**La tarea programada de GitHub.** Si el repositorio pasa 60 días sin actividad de una persona, GitHub pausa las tareas programadas y avisa por mail. Alcanza con entrar a la pestaña `Actions` y apretar *Enable workflow*. Los commits diarios del bot suelen evitar que llegue a ese punto.

---

## Cómo funciona, en cinco líneas

1. Una GitHub Action programada corre `scripts/update.mjs` todos los días.
2. El script busca en Internet con la API de Claude, aplica el criterio editorial de `scripts/config.json` y descarta todo lo que no tenga fuente verificable.
3. Fusiona los resultados con los datos existentes: no duplica, actualiza lo que cambió y preserva los datos internos de Fixy.
4. Lo que envejece pasa a `data/archive/` y sale de la vista principal.
5. La interfaz es HTML, CSS y JavaScript sin dependencias: solo lee los JSON de `data/`. No se reconstruye nada.

Para ajustar el criterio editorial (categorías, fuentes prioritarias, cuántos ítems por día, ventana de la agenda) se edita **`scripts/config.json`**. No hace falta tocar la interfaz.

---

## Comandos, si alguna vez hacen falta

```bash
npm run serve      # ver el sitio en local (http://localhost:4173)
npm run check      # verificar que los datos estén sanos
npm run dry-run    # probar la actualización sin escribir nada (necesita ANTHROPIC_API_KEY)
```

También podés correr la actualización a mano desde `Actions` → `Radar diario` → `Run workflow`.
