# Plan Mensual

App personal (web y móvil) para planificar las finanzas mes a mes.

- **Mes**: ingresos y gastos fijos.
- **Deudas**: banco, tipo de tarjeta o crédito, saldo, pago mensual, tasa, mantención y otros cargos.
- **Resumen**: reparto del ingreso, límite de gasto diario y semanal, ahorro recomendado y consejos.
- **Meta**: objetivo de ahorro manual, ahorro real por mes y proyección de cuándo lo alcanzas.

Es un solo archivo, `index.html`, sin proceso de build. Los datos se guardan en el `localStorage` del dispositivo. Con la cuenta de Google activada, los mismos datos se sincronizan entre tu teléfono y tu navegador.

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

## Cómo sincroniza

- Cada cambio se envía a tu cuenta unos segundos después de editarlo. Lo que cambias en un dispositivo aparece en el otro sin recargar.
- Si pierdes la conexión, sigues trabajando y se envía al volver.
- Si dos dispositivos editan sin conexión, gana el último cambio guardado.
- La primera vez que entras en un dispositivo que ya tiene datos distintos a los de tu cuenta, la app te pregunta cuáles conservar.
- Al cerrar sesión, los datos se borran de ese dispositivo y quedan en tu cuenta.
- Los datos se guardan como un solo documento por usuario en Firestore (`users/{uid}`).
