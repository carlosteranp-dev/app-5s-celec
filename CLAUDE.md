# App de Evaluación 5S – CELEC SUR

Especificación del proyecto para Claude Code. Léela completa antes de planificar o escribir código.

## 1. Contexto

- **Organización:** CELEC EP – Unidad de Negocio Generación Sur (CELEC SUR), Ecuador. Generación hidroeléctrica.
- **Propósito:** evaluar en campo el grado de implementación de la metodología 5S en las áreas de cada sitio (centrales, talleres, bodegas, oficinas) y en los computadores de los usuarios (5S Digital), y generar informes PDF profesionales por sitio.
- **Usuarios:** evaluadores internos con celulares **Android y iPhone**, y un administrador del SGI que consolida y emite informes (puede usar celular o PC).
- **Entorno:** casas de máquinas y zonas remotas con señal débil o nula; uso con una mano, de pie, a veces con guantes y luz exterior.
- **Idioma de la interfaz, los informes y los comentarios del código:** español (Ecuador).

## 2. Fuente única del instrumento

- `instrumento_5S.json` (en la raíz) define escala, tipos de área, reglas, interpretación, módulos, S, ítems, descriptores y pesos.
- **Nunca codifiques ítems, textos de descriptores, umbrales ni pesos en el código.** Todo se lee del JSON. Si mañana cambia un descriptor o un peso, solo se edita el JSON.
- Cada evaluación guarda `instrumento_version` (de `meta.version`) para que las evaluaciones antiguas se sigan interpretando con su versión.
- Valida el JSON al cargarlo (pesos suman 1 por módulo, códigos únicos, descriptores 0/2/4 presentes) y muestra un error claro si falla.

## 3. Arquitectura y stack

- **PWA** en HTML, CSS y JavaScript vanilla (módulos ES). Sin frameworks ni paso de compilación.
- Se publicará en una URL estática (servidor interno, SharePoint o GitHub Pages). Para desarrollo: `npx serve .` o `python3 -m http.server`.
- **Librerías locales en `/lib`, no por CDN en tiempo de ejecución**, para que funcione sin conexión:
  - jsPDF + jspdf-autotable (PDF)
  - Chart.js (gráficos radar y de barras, renderizados a canvas para la app y para el PDF)
  - Documenta en el README la versión exacta y la fuente de cada librería.
- **Service worker** con estrategia cache-first para la app, `/lib`, `/assets` e `instrumento_5S.json`. Versiona la caché y muestra un aviso de "Nueva versión disponible – Actualizar" cuando cambie.
- **Almacenamiento:** IndexedDB (no localStorage para datos). Solicita `navigator.storage.persist()` al iniciar. localStorage solo para preferencias de interfaz.
- Estructura sugerida:

```
/index.html
/manifest.webmanifest
/sw.js
/instrumento_5S.json
/css/app.css
/js/app.js          (arranque y enrutador por hash)
/js/db.js           (IndexedDB)
/js/calc.js         (motor de cálculo: funciones puras, sin DOM)
/js/views/*.js      (pantallas)
/js/pdf.js          (informes)
/js/export.js       (exportación e importación)
/js/photos.js       (captura y compresión)
/lib/               (librerías locales)
/assets/            (logo, íconos de la PWA)
/tests/calc.test.js (pruebas con node --test)
```

## 4. Modelo de datos (IndexedDB)

Todas las entidades llevan `id` (UUID v4 con `crypto.randomUUID()`), `creado`, `modificado` (ISO 8601) y `dispositivo_id`.

- **sitios:** `nombre` (p. ej., una central), `ubicacion`, `activo`.
- **areas:** `sitio_id`, `nombre`, `tipo` (O, B o A, de `tipos_area`), `responsable`, `activo`.
- **evaluaciones:** `area_id`, `modulo` (`fisico` o `digital`), `fecha`, `evaluador` (nombre y cargo), `instrumento_version`, `estado` (`borrador` o `cerrada`), `es_primera_evaluacion` (calculado: no hay evaluaciones cerradas previas del mismo módulo en esa área), `personas_presentes`, `observacion_general`, `respuestas[]`, `resultado` (calculado al cerrar y congelado), `firmas` (evaluador y responsable, imagen PNG en base64).
  - Para `digital` además: `usuario_nombre`, `usuario_cargo`, `equipo_codigo`, `confidencialidad_aceptada` (booleano obligatorio, se muestran las reglas de `reglas_confidencialidad` antes de empezar).
- **respuestas[]** (dentro de la evaluación): `codigo`, `valor` (0–4 o null), `na` (`null`, `automatico` o `manual`), `na_justificacion`, `observacion`, `foto_ids[]`.
- **fotos:** `evaluacion_id`, `codigo_item`, `blob` (JPEG comprimido), `ancho`, `alto`, `fecha`.
- **acciones:** `evaluacion_id`, `codigo_item`, `descripcion`, `responsable`, `fecha_compromiso`, `estado` (`abierta` o `cerrada`), `fecha_cierre`.
- **config:** perfil del evaluador, `dispositivo_id`, preferencias.

Una evaluación **cerrada no se edita**. Para corregirla, se anula (queda en el historial con motivo) y se crea una nueva.

## 5. Reglas de cálculo (`js/calc.js`, funciones puras y probadas)

Aplica exactamente las reglas de `instrumento_5S.json → reglas` e `interpretacion`:

1. **N/A automático:** el ítem no aplica al tipo de área (`aplica` no incluye el tipo; en el módulo digital todos aplican) o tiene `na_en_primera_evaluacion: true` y es la primera evaluación. Se marca solo, el evaluador no lo puede cambiar, no se califica y no cuenta para el máximo.
2. **N/A manual:** lo marca el evaluador con justificación obligatoria. Cuenta para `max_na_por_s`.
3. **Puntaje de cada S:** `P_S = suma(c_i) / (4 * n) * 100`, donde `n` = ítems calificados (sin ningún tipo de N/A).
4. **S no evaluable:** N/A manuales > `max_na_por_s` o `n` < `min_items_calificados_por_s`.
5. **Resultado global:** `P_global = suma(w_j * P_Sj)` con los pesos del módulo. Si alguna S es no evaluable, **no hay resultado global** (`null`) y el nivel es "No evaluable".
6. **Nivel:** según los rangos de `interpretacion`, usando el valor sin redondear.
7. **Regla de la S más débil:** si el nivel es uno de `niveles_bloqueados` y alguna S está por debajo de `umbral_porcentaje`, el nivel pasa a `nivel_asignado`. El informe debe indicar que se aplicó esta regla.
8. **Redondeo:** calcular con precisión completa; mostrar con 1 decimal.
9. **Resultado digital del área:** promedio de los `P_global` de los usuarios evaluados en el periodo (excluye los no evaluables y lo indica). Nunca se combina con el resultado físico.
10. **Próxima evaluación sugerida:** `fecha + reevaluar_meses` del nivel obtenido.

`tests/calc.test.js` debe cubrir como mínimo: todo 4 → 100 % y Sostenido; todo 0 → 0 % y Crítico; área administrativa (N/A automáticos) que sí es evaluable; 3 N/A manuales en una S → no evaluable y sin global; primera evaluación con S5.2 y S5.3 automáticos; promedio 85 % con una S en 55 % → En desarrollo; límites exactos de rangos (39,99 / 40 / 59,99 / 60 / 79,99 / 80 / 89,99 / 90); pesos distintos de 0,2.

## 6. Pantallas y flujo

1. **Inicio:** perfil del evaluador (primera vez), botones grandes: "Nueva evaluación", "Continuar borradores", "Sitios y áreas", "Informes", "Respaldo". Indicador de evaluaciones pendientes de exportar.
2. **Sitios y áreas:** alta, edición y desactivación (no borrado si tiene evaluaciones). Muestra el último resultado y la tendencia de cada área.
3. **Nueva evaluación:** elegir sitio → área → módulo (físico o digital). En digital: datos del usuario y aceptación de las reglas de confidencialidad.
4. **Evaluación, S por S:**
   - Encabezado fijo: nombre de la S, traducción, propósito, avance ("S2 de 5 · 13/25 ítems") y botones Anterior/Siguiente.
   - Cada ítem es una tarjeta: código, texto, y cinco botones grandes 0–4 más "N/A". Al tocar un nivel se muestra su descriptor (0, 2 y 4 desde el JSON; 1 y 3 con el criterio general de `escala`).
   - Campo de observación por ítem.
   - **Validaciones según las reglas:** foto obligatoria en niveles 0, 1 y 4; acción obligatoria (descripción, responsable, fecha) en 0 y 1; justificación obligatoria en N/A manual. Los ítems incompletos se marcan en rojo y bloquean el cierre.
   - Guardado automático en cada cambio. Se puede salir y retomar.
5. **Resumen y cierre:** gráfico radar de las 5 S, tabla de puntajes, resultado global, nivel con su color, aviso si se aplicó la regla de la S más débil, lista de acciones, firma del evaluador y del responsable del área (canvas táctil), botón "Cerrar evaluación". Al cerrar: congela el resultado y ofrece "Descargar acta PDF".
6. **Informes:** elegir uno o varios sitios, periodo (desde–hasta) y módulos → "Generar informe PDF".
7. **Respaldo:** exportar, importar y consolidar (sección 8).

## 7. Informes PDF (requisito central)

Se generan **en el dispositivo, sin conexión**, con jsPDF y autotable. Formato A4 vertical, márgenes de 15 mm, tipografía sans legible, colores de nivel desde `interpretacion`.

### 7.1 Acta de evaluación individual
Una evaluación: encabezado institucional, datos (sitio, área, tipo, responsable, evaluador, fecha, personas presentes), radar, tabla de puntajes por S, resultado y nivel, tabla de todos los ítems (código, ítem, calificación, observación), fotos en miniatura con su código, acciones, firmas.

### 7.2 Informe por sitios evaluados
Para los sitios y periodo seleccionados, usando la **última evaluación cerrada** de cada área y módulo dentro del periodo:

1. **Portada:** logo, "Informe de Evaluación 5S", sitios incluidos, periodo, fecha de emisión, elaborado por.
2. **Resumen ejecutivo:**
   - Tabla por sitio: número de áreas evaluadas, promedio físico, promedio digital, nivel.
   - Tabla por área: sitio, área, tipo, fecha, % físico, % digital, nivel (celda con el color del nivel), tendencia frente a la evaluación anterior (▲ ▼ =).
   - Gráfico de barras horizontales del % físico por área, ordenado de menor a mayor, con líneas de referencia en 60 % y 80 %.
3. **Detalle por área** (cada área inicia en página nueva): radar de las 5 S, tabla de puntajes por S, resultado, nivel y si se aplicó la regla de la S más débil; **hallazgos** (ítems con 0 o 1: código, ítem, observación, foto); **buenas prácticas** (ítems con 4, con foto); 5S Digital del área: tabla por usuario (equipo, cargo, %, nivel) y promedio. En la tabla digital no se muestra el nombre del usuario si el administrador elige "anonimizar" al generar el informe.
4. **Plan de acción consolidado:** todas las acciones abiertas (sitio, área, ítem, acción, responsable, fecha compromiso, días de atraso).
5. **Anexo:** escala de calificación y rangos de interpretación tomados del JSON.

**Pie de página en todas las páginas:** código de formato y versión (`meta`), "Página X de Y", fecha y hora de generación. **Encabezado** desde la página 2: nombre de la organización y título del informe.

**Fotos en el PDF:** reescalarlas a un máximo de 800 px y JPEG 0,6 al insertarlas. Si el PDF estimado supera 15 MB, avisar y ofrecer generar sin fotos de buenas prácticas.

**Gráficos:** dibujarlos con Chart.js en un canvas oculto con ancho fijo (para que el resultado no dependa de la pantalla del celular), exportar con `toDataURL('image/png')` e insertar.

### 7.3 Descarga en el dispositivo (iOS y Android)
- Generar el PDF como `Blob`.
- Si `navigator.canShare({ files: [file] })` es verdadero, usar `navigator.share` (en iPhone permite "Guardar en Archivos", WhatsApp o correo).
- Si no, descargar con un enlace `<a download>` y `URL.createObjectURL`. En Android Chrome debe quedar en Descargas.
- Nombre de archivo: `Informe_5S_<Sitio>_<AAAAMMDD>.pdf` (varios sitios: `Informe_5S_Consolidado_<AAAAMMDD>.pdf`) y `Acta_5S_<Area>_<AAAAMMDD>.pdf`. Sin espacios ni tildes en el nombre.

## 8. Exportación, importación y consolidación

No hay servidor. La consolidación se hace por archivos:

- **Exportar:** un `.json` con sitios, áreas, evaluaciones, acciones y fotos (en base64), con `schema_version` y `dispositivo_id`. Opción "solo evaluaciones no exportadas". Se comparte con `navigator.share` o se descarga. Nombre: `Respaldo_5S_<evaluador>_<AAAAMMDD-HHmm>.json`.
- **Exportar a Excel (opcional, fase 4):** una hoja por módulo con una fila por evaluación y columnas por ítem y por S.
- **Importar:** fusiona por `id`. Si el registro ya existe, gana el de `modificado` más reciente; las evaluaciones cerradas nunca se sobrescriben. Muestra un resumen antes de confirmar: nuevos, actualizados, omitidos y conflictos.
- Así, cada evaluador exporta su archivo y el administrador los importa en su dispositivo para emitir el informe consolidado.

## 9. Interfaz y marca

- Diseño sobrio e institucional, de aspecto profesional. Variables CSS para los colores de marca CELEC EP (el usuario proveerá los valores y el logo en `/assets/logo.png`; usa marcadores claros mientras tanto).
- Objetivos táctiles de al menos 48 px; texto base de 16 px (evita el zoom automático de iOS en los campos); contraste WCAG AA; tema claro por defecto y legible a pleno sol.
- Funciona de 360 px de ancho en adelante; en PC se centra con un ancho máximo cómodo.
- Respeta `safe-area-inset` en iPhone.
- Mensajes de error y confirmación en español claro. Confirmación antes de cerrar o anular una evaluación.

## 10. Fotos

- Captura con `<input type="file" accept="image/*" capture="environment">` (también permitir galería).
- Compresión antes de guardar: lado mayor de 1280 px, JPEG 0,7, respetando la orientación EXIF.
- Máximo 3 fotos por ítem. Miniaturas en la tarjeta del ítem, con opción de eliminar mientras la evaluación esté en borrador.
- Indicador del espacio de almacenamiento usado (`navigator.storage.estimate()`).

## 11. Criterios de aceptación

1. Con el modo avión activado (después de abrir la app una vez), se crea, completa, cierra y exporta una evaluación, y se genera su PDF.
2. Se cierra la app a mitad de una evaluación, se reabre y no se pierde nada.
3. En un área administrativa, S2 queda evaluable con sus 2 ítems aplicables.
4. Una evaluación con 3 N/A manuales en una S muestra "No evaluable" y no emite resultado global.
5. Un promedio de 85 % con una S en 55 % se clasifica como En desarrollo y el informe lo explica.
6. No se puede cerrar una evaluación con ítems pendientes, ni con un 0, 1 o 4 sin foto, ni con un 0 o 1 sin acción.
7. Un informe de un sitio con 8 áreas y fotos se genera en menos de 30 s en un celular de gama media y pesa menos de 15 MB.
8. El PDF se descarga o comparte correctamente en iPhone (Safari, iOS 16 o superior) y en Android (Chrome).
9. Importar dos veces el mismo archivo no duplica registros.
10. Cambiar un peso o un descriptor en el JSON se refleja en la app sin tocar el código.
11. `node --test tests/` pasa sin errores.
12. La app se instala con "Agregar a pantalla de inicio" y abre sin la barra del navegador.

## 12. Forma de trabajo

- **Primero entrega un plan** (archivos, módulos, decisiones y riesgos) y espera aprobación antes de programar.
- Implementa **por fases**, y al final de cada una indica cómo probarla en el celular:
  1. Estructura, carga y validación del JSON, motor de cálculo con pruebas, sitios y áreas, evaluación completa con guardado en IndexedDB.
  2. Fotos, acciones, firmas, cierre y acta PDF individual.
  3. Informe PDF por sitios evaluados, gráficos y descarga en iOS y Android.
  4. PWA sin conexión, exportación, importación y consolidación, exportación a Excel opcional, pulido visual.
- Código legible, con funciones pequeñas y comentarios en español donde la lógica no sea obvia.
- No añadas dependencias fuera de las indicadas sin consultarlo.
- Si una regla del JSON es ambigua o contradictoria, **pregunta** en lugar de suponer.

## 13. Fuera de alcance (por ahora)

- Servidor, base de datos central o autenticación.
- Sincronización automática entre dispositivos.
- Publicación en Google Play o App Store.
