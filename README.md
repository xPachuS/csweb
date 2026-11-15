# Clutch · Pick'em del PGL Major Singapore 2026

Una web de aficionados para jugar al Pick'em del Major de Counter-Strike 2 con amigos. No hay apuestas ni dinero, solo puntos.

- **Partido a partido:** eliges el ganador de cada partido y, en los Bo3 y Bo5, también el resultado exacto. El pronóstico se puede cambiar hasta que empieza el partido.
- **Pick'em de cada fase (estilo Valve):** en cada Stage suizo eliges dos equipos que acabarán 3-0, seis que pasarán con 3-1 o 3-2 y dos que caerán 0-3. Se cierra al empezar la fase.
- **Cuadro de playoffs:** eliges los ganadores de cuartos, semifinales y la final. Se cierra al empezar los playoffs.
- **Combinadas:** juntas de 2 a 4 partidos de una misma ronda. Solo puntúan si aciertas todos.
- **Campeón del Major:** lo eliges antes del primer partido.
- **Grupos de amigos:** cada grupo tiene un código de 6 letras y un enlace de invitación. Tus pronósticos cuentan en todos tus grupos.
- **Panel de administración** (`#/admin`):
  - corregir resultados, equipos y horas, ocultar partidos o añadirlos a mano;
  - poner los equipos de cada fase;
  - gestionar cuentas (PIN, apodo, bloqueos) y grupos;
  - ajustar puntos;
  - consultar el registro de actividad;
  - cambiar las reglas y puntos;
  - descargar una copia de seguridad.

## Cómo funciona

| Pieza | Dónde | Qué hace |
|---|---|---|
| Web (`index.html`, `css/`, `js/`, `img/`) | GitHub Pages | La página que ven los jugadores |
| `scripts/update_major.py` + `.github/workflows/update.yml` | GitHub Actions, cada 10 min | Lee las páginas del Major en Liquipedia y escribe `data/major.json` |
| `worker/worker.js` | Cloudflare Workers + base D1 | Cuentas, grupos, pronósticos, puntos y panel de admin |

El Worker lee `data/major.json` desde la propia web y le aplica las correcciones que hagas en el panel. Todas sus tablas empiezan por `cs_` y se crean solas la primera vez que se usa.

## Puesta en marcha (una sola vez)

### 1. Repositorio y GitHub Pages
1. Crea un repositorio nuevo en GitHub (por ejemplo `clutch`) y sube todos estos archivos.
2. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, luego la rama `main` y la carpeta `/ (root)`. La web quedará en `https://TU-USUARIO.github.io/clutch/`.
3. Ve a **Settings → Actions → General → Workflow permissions** y marca **Read and write permissions**, para que la acción pueda guardar `data/major.json`.
4. Ve a la pestaña **Actions**, entra en «Actualizar partidos del Major» y pulsa **Run workflow** para la primera descarga. A partir de ahí se ejecuta sola cada 10 minutos.

### 2. Base de datos y Worker en Cloudflare
1. En **Storage & Databases → D1** crea una base de datos, por ejemplo `clutch`.
2. En **Workers & Pages → Create → Worker**, crea un Worker (por ejemplo `clutch-pickem`), pulsa **Edit code**, pega el contenido de `worker/worker.js` y despliega.
3. En el Worker, abre **Settings → Bindings → Add → D1 database** y vincula la base `clutch`. El nombre de la variable da igual (por ejemplo `DB`).
4. En **Settings → Variables and Secrets** añade estas dos variables de texto:
   - `SITE_URL`: la dirección de tu web, sin barra final. Por ejemplo `https://TU-USUARIO.github.io/clutch`
   - `ADMINS`: los apodos de los administradores, separados por comas. Por ejemplo `Pachus`
5. Copia la dirección del Worker (`https://clutch-pickem.TU-SUBDOMINIO.workers.dev`).

### 3. Conectar la web con el Worker
Edita `js/config.js` y pon ahí la dirección del Worker:

```js
export const WORKER_URL = 'https://clutch-pickem.TU-SUBDOMINIO.workers.dev';
```

Sube el cambio. Después entra en la web, crea tu cuenta con el apodo que pusiste en `ADMINS` y verás el botón **Admin** arriba.

## Si Liquipedia no tiene algo

Al principio Liquipedia solo tiene los equipos y cruces que ya se conocen, y las páginas de cada fase aparecen poco a poco. Mientras falte algo, puedes resolverlo desde el panel:

- **Fases:** puedes poner a mano los 16 equipos de un Stage. El Pick'em de esa fase se abre en cuanto tiene 16 equipos, y los equipos también aparecen en la lista de campeones.
- **Partidos → Añadir partido:** para un cruce que no esté en Liquipedia. En los playoffs indica su posición en el cuadro (R1M1–R1M4 son los cuartos, R2M1–R2M2 las semifinales y R3M1 la final).
- **Partidos → Editar:** para poner un resultado, cambiar equipos u hora, u ocultar un partido. Tu corrección manda sobre Liquipedia hasta que la quites.

Si una página de Liquipedia falla, el script conserva los últimos datos buenos. Los avisos aparecen en **Admin → Resumen**.

## Uso de Liquipedia

- El script hace **una sola petición** cada 10 minutos (todas las páginas a la vez, con gzip) e identifica la web con el User-Agent `ClutchPickem/1.0 (fan site; https://github.com/TU-USUARIO/clutch)`. Es lo que pide la política de uso de su API.
- Los datos son de Liquipedia y tienen licencia CC-BY-SA 3.0. El pie de página lo indica.
- Si el Major cambia de nombre de página, edita `EVENT` y `STAGES` al principio de `scripts/update_major.py`.

## Probar en local

```bash
python3 -m http.server 8000          # la web en http://localhost:8000
python3 scripts/update_major.py      # descarga data/major.json (necesita internet)
```

El Worker acepta peticiones de `http://localhost:8000` además de `SITE_URL`.

---

Web de aficionados sin relación con PGL ni con Valve. Counter-Strike es una marca de Valve Corporation.
