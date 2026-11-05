import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { Crown, Gift, Heart, Sparkles, X } from 'lucide-react';

const FOUNDER_EMAIL = 'laprincesaalanis2013@gmail.com';

export function FounderSurprise() {
  const { isLoaded, isSignedIn, user } = useUser();
  const [stage, setStage] = useState(0);
  const [open, setOpen] = useState(false);
  const userId = user?.id;
  const eligible = Boolean(isLoaded && isSignedIn && user?.emailAddresses.some(
    address => address.emailAddress.toLowerCase() === FOUNDER_EMAIL && address.verification?.status === 'verified',
  ));
  const storageKey = userId ? `echo-founder-surprise-seen:${userId}` : '';

  useEffect(() => {
    if (!eligible || !storageKey) return;
    try {
      if (!localStorage.getItem(storageKey)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [eligible, storageKey]);

  if (!eligible) return null;

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(storageKey, '1'); } catch { /* Storage may be disabled. */ }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setStage(0); setOpen(true); }}
        aria-label="Volver a ver tu regalo de fundadora"
        title="Tu regalo de ECHO"
        className="fixed bottom-[calc(var(--nav-clearance)+1.5rem)] right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-[#79536d] bg-[#271b2a] text-[#f0c7dc] shadow-xl lg:bottom-5"
        data-testid="button-founder-reopen"
      ><span className="font-serif text-2xl italic">A</span></button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/85 px-4 py-6 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Un mensaje para Ala" data-testid="dialog-founder-surprise">
          <div className="relative my-auto w-full max-w-[430px] rounded-[28px] border border-[#60445b] bg-[#151019] px-6 py-9 text-center text-[#f6edf3] shadow-2xl">
            <button type="button" onClick={close} aria-label="Cerrar" className="absolute right-4 top-4 rounded-full p-2 text-[#c8b8c6]"><X size={20}/></button>
            <div className="mb-6 text-[10px] font-semibold uppercase tracking-[.26em] text-[#d4a6c4]">ECHO · FOUNDING MEMBER 001</div>
            {stage === 0 ? (
              <div className="space-y-6">
                <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-[#8c5c7b] bg-[#302031] font-serif text-6xl italic text-[#edc0d8]">A</div>
                <h2 className="font-display text-2xl">Something is waiting for you.</h2>
                <p className="text-sm leading-7 text-[#d0c1cd]">Un mensaje especial de la creadora de ECHO, solo para vos.</p>
                <button type="button" onClick={() => setStage(1)} className="w-full rounded-2xl bg-[#e6b3cd] px-5 py-3 font-semibold text-[#231621]">Abrir mensaje ♡</button>
              </div>
            ) : stage === 1 ? (
              <div className="space-y-5">
                <Heart className="mx-auto text-[#e6b3cd]" size={30}/>
                <h2 className="font-display text-2xl">Para Ala,</h2>
                <p className="text-sm leading-7 text-[#e1d5df]">Gracias por ser la primera persona en darle una oportunidad a ECHO.</p>
                <p className="text-sm leading-7 text-[#e1d5df]">Por crear personajes, explorar cada rincón, encontrar errores y divertirte con algo que todavía está creciendo.</p>
                <p className="text-sm leading-7 text-[#e1d5df]">Quiero que sepas que, pase lo que pase con este proyecto, siempre vas a tener un lugar especial acá.</p>
                <p className="py-2 font-serif text-5xl italic text-[#e8b6d3]">Nela.</p>
                <button type="button" onClick={() => setStage(2)} className="w-full rounded-2xl bg-[#e6b3cd] px-5 py-3 font-semibold text-[#231621]">Descubrir tu regalo 🎁</button>
              </div>
            ) : (
              <div className="space-y-5">
                <Crown className="mx-auto text-[#e6b3cd]" size={38}/>
                <div className="text-xs uppercase tracking-[.2em] text-[#d4a6c4]">Founding Member · 001</div>
                <h2 className="font-display text-3xl">ECHO FULL</h2>
                <div className="font-semibold tracking-[.15em] text-[#e6b3cd]">LIFETIME ACCESS</div>
                <p className="text-sm leading-7 text-[#e1d5df]">Por haber estado acá desde el principio, tenés reservado un lugar especial: acceso Full de cortesía de por vida, incluyendo futuras funciones premium cuando estén disponibles.</p>
                <div className="rounded-2xl border border-[#503b4d] bg-[#261c2a] p-4 text-left text-sm leading-8 text-[#ead9e5]">
                  <p>♡ Funciones premium incluidas</p>
                  <p>♡ Futuras actualizaciones</p>
                  <p>♡ Sin suscripción para vos</p>
                  <p>♡ Reconocimiento permanente</p>
                </div>
                <p className="font-serif italic text-[#e8b6d3]">You were here first. ♡</p>
                <button type="button" onClick={close} className="w-full rounded-2xl bg-[#e6b3cd] px-5 py-3 font-semibold text-[#231621]">Entrar a ECHO <Sparkles className="ml-1 inline h-4 w-4"/></button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
