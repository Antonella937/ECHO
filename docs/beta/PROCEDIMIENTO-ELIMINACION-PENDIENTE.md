# ECHO — Procedimiento de eliminación y verificación (pendiente de implementación)

Estado: especificación de ingeniería, NO evidencia de borrado completo ni autorización para abrir la beta.

## Situación comprobada en código
- `PUT /creator/universes/:universeId/management` con acción `delete` marca el universo como eliminado, vacía su estado y limpia determinadas tablas auxiliares.
- `manageUniverse` indica explícitamente que NO elimina archivos externos ni datos generales del propietario.
- Los archivos se registran en `echoMediaTable` con `ownerId` y `objectPath`.
- En producción, cuando hay credenciales de Supabase, el almacenamiento usa el bucket privado `echo-media`. Clerk gestiona identidades. No hay prueba de eliminación integral de cuenta, respaldos o logs.

## Requisitos de implementación antes de prometer eliminación integral
1. Diseñar una solicitud autenticada de eliminación de cuenta, con confirmación explícita y protección contra reintentos y CSRF.
2. Enumerar únicamente los objetos cuyo `ownerId` sea el solicitante; borrar físicamente esos objetos en el proveedor activo; registrar resultados y fallos sin exponer credenciales.
3. Eliminar o anonimizar datos de ese propietario en todas las tablas relacionadas, respetando claves foráneas, dependencias, transacciones y posibles referencias cruzadas. No tocar datos de otros propietarios.
4. Coordinar la eliminación de identidad en Clerk mediante un flujo autorizado. Determinar qué ocurre con una plaza de beta al eliminar la cuenta.
5. Definir tratamiento de logs, copias de seguridad y plazos reales de retención con Render, Neon, Supabase, Clerk y Cloudflare.
6. Ante fallos parciales, conservar estado auditable para reintento; no informar éxito hasta verificar cada sistema.
7. Implementar pruebas automatizadas de aislamiento (A y B), archivos huérfanos, reintentos, fallos de proveedor y restauración de copias.
8. Revisar política de privacidad, términos y aceptación versionada antes de acceso externo.

## Medida provisional
Solicitudes de acceso, rectificación y eliminación se reciben en echoverse.support.n@gmail.com para gestión manual. No prometer borrado automático o inmediato. No habilitar acceso externo por el solo hecho de crear este documento.

Responsable del proyecto: Antonella Páez.
