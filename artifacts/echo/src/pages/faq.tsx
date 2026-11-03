import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { PublicFooter, PublicHeader } from './landing';
import './public-surface.css';

const items = [
  {
    question: '¿Qué es ECHO?',
    answer: 'ECHO es una red social privada de personajes. Puedes crear un universo propio, definir perfiles y explorar su actividad sin convertirlo en una publicación abierta para todo el mundo.',
  },
  {
    question: '¿ECHO es gratis?',
    answer: 'Free está disponible sin cobros activos. El plan ofrece texto e imágenes con límites diarios; no publicamos números específicos de esos límites.',
  },
  {
    question: '¿Qué significa Creator beta?',
    answer: 'Creator es una selección beta preparada en el onboarding. No tiene cobros activos, checkout ni cuotas o capacidades específicas anunciadas.',
  },
  {
    question: '¿Qué puedo crear durante la beta?',
    answer: 'La experiencia inicial contempla texto e imágenes. Voz, video y música están fuera de beta y no están disponibles por ahora.',
  },
  {
    question: '¿Qué pasa durante el onboarding?',
    answer: 'Después de crear o iniciar sesión en tu cuenta, eliges Free o Creator, das nombre a tu universo y creas el perfil inicial con nombre visible, usuario y biografía.',
  },
  {
    question: '¿Puedo cambiar la información de mi personaje después?',
    answer: 'Sí. El onboarding crea una identidad inicial y después puedes seguir editando sus datos desde los controles de cuenta de ECHO.',
  },
  {
    question: '¿Necesito una cuenta?',
    answer: 'Sí. Tu espacio se asocia a una cuenta para que sea privado. Puedes crearla desde el registro o volver a entrar desde la pantalla de inicio de sesión.',
  },
];

export default function FaqPage() {
  return (
    <main className="echo-public">
      <div className="ep-wrap">
        <PublicHeader />
        <section className="ep-page-intro">
          <span className="ep-eyebrow">Preguntas claras</span>
          <h1 className="ep-serif">Antes de<br /><em style={{ color: 'var(--ep-rose)' }}>empezar.</em></h1>
          <p>Lo esencial sobre privacidad, planes y qué está realmente disponible en la beta.</p>
        </section>
        <section className="ep-faq-wrap" aria-label="Preguntas frecuentes">
          {items.map((item, index) => (
            <details className="ep-faq-item" key={item.question} open={index === 0}>
              <summary data-testid={`faq-question-${index + 1}`}>{item.question}</summary>
              <p data-testid={`faq-answer-${index + 1}`}>{item.answer}</p>
            </details>
          ))}
          <div className="ep-faq-cta">
            <div><h3>¿Listo para abrir tu espacio?</h3><p>Elige tu plan durante el onboarding. No hay cobros activos.</p></div>
            <Link href="/sign-up" className="ep-button" data-testid="link-faq-signup">Crear una cuenta <ArrowRight size={15} /></Link>
          </div>
        </section>
        <PublicFooter />
      </div>
    </main>
  );
}
