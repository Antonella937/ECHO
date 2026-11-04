import { Link } from 'wouter';

/** Informational preview only. This is not a substitute for verified legal terms or consent. */
export default function BetaInformationPage() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10">
      <article className="w-full max-w-[680px] space-y-5 text-foreground">
        <Link href="/" className="wordmark text-2xl">ECHO</Link>
        <p className="text-sm text-muted-foreground">Información preliminar · beta privada</p>
        <h1 className="text-3xl font-semibold">Antes de probar ECHO</h1>
        <p>ECHO está en desarrollo. La prueba está limitada a un máximo de tres cuentas adultas. Puede haber errores, cambios y pérdida de disponibilidad.</p>
        <h2 className="text-xl font-semibold">Qué se puede probar</h2>
        <p>Crear universos y personajes propios, explorar perfiles y probar publicaciones, fotografías e historias. La inteligencia artificial, la autonomía y el intercambio entre cuentas están deshabilitados.</p>
        <h2 className="text-xl font-semibold">Datos y privacidad</h2>
        <p>La aplicación procesa datos de acceso, personajes, textos, imágenes y registros técnicos. Utiliza Clerk para autenticación, Neon para la base de datos, Supabase para imágenes, Render para la API y Cloudflare para alojar la web.</p>
        <p>El contenido está diseñado para quedar separado por cuenta, pero el funcionamiento completo de esa separación todavía debe verificarse con distintas cuentas. No subas datos sensibles, información de pacientes ni imágenes de otras personas sin permiso.</p>
        <h2 className="text-xl font-semibold">Consultas y solicitudes</h2>
        <p>Para pedir información, correcciones o eliminación de datos, escribí a <a className="underline" href="mailto:echoverse.support.n@gmail.com">echoverse.support.n@gmail.com</a>. La eliminación integral y los plazos de conservación aún deben verificarse; no se garantiza borrado inmediato.</p>
        <p className="rounded-lg border p-4 text-sm"><strong>Importante:</strong> este texto es informativo y preliminar. Las condiciones y la política de privacidad definitivas aún no están publicadas. Leer esta página no constituye consentimiento ni habilita la beta externa.</p>
        <Link href="/sign-up" className="inline-block underline">Volver al registro</Link>
      </article>
    </main>
  );
}
