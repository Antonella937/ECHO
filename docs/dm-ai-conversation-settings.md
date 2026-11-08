# ECHO — Configuración de conversación IA por DM

Estado: especificación para implementación; **no habilita la función por sí sola**.

## Experiencia
Desde el menú de tres puntos de cada DM, abrir «Configuración de IA» (localizada al idioma de la interfaz).

Opciones por usuario y conversación:
- `style`: `natural` (predeterminado), `narrative`, `mixed`.
- `responseTiming`: `realistic` (predeterminado), `instant`.
- `responseLength`: `short`, `balanced` (predeterminado), `detailed`.
- `autonomousInitiative`: booleano; conservar la preferencia existente si está definida.

## Semántica
- Natural: mensajes estilo red social, sin acciones narradas por defecto.
- Narrativo: interpretar acciones entre asteriscos y continuar escenas con acciones y diálogo, sin controlar acciones del usuario.
- Mixto: conservar conversación natural y narrar cuando el usuario inicia una escena.
- Inmediato: iniciar generación al recibir mensaje; mostrar indicador de escritura y enviar apenas termine, sin retardo artificial.
- Realista: respetar las reglas existentes de horarios y disponibilidad, con límites de espera razonables.
- La iniciativa autónoma controla **mensajes iniciados por IA**, no las respuestas a mensajes del usuario. No debe desactivar likes, comentarios o posts de otros módulos si esos permisos son independientes.

## Backend y datos
- Preferencias persistidas en Neon por `user_id` y `conversation_id`, con aislamiento de usuarios y validación de pertenencia a conversación.
- Aplicar defaults a chats existentes sin migración destructiva.
- API autenticada GET/PATCH para consultar y guardar solo campos permitidos.
- Incluir las preferencias en la construcción del prompt, preservando personalidad, memoria, relaciones, idioma y políticas.
- Mantener separadas las colas de respuesta solicitada y mensajes espontáneos; deduplicar por ID de mensaje/evento y evitar carreras.
- Para grupos, especificar y probar comportamiento por participante IA antes de activar.

## QA
1. Ala configura Mateo como narrativo/inmediato y escribe `*lo abrazo*`: recibe continuación narrativa sin demora intencional.
2. Nela configura Hyunjin como natural/realista: responde con reglas de disponibilidad.
3. Cambiar estilo no borra recuerdos ni modifica personalidad.
4. Ajustes de Ala no afectan los de Nela; ajustes de Mateo no afectan Hyunjin.
5. La iniciativa autónoma sigue funcionando y no duplica respuestas.
6. Las preferencias persisten al recargar y entre dispositivos.
7. Los textos están traducidos según idioma de interfaz.
8. Verificar audio, notificaciones y permisos existentes sin regresiones.

## Entrega
Implementar en una rama de pruebas, correr typecheck y pruebas, abrir PR a `main` y desplegar solo tras revisión. No tocar producción ni hacer merge automático.
