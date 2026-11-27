# VIPER · Matriz de validación móvil — Android e iPhone

Fecha de preparación: 27/11/2026 · Ámbito: **PWA instalada desde el sitio**, NO una versión nativa de App Store / Play Store.

URL oficial: https://viperfitness.vercel.app/

## Alcance y condiciones

- Usar preferentemente **dos cuentas de prueba**, sin contraseñas reales, dinero ni fotos privadas.
- Probar primero en navegador móvil y después desde el icono instalado. **Son dos contextos que pueden comportarse distinto**: cada uno debe validarse.
- Anotar marca/modelo, versión de Android/iOS, navegador/versión, conexión (Wi‑Fi/4G), fecha/hora Perú y resultado por escenario.
- Registrar incidencia con ID, pasos reproducibles, resultado esperado/real y captura **sin mostrar tokens, correos, datos de perfil, mensajes ni fotos privadas**.
- Las pruebas de XP deben usar una cuenta de prueba. No corregir totales históricos para ajustar expectativas.
- Todos los mensajes/notificaciones descritos en esta guía son **notificaciones dentro de VIPER**; no hay confirmación de notificaciones push con la app cerrada ni de funcionamiento offline.

## Instalación — dos procedimientos diferentes

**Android / Chrome**: abrir el URL → menú **⋮** → **Instalar aplicación** o **Agregar a pantalla de inicio** (el texto varía por dispositivo) → instalar/agregar → abrir VIPER desde el nuevo icono. Comprobar nombre, icono y que abra sin barra de dirección cuando el navegador lo admita. Si solo se agrega un acceso directo, anotarlo en el resultado.

**iPhone / Safari**: abrir el URL en Safari → menú de página/Compartir → **Agregar a pantalla de inicio** → activar **Abrir como app** si está disponible → **Agregar** → abrir VIPER desde el nuevo icono. No esperar un mensaje de instalación automática tipo Android; iOS no admite `beforeinstallprompt`.

En ambos casos, si el icono no aparece o no se abre, documentar navegador y versión; no recurrir a una descarga APK/IPA de fuentes desconocidas.

## Casos de prueba obligatorios

| ID | Área | Pasos de reproducción | Resultado esperado | Android | iPhone |
| --- | --- | --- | --- | --- | --- |
| M01 | Instalación | Seguir los pasos de instalación y abrir desde el icono | Nombre/icono VIPER, app abre en el dominio correcto; sin pantalla vacía | ☐ | ☐ |
| M02 | Sesión | Iniciar sesión con Google desde la app instalada; cerrarla y volverla a abrir | Regresa a VIPER, sesión disponible; no termina atrapado en Safari/Chrome ni localhost | ☐ | ☐ |
| M03 | Recuperación | En cuenta de prueba, solicitar recuperación, abrir correo, cambiar clave | Vuelve al dominio correcto; formulario recupera contraseña; no entra al panel durante recuperación | ☐ | ☐ |
| M04 | Interfaz | Recorrer Inicio, Mi día, Comunidad, Progreso, Perfil y Amigos | Menús visibles, botones tocables, sin recortes por notch ni barra inferior | ☐ | ☐ |
| M05 | Cámara y permisos | Abrir foto de comida; permitir cámara, cancelar, repetir; después denegar permiso | Vista previa visible y cierre libera cámara; denegación informa el error sin otorgar XP | ☐ | ☐ |
| M06 | Foto comida | Tomar foto real desde cámara de cuenta de prueba; comprobar aprobada/rechazada | Aprobada: +10 XP por comida; rechazada: 0; tras recargar mantiene estado | ☐ | ☐ |
| M07 | Batido | Capturar batido y validar; intentar guardar una segunda vez el mismo día | +15 XP una vez si aprobado; no duplica premios; rechazado: 0 | ☐ | ☐ |
| M08 | Gimnasio | Capturar foto en tiempo real, guardar día, tocar Guardar rápidamente dos veces | Un check-in diario; fórmula de gimnasio + racha; sin duplicación ni fotos huérfanas | ☐ | ☐ |
| M09 | Persistencia | Anotar XP, cerrar app, reabrir y recargar | Fotos/comidas/checkins/XP coinciden; no se incrementa al refrescar | ☐ | ☐ |
| M10 | Chat | Dos cuentas aceptadas: enviar/recibir texto e imagen | Mensajes visibles solo por miembros, se conservan tras reabrir, lectura coherente | ☐ | ☐ |
| M11 | Conexión | Cambiar de Wi‑Fi a datos; abrir app sin conexión; reconectar | Sin datos de terceros expuestos ni guardados ficticios; funciones online avisan de fallo | ☐ | ☐ |
| M12 | Interrupción | Empezar captura, enviar app a segundo plano, volver y cerrar cámara | Sin cámara activa permanente ni pantalla bloqueada; se puede reintentar | ☐ | ☐ |
| M13 | Rankings | Ver perfil y ranking de cuenta de prueba tras registro de XP | Total y posición coherentes con check-ins, sin cambios al refrescar | ☐ | ☐ |
| M14 | Privacidad | En dos cuentas, intentar abrir chats/perfiles ajenos no autorizados | Sin acceso a mensajes, fotos ni comidas privadas de terceros | ☐ | ☐ |
| M15 | Notificaciones | Probar aviso de amistad/chat/actividad y cerrar por completo la app | Eventos visibles en el buzón al reabrir; no suponer push en segundo plano | ☐ | ☐ |
| M16 | Diseño | Probar pantalla pequeña, teclado abierto, modo oscuro y tamaño de texto grande | Campos y botones accesibles; ningún diálogo queda imposible de cerrar | ☐ | ☐ |

Para cada caso rellenar **☐ Pendiente / ✅ Aprobado / ❌ Falló / ⏭ No aplica**, registrar evidencia anonimizada y versión probada.

## Criterios de aceptación para beta PWA

- **Bloqueantes:** imposibilidad de iniciar sesión/volver desde Google; pérdida de comidas, mensajes o XP tras recargar; acceso entre usuarios; puntos duplicados; fallos permanentes de cámara; pantalla en blanco; navegación móvil inutilizable.
- **No bloqueantes para beta web, sí pendientes:** notificaciones push cuando VIPER está cerrada; modo offline completo; tienda nativa y deep links; vídeos en chat; variaciones de instalación por navegador.
- **No prometer publicación en tiendas** solo por superar esta matriz. La PWA instalada y las apps compiladas con Capacitor requieren validaciones distintas.

## Preparación para compilaciones nativas (trabajo separado)

El proyecto tiene `capacitor.config.ts` (`appId: com.viper.fitness`, `webDir: www`) y scripts para sincronizar. **Esto no demuestra que existan proyectos Android/iOS compilados** ni que OAuth funcione en un WebView nativo.

- Base: Node 22+, `npm install`, `npm run prepare:web` (genera `www`). Ejecutar `npx cap doctor` antes de compilar.
- Android: Android Studio 2025.2.1+ con SDK instalado. Crear proyecto nativo una vez con `npx cap add android` si no existe; luego `npm run cap:android`; revisar permisos de cámara, Google OAuth/deep links y regreso de correo. **No publicar APK/AAB sin pasar pruebas en dispositivo**.
- iPhone nativo: macOS con Xcode 26+ y herramientas de línea de comandos; `npx cap add ios` solo si no existe; luego `npm run cap:ios`. Revisar texto de privacidad de cámara (Info.plist), WebView, entrada desde enlaces de recuperación y deep links.
- El código web usa `redirectTo: location.origin + location.pathname + location.search`. Este comportamiento se validó para el dominio web, **no valida por sí mismo el callback de OAuth de apps nativas**. Configurar y probar un esquema/Universal Link apropiado antes de empaquetar una versión nativa.

## Hechos comprobados y límites

- Ya están presentes manifiesto, iconos 180/192/512, service worker, diseño móvil y captura con `getUserMedia`.
- El service worker actual **no guarda datos ni hace la aplicación offline**.
- No hay verificación física en Android/iPhone por parte de esta auditoría automatizada.
- La última revisión del Supabase asociado a `yebhrojlziirrwrwhmzq` no encontró cargas nuevas recientes, aunque el usuario validó persistencia en pantalla. Verificar que la app instalada conecte al **mismo proyecto** antes de dar por cerrada la reconciliación de archivos/XP.
- Cada despliegue deberá ejecutar `npm test` y revisar el estado Vercel antes de considerarse publicado.

Fuentes de requisitos: https://support.google.com/chrome/answer/9658361 ; https://support.apple.com/guide/iphone/iphea86e5236/ios ; https://capacitorjs.com/docs/getting-started/environment-setup ; https://supabase.com/docs/guides/auth/native-mobile-deep-linking .
