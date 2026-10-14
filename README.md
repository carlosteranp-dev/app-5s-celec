# App de Evaluación 5S – CELEC SUR

PWA (HTML, CSS y JavaScript vanilla con módulos ES, sin compilación) para evaluar en campo la metodología 5S y 5S Digital, generar actas e informes PDF y consolidar los resultados de varios evaluadores por archivos.
La especificación completa está en [CLAUDE.md](CLAUDE.md). **Estado: las cuatro fases están implementadas** (ver "Fases").

## Cómo ejecutarla (desarrollo)

Necesita servirse por HTTP (los módulos ES no funcionan abriendo `index.html` con doble clic).

```bash
npx serve .
# o
python -m http.server 8000
```

En esta carpeta también hay un servidor mínimo de desarrollo (sin caché, solo en `127.0.0.1`): `node tools/servidor-dev.cjs 8123`. Para probar en el celular use `npx serve .` (el servidor mínimo no es accesible desde la red).

## Publicar en GitHub Pages

La app no necesita compilación: se publica tal cual, y todas sus rutas son relativas (funciona bajo `https://<usuario>.github.io/<repositorio>/`).

1. **Antes de cada publicación**, selle el service worker (calcula la versión de la caché y la lista de archivos):

   ```bash
   node tools/sellar.mjs
   npm test
   ```

   Si olvida sellar, `npm test` falla con un mensaje claro. Editar solo `instrumento_5S.json` **no** requiere sellar: el instrumento se actualiza solo (ver más abajo).
2. Suba los archivos al repositorio (la raíz del proyecto es la raíz del sitio; `.nojekyll` evita que GitHub Pages los procese).
3. En GitHub: *Settings → Pages → Build and deployment → Deploy from a branch* y elija la rama y la carpeta raíz.
4. Abra la dirección `https://…github.io/<repositorio>/` en cada teléfono **con conexión, una vez**, e instale la app.

> **Visibilidad:** con un plan gratuito el repositorio de GitHub Pages es público: el código y `instrumento_5S.json` quedan visibles. Los datos de las evaluaciones (fotos, firmas, resultados) no se publican nunca: viven solo en los teléfonos y en los archivos de respaldo.
>
> **Nunca** suba al repositorio archivos de respaldo (`Respaldo_5S_*.json`): contienen fotos y firmas.

### Instalar y usar sin conexión

- **Android (Chrome):** el inicio muestra un botón **Instalar**; también sirve el menú ⋮ → *Instalar aplicación*.
- **iPhone (Safari, iOS 16 o superior):** *Compartir → Agregar a pantalla de inicio*. Abra siempre la app desde ese ícono: Safari y la app instalada guardan sus datos por separado, y Safari puede borrar los datos de un sitio que no se usa durante 7 días.
- Cuando el inicio dice **"Lista para usar sin conexión"** ya se puede trabajar en una casa de máquinas sin señal: evaluar, tomar fotos, cerrar, generar PDF y exportar.
- Con una versión nueva aparece **"Nueva versión disponible – Actualizar"**. La actualización solo se aplica cuando usted toca el botón, nunca a mitad de una evaluación (los borradores se guardan solos).

## Flujo de trabajo

1. **Administrador (SGI):** crea sitios y áreas, y exporta **Respaldo → Solo el catálogo de sitios y áreas**. Envía el archivo a cada evaluador.
2. **Cada evaluador:** importa el catálogo (para que todos usen los mismos sitios y áreas), evalúa en campo y, al terminar, exporta **Respaldo → Solo las evaluaciones no exportadas**, lo guarda o envía y confirma "Sí, marcar como exportadas".
3. **Administrador:** importa cada archivo en **Respaldo → Importar**, revisa el resumen, confirma, y genera el informe en **Informes**. También puede exportar a Excel.

La app recuerda exportar: el inicio avisa si hay evaluaciones sin exportar y el último respaldo tiene más de 7 días.

## Respaldo, importación y consolidación

- **Archivo:** `Respaldo_5S_<evaluador>_<AAAAMMDD-HHmm>.json` con sitios, áreas, evaluaciones, acciones, fotos (base64), las copias del instrumento usadas, `schema_version`, `dispositivo_id` y conteos para detectar archivos truncados.
- **Importación:** fusiona por `id`. Si el registro ya existe gana el `modificado` más reciente; **las evaluaciones cerradas nunca se sobrescriben** (la única excepción es propagar una anulación); un borrador entrante no pisa nada local; las fotos no se modifican. Antes de guardar muestra un resumen (nuevos, actualizados, omitidos y conflictos) y todo se escribe en una sola transacción: o se importa todo o nada. Importar dos veces el mismo archivo no duplica registros.
- **Duplicados por nombre:** si dos evaluadores crearon el mismo sitio o área con identificadores distintos, se detecta por nombre (sin importar tildes ni mayúsculas) y se propone fusionarlos. Por eso conviene repartir el catálogo antes de empezar.
- **Seguridad:** solo se copian los campos conocidos de cada registro, las firmas deben ser PNG y las fotos JPEG verdaderos.
- **Limitación conocida:** `es_primera_evaluacion` queda congelada en las evaluaciones cerradas. Si dos evaluadores hicieron cada uno la "primera" evaluación del mismo área, ambas llevan S5.2 y S5.3 como N/A automático; el resumen de importación lo señala.
- **Archivos muy grandes:** en un celular la lectura de un respaldo de más de ~100 MB puede fallar por memoria. Use "Solo las evaluaciones no exportadas" o importe en un computador.

## Pruebas

```bash
npm test        # o: node --test
```

Ejecuta `tests/*.test.js`: motor de cálculo, validación del instrumento, selección de datos del informe, generación del acta y del informe PDF (en Node, con jsPDF cargado como en el navegador), reglas de fusión del respaldo, escritor de Excel, sellado del service worker y contraste de colores (WCAG AA) y objetivos táctiles. Para revisar los archivos de prueba: `ACTA_SALIDA=acta.pdf INFORME_SALIDA=informe.pdf XLSX_SALIDA=hojas.xlsx node --test`.

Nota: en Node 22 o superior `node --test tests/` ya no acepta una carpeta como argumento; use `node --test` o `npm test`.

## Estructura

| Archivo | Responsabilidad |
|---|---|
| `instrumento_5S.json` | Fuente única: escala, tipos de área, reglas, niveles, módulos, S, ítems, descriptores y pesos. |
| `sw.js` | Service worker: cache-first para la app, `/lib` y `/assets`; el instrumento con *stale-while-revalidate*. El bloque `SELLO` lo escribe `tools/sellar.mjs`. |
| `tools/sellar.mjs` | Calcula la versión de la caché y la lista de precarga y las escribe en `sw.js`. |
| `js/pwa.js` | Registro del service worker, aviso de nueva versión, estado sin conexión e instalación. |
| `js/instrumento.js` | Carga y validación del JSON (pesos, códigos únicos, descriptores 0/2/4, rangos, reglas). |
| `js/calc.js` | Motor de cálculo: funciones puras, sin DOM. |
| `js/db.js` | IndexedDB (todos los stores desde la v1) y consultas del dominio. |
| `js/config.js` | Parámetros de la app: fotos por ítem, tamaños y calidades JPEG. |
| `js/photos.js` | Captura, corrección EXIF, compresión y miniaturas de fotos. |
| `js/firmas.js` | Firma manuscrita en canvas táctil (PNG). |
| `js/charts.js` | Radar y barras con Chart.js (pantalla y PDF). |
| `js/pdf-comun.js` | Piezas compartidas de los PDF: medidas, texto seguro, títulos, pie y encabezado, carga de jsPDF y logo. |
| `js/pdf.js` | Acta PDF individual (`construirActa` es puro; `generarActa` reúne los datos del navegador). |
| `js/informe.js` | Datos del informe por sitios: qué evaluaciones entran, promedios, tendencias, hallazgos, plan de acción (puro). |
| `js/pdf-informe.js` | Informe PDF por sitios (`construirInforme` es puro; `generarInforme` reúne datos, fotos y gráficos). |
| `js/respaldo.js` | Formato del respaldo, validación y reglas de fusión de la importación (puro). |
| `js/export.js` | Armado del archivo de respaldo, lectura e importación (acceso a IndexedDB). |
| `js/xlsx.js`, `js/excel.js` | Escritor mínimo de Excel (sin dependencias) y armado de las hojas. |
| `js/entrega.js` | Compartir o descargar archivos, diálogos de progreso y de tamaño excedido. |
| `js/contexto.js` | Instrumento vigente y obtención del instrumento de cada evaluación. |
| `js/app.js` | Arranque y enrutador por hash. |
| `js/ui.js`, `js/util.js` | Componentes comunes y utilidades. |
| `js/views/*.js` | Pantallas. |
| `css/app.css` | Estilos; los colores de marca son variables `--marca-*` al inicio. |
| `assets/` | Logo (`logo.png`, generado desde `LOGO CELEC.pdf`) e íconos de la PWA. |

Todo ítem, descriptor, umbral y peso se lee del JSON: cambiarlos no requiere tocar el código. Para que el cambio llegue a los teléfonos basta publicar el JSON: la app lo revisa en segundo plano y muestra "El instrumento 5S fue actualizado – Actualizar". Si cambia el contenido, conviene cambiar también `meta.version`.

## Fases

1. **Fase 1:** estructura, instrumento validado, motor de cálculo, sitios y áreas, evaluación S por S con guardado automático.
2. **Fase 2:** fotos, acciones, firmas, cierre, anulación, radar, pantalla del área y acta PDF individual.
3. **Fase 3:** pantalla **Informes** e informe PDF por sitios.
4. **Fase 4 (esta):** PWA sin conexión (service worker versionado y aviso de actualización), exportación, importación y consolidación por archivos, exportación a Excel, recordatorios de exportar y tarjeta de instalación, y pulido visual (contraste AA, objetivos táctiles de 48 px).

## Decisiones de diseño acordadas

- **Niveles:** solo se usa el límite inferior `min` de cada rango; los huecos entre `max` y el siguiente `min` (p. ej. 39,99 → 40) no dejan valores sin nivel. El cálculo usa el valor sin redondear.
- **Visualización:** 1 decimal; si el redondeo cruzaría un límite de nivel (79,96 → "80,0 %") se muestran 2 decimales truncados.
- **Versiones del instrumento:** cada evaluación guarda `instrumento_version` e `instrumento_hash`, y la app guarda una copia del instrumento por versión+hash (store `instrumentos`) para interpretar evaluaciones antiguas. Un borrador sigue con la versión con la que empezó. Si el JSON cambia sin cambiar `meta.version`, se muestra una advertencia en el inicio.
- **Área:** la evaluación congela `area_tipo` (define qué ítems aplican). El tipo de un área con evaluaciones no se puede cambiar.
- **Sitios y áreas** no se borran, solo se desactivan.
- **Primera evaluación:** no hay otra evaluación cerrada y vigente (no anulada) del mismo módulo en el área. Se recalcula al abrir un borrador.
- **Digital:** el resultado del área es el promedio de la última evaluación por equipo (`equipo_codigo`) en el periodo; en "Sitios y áreas" el periodo son los últimos 12 meses. Nunca se combina con el físico.
- **Pendiente de exportar:** evaluación cerrada con `exportado_en` vacío, modificada después de exportarla, o con alguna acción modificada después.
- **Fecha:** `fecha` es la fecha local (AAAA-MM-DD); `creado` y `modificado` van en UTC.
- **Marca:** el azul y el amarillo se tomaron del logo; reemplazar si CELEC EP entrega valores oficiales.
- `codigo_formato` es `POR-ASIGNAR` y `version` es `1.0-borrador` en el JSON: los informes los mostrarán tal cual hasta que se cambien.

### Fase 2

- **Cierre:** exige ítems respondidos, foto en niveles 0/1/4, acción completa en 0/1 (descripción, responsable y fecha no anterior a la de la evaluación) y firmas. El responsable puede justificar su ausencia por escrito en lugar de firmar; en 5S Digital firma el usuario del equipo. Se puede cerrar con una S no evaluable (resultado "No evaluable").
- **Anulación:** única modificación permitida sobre una evaluación cerrada; exige motivo. Una anulada no cuenta como "previa", "última" ni "anterior", y sus acciones dejan de aparecer.
- **Acciones:** son entidades aparte; se pueden cerrar después del cierre de la evaluación.
- **Fotos:** se guardan a 1280 px y JPEG 0,7 más una miniatura de 240 px; en el PDF se reescalan a 800 px y JPEG 0,6. Las fotos huérfanas (la app se cerró antes de vincularlas) se reconectan al abrir la evaluación.
- **Nombre del acta:** `Acta_5S_<Area>_<AAAAMMDD>.pdf`; en digital `Acta_5S_Digital_<Area>_<Equipo>_<AAAAMMDD>.pdf`.
- **Entrega del PDF:** "PDF listo" con **Compartir / Guardar en Archivos** y **Descargar**, porque `navigator.share` exige un toque reciente del usuario.

### Fase 3

- **Qué entra:** físico = última evaluación cerrada y no anulada de cada área dentro del periodo; digital = última por equipo dentro del periodo. La tendencia (solo físico; triángulos vectoriales, "=" si la diferencia es menor a 1 punto) compara con la evaluación anterior del área aunque esté fuera del periodo.
- **Promedio por sitio:** promedio de los resultados físicos de sus áreas, solo por rango (sin la regla de la S más débil). Las áreas no evaluables se excluyen y se señalan.
- **Fotos del informe:** una por hallazgo o buena práctica (la primera), 800 px y JPEG 0,6. El acta individual lleva todas.
- **Tamaño:** si el PDF estimado supera 15 MB se ofrece omitir las fotos de buenas prácticas, reducir la calidad (600 px, 0,5) o continuar.
- **Plan de acción:** acciones abiertas de evaluaciones vigentes de los sitios elegidos con fecha hasta el fin del periodo; los días de atraso se cuentan a la fecha de emisión.
- **Anonimizar:** el usuario de 5S Digital se muestra como "Usuario N" y se oculta el responsable de las acciones del módulo digital.
- **"PDF listo":** muestra tamaño y tiempo de generación (criterio de aceptación 7).

### Fase 4

- **Service worker:** la versión de la caché es un hash del contenido de la app (sin el instrumento), escrito por `tools/sellar.mjs`; una prueba falla si se olvidó sellar. La versión nueva queda en espera hasta que la persona toca "Actualizar".
- **Exportar:** no incluye borradores salvo "Incluir borradores (respaldo completo)"; exportar no marca nada automáticamente: la app pregunta "¿Se guardó o envió el archivo?" y solo con "Sí" escribe `exportado_en` (sin cambiar `modificado`).
- **Importar:** reglas de fusión descritas arriba; lo importado queda como ya exportado (no cuenta como pendiente).
- **Excel:** una hoja por módulo (Físico, Digital) con una fila por evaluación cerrada y vigente, columnas por S y por ítem, y una hoja "Ítems" con la leyenda de códigos.
- **Registro:** las últimas 10 importaciones quedan en la pantalla Respaldo.

## Librerías locales (`/lib`)

Copiadas de los paquetes oficiales de npm (descargados con `npm pack`); no se cargan por CDN. Las licencias están en `lib/licencias/`.

| Archivo | Paquete | Versión | Fuente | SHA-256 |
|---|---|---|---|---|
| `jspdf.umd.min.js` | jspdf | 4.2.1 | https://registry.npmjs.org/jspdf/-/jspdf-4.2.1.tgz (`dist/jspdf.umd.min.js`) | `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54` |
| `jspdf.plugin.autotable.min.js` | jspdf-autotable | 5.0.8 | https://registry.npmjs.org/jspdf-autotable/-/jspdf-autotable-5.0.8.tgz (`dist/jspdf.plugin.autotable.min.js`) | `a65dff2c6a8296b16aff24e69f7683cd7dbaed4a4ec26b507d6840ee27d54649` |
| `chart.umd.min.js` | chart.js | 4.5.1 | https://registry.npmjs.org/chart.js/-/chart.js-4.5.1.tgz (`dist/chart.umd.min.js`) | `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a` |

Notas:
- El plugin autotable (UMD) no se aplica solo a jsPDF: la app llama a `applyPlugin(jsPDF)` tras cargarlo.
- jsPDF contiene referencias a un CDN (pdfobject) y a `XMLHttpRequest`, que solo se usan en rutas que la app no invoca (`output('pdfobjectnewwindow')` y `addImage` por URL). Todas las imágenes se entregan como bytes o data URL.
- El archivo Excel se genera con un escritor propio (`js/xlsx.js`), sin agregar dependencias.
