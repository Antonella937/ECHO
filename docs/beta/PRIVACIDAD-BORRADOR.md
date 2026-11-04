# ECHO — Aviso de privacidad para beta privada (BORRADOR)

Estado: borrador técnico, NO política de privacidad publicada ni consentimiento válido. Requiere verificación de infraestructura y revisión antes de habilitar a terceras personas.

Responsable del proyecto: Antonella Páez
Contacto: echoverse.support.n@gmail.com

## Finalidad
Operar una prueba cerrada de ECHO para registro, inicio de sesión, creación de universos y personajes, publicaciones, fotografías e historias; mantener seguridad y atender incidencias.

## Datos involucrados
Según los flujos implementados, pueden tratarse identificadores de cuenta y datos de autenticación, información de perfiles y personajes, textos de publicaciones, imágenes e historias subidas por cada participante, metadatos técnicos y registros de aceptación. No subir datos sensibles ni información de terceros sin autorización.

## Proveedores que deben verificarse
- Clerk: autenticación y cuentas.
- Neon/PostgreSQL: persistencia de información de la aplicación y consentimientos.
- Supabase: almacenamiento de archivos cuando está configurado.
- Render: alojamiento del servidor API.
- Cloudflare Pages: alojamiento del sitio.
Las condiciones, ubicaciones de tratamiento, períodos de conservación y eventuales subencargados de cada proveedor deben comprobarse antes de publicar este aviso.

## Visibilidad
El código del servidor restringe por propietario los universos y medios privados; la compartición externa está deshabilitada en la fase alfa actual. Ninguna prueba debe prometer confidencialidad absoluta o ausencia de errores.

## Conservación, derechos y eliminación
Pendiente confirmar la retención efectiva de cuentas, archivos, respaldos y logs; verificar procedimientos de acceso, rectificación y eliminación. Las solicitudes se recibirán en echoverse.support.n@gmail.com. No publicar plazos o promesas de borrado sin implementación verificable.

## Funciones de IA
La ejecución de IA y autonomía está bloqueada por la configuración de seguridad actual. Si se habilita en el futuro, este aviso deberá actualizarse antes de procesar contenido con nuevos proveedores.

## Pendientes obligatorios
1. Validar categorías de datos y tratamientos efectivos de todos los proveedores.
2. Definir bases legales, transferencias internacionales, retención y derechos según legislación aplicable.
3. Implementar y probar eliminación/solicitudes de datos.
4. Publicar una versión aprobada, accesible desde el registro, y registrar su aceptación de forma diferenciada del borrador alfa.
