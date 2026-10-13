# Plan Mensual

App personal (web y móvil) para planificar las finanzas mes a mes.

- **Mes**: ingresos y gastos fijos.
- **Deudas**: banco, tipo de tarjeta o crédito, saldo, pago mensual, tasa, mantención y otros cargos.
- **Resumen**: reparto del ingreso, límite de gasto diario y semanal, ahorro recomendado y consejos.
- **Meta**: objetivo de ahorro manual, ahorro real por mes y proyección de cuándo lo alcanzas.

Es un solo archivo, `index.html`, sin proceso de build. Los datos se guardan en el `localStorage` del dispositivo. Con la cuenta de Google activada, los mismos datos se sincronizan entre tu teléfono y tu navegador.

## Instalarla en el teléfono

La app se puede instalar desde el navegador, sin tienda de aplicaciones. Queda con su propio ícono, en pantalla completa, y la pantalla abre aunque no tengas conexión (guardar en la cuenta y sincronizar sí necesitan internet).

- **iPhone (Safari)**: abre la dirección del sitio, toca **Compartir** y luego **Agregar a pantalla de inicio**. En iOS 17 o posterior puedes elegir si se abre como app (pantalla completa) o como acceso directo al navegador, con el interruptor **Abrir como app web**.
- **Android (Chrome)**: abre la dirección, toca el menú ⋮ y luego **Instalar app** (o **Agregar a la pantalla principal**).

Nota para iPhone: la app instalada guarda sus datos y su sesión aparte de Safari, así que debes iniciar sesión con Google dentro de ella. Si Apple bloquea la ventana de Google en la app instalada, inicia sesión desde Safari o instala la app con **Abrir como app web** desactivado.

Archivos que lo hacen posible: `manifest.webmanifest`, `sw.js` (service worker) e `icons/`. Si cambias el contenido de los archivos que `sw.js` guarda, sube el número de `CACHE` para que los teléfonos lo actualicen.

## Activar la cuenta (Firebase)

Sin esta configuración la app funciona igual, solo en el dispositivo donde la abras.

1. **Crea el proyecto.** En [console.firebase.google.com](https://console.firebase.google.com) crea un proyecto (puedes desactivar Google Analytics).
2. **Activa el login.** En *Authentication > Sign-in method* habilita **Google** y elige tu correo como correo de soporte.
3. **Crea la base de datos.** En *Firestore Database* crea una base en modo producción, en la región más cercana (por ejemplo `southamerica-east1`).
4. **Pega las reglas.** En *Firestore Database > Reglas* copia el contenido de `firestore.rules` y publícalo. Estas reglas hacen que cada usuario solo acceda a sus propios datos.
5. **Registra la app web.** En *Configuración del proyecto > Tus apps* agrega una app web y copia el objeto `firebaseConfig`. Pégalo en `index.html`, en la constante `FIREBASE_CONFIG`. Esos valores son públicos por diseño; la seguridad la dan las reglas del paso 4.
6. **Publica el sitio con HTTPS.** El login de Google no funciona abriendo el archivo directo desde el disco. La opción más simple es GitHub Pages: en el repo, *Settings > Pages*, elige la rama `main` y la carpeta raíz. La dirección queda como `https://<usuario>.github.io/Personal_App/`.
7. **Autoriza el dominio.** En Firebase, *Authentication > Settings > Authorized domains*, agrega `<usuario>.github.io`.

Para probar en tu computador antes de publicar, sirve la carpeta con `python3 -m http.server 8000` y abre `http://localhost:8000` (`localhost` ya viene autorizado).

## Quién puede entrar (administrador)

Solo pueden guardar datos el administrador y los correos que él agregue. El administrador es `israllaire@gmail.com`, definido en `firestore.rules` (función `isAdmin`) y en la constante `ADMIN_EMAIL` de `index.html`. Si cambias el correo, cámbialo en los dos lugares y vuelve a publicar las reglas.

- **Dar o quitar acceso**: el administrador abre Ajustes (el engranaje), sección **Acceso a la app**, escribe un correo de Google y toca **Dar acceso**. Para quitarlo, toca **Quitar** dos veces. El cambio rige de inmediato.
- Cada persona con acceso tiene **sus propios datos**. No ve los del administrador ni los de otras personas.
- Quien no está en la lista puede iniciar sesión con Google, pero las reglas le niegan leer y guardar. La app le avisa a quién pedir acceso y sigue funcionando solo en su dispositivo.
- Si quitas a alguien, sus datos siguen en Firestore. Si quieres borrarlos, hazlo desde la consola de Firebase (*Firestore Database > Datos > users*).
- La lista vive en la colección `allowed` de Firestore (un documento por correo, en minúsculas). Se puede editar también desde la consola.
- Cada vez que cambies `firestore.rules`, pégalas de nuevo en *Firestore Database > Reglas* y toca **Publicar**.

## Cómo sincroniza

- Cada cambio se envía a tu cuenta unos segundos después de editarlo. Lo que cambias en un dispositivo aparece en el otro sin recargar.
- Si pierdes la conexión, sigues trabajando y se envía al volver.
- Los datos de dos dispositivos se **unen**, no se reemplazan: cada ingreso, gasto fijo o deuda se une por separado. Si el mismo elemento se editó en los dos, queda la edición más reciente. Las eliminaciones se respetan.
- Si el reloj de un dispositivo está desajustado, "la edición más reciente" puede equivocarse en el mismo elemento. Mantén la hora automática activada.
- La primera vez que entras en un dispositivo que ya tiene datos distintos a los de tu cuenta, la app pregunta si combinar ambos, usar solo los de la cuenta o solo los del dispositivo. No se puede cerrar esa pregunta sin elegir.
- **Borrar todo** y **Restaurar respaldo** reemplazan los datos en todos tus dispositivos.
- Al cerrar sesión, los datos se borran de ese dispositivo y quedan en tu cuenta. Si hay cambios que aún no se enviaron, la app no te deja cerrar sesión.
- Los datos se guardan como un solo documento por usuario en Firestore (`users/{uid}`).
