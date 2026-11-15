# Clutch · Pick'em e historial de los Majors de Counter-Strike

Una web de aficionados con dos partes. No hay apuestas ni dinero, solo puntos.

1. **Pick'em** del Major que toque (ahora el PGL Major Singapore 2026) para jugar con amigos. Cuando termina un Major, el Pick'em pasa solo al siguiente. Los grupos y las cuentas se mantienen y cada Major guarda su clasificación.
2. **Historial de Majors** (`#/majors`): todos los Majors desde DreamHack Winter 2013, con su campeón, la final, el palmarés de equipos, las fases (suizo o grupos), el cuadro y todos los partidos con sus mapas. Los Majors nuevos se añaden según se juegan.

En el Pick'em:

- **Partido a partido:** eliges el ganador de cada partido y, en los Bo3 y Bo5, también el resultado exacto. El pronóstico se puede cambiar hasta que empieza el partido.
- **Pick'em de cada fase (estilo Valve):** en cada Stage suizo eliges dos equipos que acabarán 3-0, seis que pasarán con 3-1 o 3-2 y dos que caerán 0-3. Se cierra al empezar la fase.
- **Cuadro de playoffs:** eliges los ganadores de cuartos, semifinales y la final. Se cierra al empezar los playoffs.
- **Combinadas:** juntas de 2 a 4 partidos de una misma ronda. Solo puntúan si aciertas todos.
- **Campeón del Major:** lo eliges antes del primer partido.
- **Grupos de amigos:** cada grupo tiene un código de 6 letras y un enlace de invitación. Tus pronósticos cuentan en todos tus grupos. Arriba del grupo se puede cambiar de Major para ver la clasificación y los pronósticos de los anteriores.
- **Panel de administración** (`#/admin`):
  - corregir resultados, equipos y horas, ocultar partidos o añadirlos a mano;
  - poner los equipos de cada fase;
  - gestionar cuentas (PIN, apodo, bloqueos) y grupos;
  - ajustar puntos;
  - consultar el registro de actividad;
  - ver qué Majors se han descargado, poner el MVP o una nota a cada uno y elegir a mano el Major del Pick'em;
  - cambiar las reglas y puntos;
  - descargar una copia de seguridad.

## Cómo funciona

| Pieza | Dónde | Qué hace |
|---|---|---|
| Web (`index.html`, `css/`, `js/`, `img/`) | GitHub Pages | La página que ven los jugadores |
| `scripts/update_majors.py` + `.github/workflows/update.yml` | GitHub Actions, cada 10 min | Lee los Majors en Liquipedia y escribe `data/majors/index.json` y un `data/majors/<id>.json` por Major |
| `worker/worker.js` | Cloudflare Workers + base D1 | Cuentas, grupos, pronósticos, puntos y panel de admin |

El historial lo lee la web directamente de `data/majors/`. El Worker lee de ahí el Major del Pick'em y le aplica las correcciones que hagas en el panel. Todas sus tablas empiezan por `cs_` y se crean solas la primera vez que se usa. Si vienes de la primera versión, el Worker rehace solo las tablas de pronósticos: las cuentas y los grupos se conservan.

## Puesta en marcha (una sola vez)

### 1. Repositorio y GitHub Pages
1. Crea un repositorio nuevo en GitHub (por ejemplo `clutch`) y sube todos estos archivos.
2. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, luego la rama `main` y la carpeta `/ (root)`. La web quedará en `https://TU-USUARIO.github.io/clutch/`.
3. Ve a **Settings → Actions → General → Workflow permissions** y marca **Read and write permissions**, para que la acción pueda guardar la carpeta `data/majors/`.
4. Ve a la pestaña **Actions**, entra en «Actualizar Majors» y pulsa **Run workflow** para la primera descarga. A partir de ahí se ejecuta sola cada 10 minutos. El historial completo tarda alrededor de una hora en llenarse, porque cada ejecución descarga como mucho 5 Majors antiguos para no cargar a Liquipedia.

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

## Majors: historial y Major del Pick'em

- La lista está al principio de `scripts/update_majors.py` (`MAJORS`): los 24 Majors desde 2013, Singapur 2026 y los ya anunciados (Buenos Aires y Shanghái 2027).
- **Para añadir un Major nuevo**, copia una línea de la lista y cambia el id, el nombre, la ciudad, las fechas y el texto de búsqueda. El script busca solo su página en Liquipedia. Si la encuentra mal, escribe la página a mano en `page`.
- Cada Major antiguo se descarga una vez y queda guardado. Si Liquipedia no tiene sus partidos, la ficha se muestra igualmente con el campeón y la final de la lista.
- **El Major del Pick'em** cambia solo una semana después de que termine el anterior. Si quieres adelantarlo o retrasarlo, elígelo en **Admin → Ajustes → Major del Pick'em**.
- En **Admin → Majors** ves qué se ha descargado y los avisos de cada Major, y puedes ponerle a cada uno el MVP y una nota.

## Actualizar a mano

En GitHub ve a **Actions → «Actualizar Majors» → Run workflow**. Si dejas las dos casillas vacías, hace una actualización normal en ese momento. Si las rellenas:

- **Majors a volver a descargar:** los ids separados por comas (por ejemplo `2025-austin,2024-copenhagen`), o `todos` para releer todos los Majors ya jugados. Sirve si Liquipedia corrigió algo de un Major que ya estaba guardado. Con `todos` tarda unos minutos.
- **Logos:** `faltan` vuelve a intentar los logos que no se encontraron; `todos` vuelve a bajar todos los logos, en tandas de 40.

Los ids están en la lista `MAJORS` de `scripts/update_majors.py` y en la dirección de cada ficha (`#/majors/2025-austin`).

## Logos de los equipos

- La misma acción descarga de Liquipedia el logo de cada equipo que aparece en los Majors. Guarda la versión para fondo oscuro si existe; si no, la normal sobre una chapa clara.
- Los logos van a `img/teams/` y la lista a `data/teams.json`. Cada ejecución descarga como mucho 40 imágenes, así que la primera vez tardan un rato en estar todos.
- Para saber el logo de cada equipo hace falta una consulta `parse` (Liquipedia pide no más de una cada 30 segundos), y solo se hace mientras falten logos.
- Si un equipo no tiene logo, se ven sus iniciales, como antes.
- Los logos son marcas de sus equipos. La web solo los muestra para identificarlos, como hace Liquipedia.

## Si Liquipedia no tiene algo

Al principio Liquipedia solo tiene los equipos y cruces que ya se conocen, y las páginas de cada fase aparecen poco a poco. Mientras falte algo, puedes resolverlo desde el panel:

- **Fases:** puedes poner a mano los 16 equipos de un Stage. El Pick'em de esa fase se abre en cuanto tiene 16 equipos, y los equipos también aparecen en la lista de campeones.
- **Partidos → Añadir partido:** para un cruce que no esté en Liquipedia. En los playoffs indica su posición en el cuadro (R1M1–R1M4 son los cuartos, R2M1–R2M2 las semifinales y R3M1 la final).
- **Partidos → Editar:** para poner un resultado, cambiar equipos u hora, u ocultar un partido. Tu corrección manda sobre Liquipedia hasta que la quites.

Si una página de Liquipedia falla, el script conserva los últimos datos buenos. Los avisos aparecen en **Admin → Resumen**.

## Uso de Liquipedia

- Para el Major del Pick'em, el script hace **una o dos consultas** cada 10 minutos (con gzip) e identifica la web con el User-Agent `ClutchPickem/1.1 (fan site; https://github.com/TU-USUARIO/clutch)`. Es lo que pide la política de uso de su API.
- Los datos son de Liquipedia y tienen licencia CC-BY-SA 3.0. El pie de página lo indica.
- Para los Majors antiguos hace falta una búsqueda y dos lecturas por Major, una sola vez. Entre consultas espera 2,5 segundos.

## Probar en local

```bash
python3 -m http.server 8000          # la web en http://localhost:8000
python3 scripts/update_majors.py     # descarga data/majors/ (necesita internet)
```

El Worker acepta peticiones de `http://localhost:8000` además de `SITE_URL`.

---

Web de aficionados sin relación con PGL ni con Valve. Counter-Strike es una marca de Valve Corporation.
