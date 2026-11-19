# DICLIK · Fase 4

Aplicación web y Android para solicitudes de servicios, ofertas, contratación, mensajería y gestión de contratos.

Creado por Elisandro Álvarez.

## Desarrollo y pruebas

Requiere Node.js 22.12 o superior y npm. Desde la raíz del proyecto:

```sh
npm ci
npm run lint
npm test
npm run build
npm run dev
```

`npm test` usa PGlite en memoria y crea sus propias cuentas. No restaura el archivo de respaldo ni usa la base configurada en `DATABASE_URL`. Para probar la interfaz de demostración, ejecuta `VITE_DICLIK_DEMO=true npx vite --mode test` en un entorno aislado. La compilación web normal usa las rutas de la API.

## Entorno previo a producción

Configura una base PostgreSQL de pruebas, los secretos y los orígenes permitidos según `.env.example`. El servidor compilado arranca desde la raíz con `NODE_ENV=production npm start`, una vez ejecutado `npm run build`. Sirve los archivos públicos desde `dist/web` y aplica las migraciones SQL de `src/server/db/migrations`.

Configura `SMTP_URL` y `PASSWORD_RESET_FROM` para enviar códigos de recuperación. Mantén `ENABLE_PAYMENT_WEBHOOK=false` mientras no haya una pasarela validada. `ALLOW_SANDBOX_PAYMENTS=true` permite la recarga de prueba solo con `NODE_ENV=test`.

Para Android, consulta `GUIA_COMPILAR_APK.md`. Define `VITE_API_BASE_URL` con la URL HTTPS del backend de pruebas antes de volver a compilar y sincronizar Capacitor. Para permitir acceso desde el WebView, configura `https://localhost` en `CORS_ORIGIN` del servidor junto a los demás orígenes autorizados.

Los veredictos y pendientes están en `INFORME_DICLIK_FASE4.md`.

Para publicar el entorno de pruebas bajo HTTPS, consulta `deploy/ENTORNO_PRUEBAS.md`.

## País e idioma

La pantalla inicial permite elegir un país manualmente o detectarlo por GPS.
Al pulsar **Detectar con GPS**, se solicita permiso y se envían coordenadas
redondeadas a dos decimales a BigDataCloud para obtener el código de país.
Diclik guarda la selección localmente, sin guardar las coordenadas en este flujo.

La entrada está disponible en español, inglés y portugués. El selector muestra
el código de moneda de cada país incluido. Los portales operativos y los importes
actuales siguen habilitados para República Dominicana (DOP). Las demás opciones
son una vista previa regional. Para abrir un mercado se requiere configurar y
validar en el servidor su moneda operativa, reglas fiscales y facturación.
La ubicación del dispositivo sirve para sugerir el país y no determina por sí
sola la jurisdicción fiscal de una operación.
