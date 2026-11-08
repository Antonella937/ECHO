# ECHO Scenes — escenas narrativas y conversaciones paralelas

Estado: especificación, no implementación. Rama de pruebas `feature/dm-ai-conversation-settings`.

## Escenarios
- Crear escena a partir de un mensaje de DM o desde el menú de escenas, con título, premisa, personajes, estilo y elección de canon principal o universo alternativo.
- Cada escena mantiene un registro de eventos y memoria temporal separados del historial privado.
- Permitir continuar, pausar y finalizar escenas; al finalizar, seleccionar recuerdos pertinentes para la memoria duradera sin importar todo el transcript.
- No permitir que un personaje conozca acontecimientos privados a los que no tuvo acceso.

## DMs simultáneos dentro de una escena
- Una persona puede abrir su DM existente con Mar mientras Nela, Mar, Dante y Noah participan de la escena.
- El DM privado sigue siendo privado: Dante y Noah no ven el contenido ni reciben su resumen.
- Mar recibe, además de su contexto privado, una **vista autorizada** de los eventos públicos recientes de la escena para comprender «te escribo por debajo de la mesa».
- Los mensajes privados se guardan en el DM original con metadatos opcionales `scene_id` y `scene_event_id`; no se copian al chat grupal.
- Mostrar una etiqueta discreta «Vinculado a: Una noche en The Hollow» y acción para desvincular/volver a la escena. No obligar al usuario a crear un segundo DM.
- Al salir o cerrar la escena, el DM continúa funcionando normalmente sin esperar a resumir todo el grupo. La memoria privada conserva sus mensajes; el contexto temporal de la escena deja de inyectarse.
- Si Mar responde o actúa públicamente en la escena, solo puede utilizar información privada de forma deliberada y coherente con su personalidad y las reglas de privacidad: no filtrar el texto del DM a otros personajes de forma implícita.
- La autonomía y los mensajes espontáneos deben respetar visibilidad, simultaneidad y la elección de canon.

## Modelo de visibilidad y tiempo
- Eventos con `scene_id`, `actor_id`, `timestamp`, `visibility` (public/participants/private), `audience_ids` y orden estable.
- Contexto generado **por personaje y por conversación**: solo eventos visibles para ese personaje. No inyectar la transcripción íntegra de todos los chats.
- Los mensajes del DM pueden tener referencia a escena activa, pero los mensajes privados no se vuelven públicos por esa referencia.
- Evitar inconsistencias con una cola de eventos por escena y procesamiento idempotente; si se solapan respuestas de Mar en escena y DM, mantener orden lógico y no bloquear innecesariamente la respuesta privada.
- Mantener el canon principal aislado de universos alternativos. Los recuerdos promovidos incluyen procedencia y quién los presenció.

## Pruebas
1. En una escena con Nela, Mar, Dante y Noah, Nela escribe por DM a Mar «me está mirando Dante»: Mar entiende el contexto y responde privadamente.
2. Dante no puede conocer el contenido del DM, ni en respuesta ni por memoria futura.
3. Mar puede seguir respondiendo públicamente sin copiar el DM.
4. Nela sale de la escena y vuelve a su DM con Mar: no hay arrastre del prompt grupal ni demora por resumen.
5. Reabrir la escena restaura sus eventos públicos y las referencias a mensajes privados sin exponerlos.
6. Cambiar a universo alternativo no altera recuerdos canónicos.
7. Comprobar permisos entre cuentas reales, persistencia, notificaciones, localización y ausencia de respuestas duplicadas.
