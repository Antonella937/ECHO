import { uploadPrivateFile, useMediaResolver } from '@/lib/media';
import { SceneCanonReview } from '@/components/echo/scene-canon-review';
import { FormattingToolbar } from '@/components/echo/formatting-toolbar';
import { SocialText } from '@/components/echo/social-text';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';
import { useLanguage } from '@/lib/i18n';
import { Link } from 'wouter';

const sceneLabels: Record<string, Record<string,string>> = {"en":{"Volver a mensajes":"Back to messages","Crear nueva escena":"Create new scene","Crear escena":"Create scene","Mis escenas":"My scenes","Participantes":"Participants","Turnos y estado":"Turns and status","Autonomía de respuesta":"Reply autonomy","Automático":"Automatic","Manual":"Manual","Por orden":"Ordered","Elegir personaje":"Choose character","Presencia narrativa":"Narrative presence","Presente":"Present","Ausente":"Absent","Se retiró":"Left","Pausar":"Pause","Reanudar":"Resume","Finalizar":"Finish","Eliminar escena definitivamente":"Delete scene permanently","Continuar escena":"Continue scene","Enviar":"Send","Crear":"Create","Título":"Title","Premisa":"Premise","Canon principal":"Main canon","Universo alternativo":"Alternate universe","Elegir próximo turno":"Choose next turn","Escribí en la escena…":"Write in scene…","Estilo de escritura de IA":"AI writing style","Natural / Conversacional":"Natural / Conversational","Cinematográfico":"Cinematic","Literario / Descriptivo":"Literary / Descriptive","Breve / Directo":"Concise / Direct"},"pt":{"Volver a mensajes":"Voltar às mensagens","Crear nueva escena":"Criar nova cena","Crear escena":"Criar cena","Mis escenas":"Minhas cenas","Participantes":"Participantes","Turnos y estado":"Turnos e estado","Autonomía de respuesta":"Respostas automáticas","Automático":"Automático","Manual":"Manual","Por orden":"Em ordem","Elegir personaje":"Escolher personagem","Presencia narrativa":"Presença narrativa","Presente":"Presente","Ausente":"Ausente","Se retiró":"Saiu","Pausar":"Pausar","Reanudar":"Retomar","Finalizar":"Finalizar","Eliminar escena definitivamente":"Excluir cena definitivamente","Continuar escena":"Continuar cena","Enviar":"Enviar","Crear":"Criar","Título":"Título","Premisa":"Premissa","Canon principal":"Cânone principal","Universo alternativo":"Universo alternativo","Elegir próximo turno":"Escolher próximo turno","Escribí en la escena…":"Escreva na cena…","Estilo de escritura de IA":"Estilo de escrita da IA","Natural / Conversacional":"Natural / Conversacional","Cinematográfico":"Cinematográfico","Literario / Descriptivo":"Literário / Descritivo","Breve / Directo":"Breve / Direto"},"fr":{"Volver a mensajes":"Retour aux messages","Crear nueva escena":"Créer une scène","Crear escena":"Créer une scène","Mis escenas":"Mes scènes","Participantes":"Participants","Turnos y estado":"Tours et état","Autonomía de respuesta":"Réponses automatiques","Automático":"Automatique","Manual":"Manuel","Por orden":"Dans l’ordre","Elegir personaje":"Choisir un personnage","Presencia narrativa":"Présence narrative","Presente":"Présent","Ausente":"Absent","Se retiró":"Parti","Pausar":"Pause","Reanudar":"Reprendre","Finalizar":"Terminer","Eliminar escena definitivamente":"Supprimer définitivement la scène","Continuar escena":"Continuer la scène","Enviar":"Envoyer","Crear":"Créer","Título":"Titre","Premisa":"Prémisse","Canon principal":"Canon principal","Universo alternativo":"Univers alternatif","Elegir próximo turno":"Choisir le prochain tour","Escribí en la escena…":"Écrire dans la scène…","Estilo de escritura de IA":"Style d’écriture de l’IA","Natural / Conversacional":"Naturel / Conversationnel","Cinematográfico":"Cinématographique","Literario / Descriptivo":"Littéraire / Descriptif","Breve / Directo":"Bref / Direct"},"de":{"Volver a mensajes":"Zurück zu Nachrichten","Crear nueva escena":"Neue Szene erstellen","Crear escena":"Szene erstellen","Mis escenas":"Meine Szenen","Participantes":"Teilnehmende","Turnos y estado":"Runden und Status","Autonomía de respuesta":"Automatische Antworten","Automático":"Automatisch","Manual":"Manuell","Por orden":"Der Reihe nach","Elegir personaje":"Figur wählen","Presencia narrativa":"Erzählerische Präsenz","Presente":"Anwesend","Ausente":"Abwesend","Se retiró":"Verlassen","Pausar":"Pausieren","Reanudar":"Fortsetzen","Finalizar":"Beenden","Eliminar escena definitivamente":"Szene endgültig löschen","Continuar escena":"Szene fortsetzen","Enviar":"Senden","Crear":"Erstellen","Título":"Titel","Premisa":"Prämisse","Canon principal":"Hauptkanon","Universo alternativo":"Alternatives Universum","Elegir próximo turno":"Nächsten Zug wählen","Escribí en la escena…":"In Szene schreiben…","Estilo de escritura de IA":"KI-Schreibstil","Natural / Conversacional":"Natürlich / Gesprächig","Cinematográfico":"Filmisch","Literario / Descriptivo":"Literarisch / Beschreibend","Breve / Directo":"Kurz / Direkt"},"it":{"Volver a mensajes":"Torna ai messaggi","Crear nueva escena":"Crea una scena","Crear escena":"Crea scena","Mis escenas":"Le mie scene","Participantes":"Partecipanti","Turnos y estado":"Turni e stato","Autonomía de respuesta":"Risposte automatiche","Automático":"Automatico","Manual":"Manuale","Por orden":"In ordine","Elegir personaje":"Scegli personaggio","Presencia narrativa":"Presenza narrativa","Presente":"Presente","Ausente":"Assente","Se retiró":"Uscito","Pausar":"Pausa","Reanudar":"Riprendi","Finalizar":"Termina","Eliminar escena definitivamente":"Elimina definitivamente la scena","Continuar escena":"Continua scena","Enviar":"Invia","Crear":"Crea","Título":"Titolo","Premisa":"Premessa","Canon principal":"Canone principale","Universo alternativo":"Universo alternativo","Elegir próximo turno":"Scegli prossimo turno","Escribí en la escena…":"Scrivi nella scena…","Estilo de escritura de IA":"Stile di scrittura IA","Natural / Conversacional":"Naturale / Conversazionale","Cinematográfico":"Cinematografico","Literario / Descriptivo":"Letterario / Descrittivo","Breve / Directo":"Breve / Diretto"},"ko":{"Volver a mensajes":"메시지로 돌아가기","Crear nueva escena":"새 장면 만들기","Crear escena":"장면 만들기","Mis escenas":"내 장면","Participantes":"참가자","Turnos y estado":"차례와 상태","Autonomía de respuesta":"자동 응답","Automático":"자동","Manual":"수동","Por orden":"순서대로","Elegir personaje":"캐릭터 선택","Presencia narrativa":"장면 참여 상태","Presente":"참석","Ausente":"부재","Se retiró":"퇴장","Pausar":"일시정지","Reanudar":"재개","Finalizar":"종료","Eliminar escena definitivamente":"장면 영구 삭제","Continuar escena":"장면 계속","Enviar":"보내기","Crear":"만들기","Título":"제목","Premisa":"전제","Canon principal":"메인 설정","Universo alternativo":"대체 세계관","Elegir próximo turno":"다음 차례 선택","Escribí en la escena…":"장면에 입력…","Estilo de escritura de IA":"AI 글쓰기 스타일","Natural / Conversacional":"자연스러움 / 대화체","Cinematográfico":"영화적","Literario / Descriptivo":"문학적 / 묘사적","Breve / Directo":"간결 / 직접적"},"ja":{"Volver a mensajes":"メッセージに戻る","Crear nueva escena":"新しいシーンを作成","Crear escena":"シーンを作成","Mis escenas":"マイシーン","Participantes":"参加者","Turnos y estado":"ターンと状態","Autonomía de respuesta":"自動返信","Automático":"自動","Manual":"手動","Por orden":"順番に","Elegir personaje":"キャラクターを選択","Presencia narrativa":"シーン内の参加状況","Presente":"参加中","Ausente":"不在","Se retiró":"退出済み","Pausar":"一時停止","Reanudar":"再開","Finalizar":"終了","Eliminar escena definitivamente":"シーンを完全に削除","Continuar escena":"シーンを続ける","Enviar":"送信","Crear":"作成","Título":"タイトル","Premisa":"前提","Canon principal":"メイン設定","Universo alternativo":"別の世界線","Elegir próximo turno":"次のターンを選択","Escribí en la escena…":"シーンに入力…","Estilo de escritura de IA":"AIの文体","Natural / Conversacional":"自然 / 会話調","Cinematográfico":"映画的","Literario / Descriptivo":"文学的 / 描写的","Breve / Directo":"簡潔 / 直接的"},"zh":{"Volver a mensajes":"返回消息","Crear nueva escena":"创建新场景","Crear escena":"创建场景","Mis escenas":"我的场景","Participantes":"参与者","Turnos y estado":"轮次与状态","Autonomía de respuesta":"自动回复","Automático":"自动","Manual":"手动","Por orden":"按顺序","Elegir personaje":"选择角色","Presencia narrativa":"场景参与状态","Presente":"在场","Ausente":"缺席","Se retiró":"已离开","Pausar":"暂停","Reanudar":"继续","Finalizar":"结束","Eliminar escena definitivamente":"永久删除场景","Continuar escena":"继续场景","Enviar":"发送","Crear":"创建","Título":"标题","Premisa":"前提","Canon principal":"主线设定","Universo alternativo":"平行宇宙","Elegir próximo turno":"选择下一轮","Escribí en la escena…":"在场景中输入…","Estilo de escritura de IA":"AI写作风格","Natural / Conversacional":"自然 / 对话式","Cinematográfico":"电影风格","Literario / Descriptivo":"文学 / 描写式","Breve / Directo":"简洁 / 直接"}};
type Scene = { sceneId: string; title: string; premise: string; canon: 'main'|'alternate'; participantIds: string[]; status: string; turnSettings?: { mode: 'automatic'|'manual'|'ordered'; order: string[]; nextCharacterId: string|null; cursor: number; style?: 'natural'|'cinematic'|'literary'|'concise'; autoReply?: boolean } };
type SceneEvent = { eventId: string; actorId: string; text: string; visibility: string; createdAt: string };
export default function ScenesPage() {
  const { user } = useUser();
  const { state, me } = useSocial();
  const lang = useLanguage();
  const es = lang === 'es';
  const st = (label:string) => es ? label : (sceneLabels[lang]?.[label] ?? sceneLabels.en[label] ?? label);
  const universeId = user?.id ? getActiveUniverseId(user.id) : 'primary';
  const [scenes,setScenes] = useState<Scene[]>([]);
  const [selected,setSelected] = useState<string|null>(null);
  const [events,setEvents] = useState<SceneEvent[]>([]);
  const [presence,setPresence] = useState<Record<string,'present'|'absent'|'left'>>({});
  const [title,setTitle] = useState('');
  const [premise,setPremise] = useState('');
  const [createMode,setCreateMode] = useState<'automatic'|'manual'>('manual');
  const [canon,setCanon] = useState<'main'|'alternate'>('main');
  const [participants,setParticipants] = useState<string[]>([]);
  const [message,setMessage] = useState('');
  const sceneMessageRef = useRef<HTMLTextAreaElement>(null);
  const sceneEventsScrollRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{if(selected && events.length){const container=sceneEventsScrollRef.current;if(container)container.scrollTo({top:container.scrollHeight,behavior:'smooth'});}},[selected,events.length]);
  const [nextSpeaker,setNextSpeaker] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [showCreate,setShowCreate] = useState(false);
  const [showSceneSettings,setShowSceneSettings] = useState(false);
  const [sceneWallpaper,setSceneWallpaper] = useState('');
  const resolveMedia = useMediaResolver();
  const wallpaperKey = user?.id && selected ? `echo:scene-wallpaper:${user.id}:${universeId}:${me.id}:${selected}` : '';
  const [groupBackgroundId,setGroupBackgroundId] = useState('');
  const [matchingGroups,setMatchingGroups] = useState<Array<{id:string;name:string;participantIds:string[]}>>([]);
  useEffect(()=>{const scene=scenes.find(item=>item.sceneId===selected);setMatchingGroups([]);if(!scene||!user?.id)return;let cancelled=false;customFetch<{groups:Array<{id:string;name:string;participantIds:string[]}>}>(`/api/group-dms?${new URLSearchParams({universeId,actorId:me.id})}`,{method:'GET',responseType:'json'}).then(result=>{if(cancelled)return;const sceneMembers=new Set(scene.participantIds);const observedMembers=new Set(scene.participantIds.filter(id=>id!==me.id));setMatchingGroups(result.groups.filter(g=>{const members=new Set(g.participantIds);const expected=members.has(me.id)?sceneMembers:observedMembers;return members.size===expected.size&&[...members].every(id=>expected.has(id));}));}).catch(()=>{if(!cancelled)setMatchingGroups([]);});return()=>{cancelled=true;};},[selected,scenes,user?.id,universeId,me.id]);
  useEffect(()=>{
    if(!wallpaperKey){setSceneWallpaper('');return;}
    try{setSceneWallpaper(localStorage.getItem(wallpaperKey)??'');}catch{setSceneWallpaper('');}
  },[wallpaperKey]);
  useEffect(()=>{if(!selected||!user?.id){setGroupBackgroundId('');return;}const key=`echo:scene-source-group:${user.id}:${universeId}:${me.id}:${selected}`;try{setGroupBackgroundId(localStorage.getItem(key)??'');}catch{setGroupBackgroundId('');}},[selected,user?.id,universeId,me.id]);
  const effectiveGroupBackgroundId=groupBackgroundId==='none'?'':matchingGroups.some(g=>g.id===groupBackgroundId)?groupBackgroundId:(matchingGroups.length===1?matchingGroups[0].id:'');
  // A spectator can open a group using a different character identity than the
  // one that originally customized its wallpaper. Only inspect local keys for
  // participants of a group the API has already authorized and returned.
  const linkedGroupWallpaperKeys=effectiveGroupBackgroundId&&user?.id
    ? [me.id,...(matchingGroups.find(group=>group.id===effectiveGroupBackgroundId)?.participantIds??[])]
        .filter((actorId,index,actors)=>actors.indexOf(actorId)===index)
        .map(actorId=>`echo:group-wallpaper:${user.id}:${universeId}:${actorId}:${effectiveGroupBackgroundId}`)
    : [];
  const linkedGroupWallpaperKeysSignature=linkedGroupWallpaperKeys.join('|');
  const [linkedGroupWallpaper,setLinkedGroupWallpaper]=useState('');
  useEffect(()=>{
    const keys=linkedGroupWallpaperKeysSignature?linkedGroupWallpaperKeysSignature.split('|'):[];
    const refresh=()=>{try{setLinkedGroupWallpaper(keys.map(key=>localStorage.getItem(key)).find(Boolean)??'');}catch{setLinkedGroupWallpaper('');}};
    refresh();
    window.addEventListener('focus',refresh);
    window.addEventListener('storage',refresh);
    const onVisibility=()=>{if(document.visibilityState==='visible')refresh();};
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('storage',refresh);document.removeEventListener('visibilitychange',onVisibility);};
  },[linkedGroupWallpaperKeysSignature]);
  const [wallpaperUploading,setWallpaperUploading] = useState(false);
  const changeSceneWallpaper = async (file?:File) => {
    if(!wallpaperKey)return;
    if(!file){try{localStorage.removeItem(wallpaperKey);}catch{}setSceneWallpaper('');setError('');return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10_000_000){
      setError(es?'Elegí una imagen JPG, PNG o WebP de hasta 10 MB.':'Choose a JPG, PNG or WebP image up to 10 MB.');return;
    }
    setWallpaperUploading(true);
    try{
      const uploaded=await uploadPrivateFile(file);
      localStorage.setItem(wallpaperKey,uploaded.url);
      setSceneWallpaper(uploaded.url);
      setError('');
    }catch{setError(es?'No se pudo subir el fondo. Intentá nuevamente.':'Could not upload wallpaper. Try again.');}
    finally{setWallpaperUploading(false);}
  };
  const [sourceMessage, setSourceMessage] = useState<{messageId:string;peerName:string}|null>(null);
  useEffect(() => {
    if (!user?.id || new URLSearchParams(window.location.search).get('fromDm') !== '1') return;
    try {
      const raw = sessionStorage.getItem('echo:scene-from-dm');
      if (!raw) return;
      const origin = JSON.parse(raw) as {universeId:string;messageId:string;peerId:string;peerName:string;history:{sender:string;text:string}[]};
      if (origin.universeId !== universeId || !state.characters.some(c => c.id === origin.peerId)) return;
      setSourceMessage({messageId:origin.messageId,peerName:origin.peerName});
      setParticipants([origin.peerId]);
      setTitle(es ? `Continuación con ${origin.peerName}` : `Continuing with ${origin.peerName}`);
      const context = origin.history.map(entry => `${entry.sender}: ${entry.text}`).join('\n');
      setPremise(`Continue naturally from the following DM conversation, ending at message ${origin.messageId}. This is background context, not dialogue to replay. Preserve established events and character relationships; do not assume additional participants witnessed the private messages.\n\n${context}`.slice(0, 4000));
      setShowCreate(true);
      sessionStorage.removeItem('echo:scene-from-dm');
      window.history.replaceState(null, '', '/scenes');
    } catch { /* Invalid or expired handoff: normal scene creation remains available. */ }
  }, [user?.id, universeId]);
  const characters = state.characters.filter(c => !c.archived && c.id !== me.id);
  const refresh = async () => {
    const result = await customFetch<{scenes:Scene[]}>(`/api/scenes?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json',cache:'no-store'});
    setScenes(result.scenes);
  };
  useEffect(()=>{ if(user?.id) void refresh().catch(()=>setError(es?'No se pudieron cargar las escenas.':'Could not load scenes.')); },[user?.id,universeId]);
  useEffect(()=>{if(!selected)return; let active=true;
    void customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json',cache:'no-store'})
      .then(r=>{if(active)setEvents(r.events)}).catch(()=>{if(active)setError(es?'No se pudieron cargar los eventos.':'Could not load events.')});
    return()=>{active=false};
  },[selected,universeId,me.id]);
  useEffect(()=>{if(!selected)return;let mounted=true;
    void customFetch<{presence:{characterId:string;presence:'present'|'absent'|'left'}[]}>(`/api/scenes/${encodeURIComponent(selected)}/presence?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'})
      .then(r=>{if(mounted)setPresence(Object.fromEntries(r.presence.map(p=>[p.characterId,p.presence])));})
      .catch(()=>{});
    return()=>{mounted=false};
  },[selected,universeId]);
  const updatePresence=async(characterId:string,value:'present'|'absent'|'left')=>{
    if(!selected)return;setBusy(true);setError('');
    try{await customFetch(`/api/scenes/${encodeURIComponent(selected)}/presence`,{
      method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({universeId,characterId,presence:value})
    });setPresence(old=>({...old,[characterId]:value}));}
    catch{setError(es?'No se pudo actualizar la presencia.':'Could not update presence.')}
    finally{setBusy(false)}
  };
  const create = async (e:FormEvent) => {e.preventDefault();if(!participants.length)return;setBusy(true);setError('');
    try { const r=await customFetch<{sceneId:string}>('/api/scenes',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,title,premise,canon,participantIds:[me.id,...participants]})});await customFetch(`/api/scenes/${encodeURIComponent(r.sceneId)}/turns`,{method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,mode:createMode,order:[me.id,...participants],nextCharacterId:null,autoReply:createMode==='automatic'})});await refresh();setSelected(r.sceneId);setTitle('');setPremise('');setParticipants([]);setSourceMessage(null);setShowCreate(false);}
    catch{setError(es?'No se pudo crear la escena.':'Could not create scene.')}finally{setBusy(false)}
  };
  const send = async (e:FormEvent) => {e.preventDefault();if(!selected||!message.trim())return;setBusy(true);setError('');
    try {await customFetch('/api/scenes/events',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,sceneId:selected,actorId:me.id,text:message.trim(),visibility:'participants',audienceIds:[]})});setMessage('');
      const r=await customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json'});setEvents(r.events);
      if(active?.turnSettings?.autoReply && active?.status==='active' && active.turnSettings?.mode!=='manual'){
        const ai=active.participantIds.filter(id=>id!==me.id && (presence[id]??'present')==='present');
        const turn=active.turnSettings;
        const chosen=turn?.nextCharacterId && ai.includes(turn.nextCharacterId)?turn.nextCharacterId:
          turn?.mode==='ordered' ? (turn.order??[]).filter(id=>ai.includes(id))[(turn.cursor??0)%Math.max(1,(turn.order??[]).filter(id=>ai.includes(id)).length)]:
          ai[(ai.indexOf(r.events.filter(ev=>ai.includes(ev.actorId)).at(-1)?.actorId ?? '')+1)%ai.length]??ai[0];
        if(chosen){
          await customFetch(`/api/scenes/${encodeURIComponent(selected)}/reply`,{
            method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({universeId,characterId:chosen})
          });
          const after=await customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json'});
          setEvents(after.events);
          await refresh();
        }
      }
    }catch{setError(es?'No se pudo enviar.':'Could not send.')}finally{setBusy(false)}
  };
  const active=scenes.find(s=>s.sceneId===selected);
  const updateTurns = async (mode: 'automatic'|'manual'|'ordered', nextCharacterId: string|null = null, options: {style?: 'natural'|'cinematic'|'literary'|'concise';autoReply?:boolean} = {}) => {
    if (!active) return;
    setBusy(true);setError('');
    try {
      const result=await customFetch<{turnSettings:NonNullable<Scene['turnSettings']>}>(`/api/scenes/${encodeURIComponent(active.sceneId)}/turns`,{
        method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({universeId,mode,order:active.turnSettings?.order??active.participantIds,nextCharacterId,style:options.style??active.turnSettings?.style??'natural',autoReply:mode==='manual'?false:(options.autoReply??active.turnSettings?.autoReply??false)})
      });
      setScenes(previous=>previous.map(scene=>scene.sceneId===active.sceneId?{...scene,turnSettings:result.turnSettings}:scene));
      setNextSpeaker('');
    }catch{setError(es?'No se pudieron guardar los turnos.':'Could not save turn settings.')}
    finally{setBusy(false)}
  };
  const generateReply = async (characterId:string)=>{
    if(!active || busy)return;
    if((presence[characterId]??'present')!=='present'){setError(es?'Ese personaje no está presente en la escena.':'That character is not present in the scene.');return;}
    setBusy(true);setError('');
    try{
      if(active.turnSettings?.mode==='manual' && active.turnSettings?.nextCharacterId!==characterId){
        const result=await customFetch<{turnSettings:NonNullable<Scene['turnSettings']>}>(`/api/scenes/${encodeURIComponent(active.sceneId)}/turns`,{method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,mode:'manual',order:active.turnSettings?.order??active.participantIds,nextCharacterId:characterId,style:active.turnSettings?.style??'natural',autoReply:false})});
        setScenes(previous=>previous.map(scene=>scene.sceneId===active.sceneId?{...scene,turnSettings:result.turnSettings}:scene));
      }
      await customFetch(`/api/scenes/${encodeURIComponent(active.sceneId)}/reply`,{
        method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({universeId,characterId})
      });
      const [history,listing]=await Promise.all([
        customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(active.sceneId)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json'}),
        customFetch<{scenes:Scene[]}>(`/api/scenes?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'})
      ]);
      setEvents(history.events);setScenes(listing.scenes);
    }catch(error){const detail=error instanceof Error?error.message:"";setError((es?"No se pudo generar la respuesta. ":"Could not generate a reply. ")+detail.slice(0,220))}
    finally{setBusy(false)}
  };
  const continueScene = async () => {
    if(!active || active.status!=='active' || busy)return;
    const ai = active.participantIds.filter(id=>id!==me.id && (presence[id]??'present')==='present');
    if(!ai.length){setError(es?'No hay personajes presentes disponibles para responder.':'No present characters are available to reply.');return;}
    const turn=active.turnSettings;
    let target=turn?.nextCharacterId && ai.includes(turn.nextCharacterId)?turn.nextCharacterId:null;
    if(!target && turn?.mode==='ordered'){
      const order=(turn.order??[]).filter(id=>ai.includes(id));
      target=order.length?order[(turn.cursor??0)%order.length]:null;
    }
    if(!target){
      // Prefer the character explicitly named in a narrative opening.
      const latest=events.at(-1);
      const mentioned=latest && latest.actorId===me.id
        ? ai.find(id=>{
            const firstName=state.characters.find(c=>c.id===id)?.name?.split(' ')[0];
            return !!firstName && latest.text.toLowerCase().split(/[^a-zA-ZÀ-ÿ]+/).includes(firstName.toLowerCase());
          })
        : undefined;
      const last=events.filter(e=>ai.includes(e.actorId)).at(-1)?.actorId;
      target=mentioned??ai[(ai.indexOf(last??'')+1)%ai.length]??ai[0];
    }
    if(target)await generateReply(target);
  };
  const deleteScene = async () => {
    if (!active || busy || !window.confirm(es
      ? '¿Eliminar esta escena definitivamente? Se borrarán también sus mensajes y recuerdos. Esta acción no se puede deshacer.'
      : 'Permanently delete this scene? Its messages and memories will also be erased. This cannot be undone.')) return;
    setBusy(true); setError('');
    try {
      await customFetch(`/api/scenes/${encodeURIComponent(active.sceneId)}?${new URLSearchParams({universeId})}`, { method:'DELETE', responseType:'json' });
      setScenes(previous => previous.filter(scene => scene.sceneId !== active.sceneId));
      setSelected(null); setEvents([]); setPresence({});
    } catch { setError(es ? 'No se pudo eliminar la escena.' : 'Could not delete scene.'); }
    finally { setBusy(false); }
  };
  const updateStatus = async (status:'active'|'paused'|'finished')=>{
    if(!active)return;setBusy(true);setError('');
    try{await customFetch(`/api/scenes/${encodeURIComponent(active.sceneId)}/status`,{
      method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,status})
    });setScenes(previous=>previous.map(scene=>scene.sceneId===active.sceneId?{...scene,status}:scene));}
    catch{setError(es?'No se pudo actualizar la escena.':'Could not update scene.')}
    finally{setBusy(false)}
  };
  return <main className={active ? "relative isolate mx-auto flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-[#09090b]" : "mx-auto w-full max-w-2xl min-w-0 space-y-5 overflow-x-hidden px-4 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] pb-[calc(env(safe-area-inset-bottom,0px)+7rem)]"}>
    {!active&&<div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur"><h1 className="text-xl font-bold">ECHO Scenes</h1><Link href="/messages" className="shrink-0 text-sm text-muted-foreground">{st("Volver a mensajes")}</Link></div>}
    {!active&&<button type="button" onClick={()=>setShowCreate(value=>!value)} className="w-full rounded-xl border border-border p-3 text-left text-sm font-semibold">{showCreate ? (es?"− Ocultar creación":"− Hide creation") : (es?"+ Crear nueva escena":"+ Create new scene")}</button>}
    {!active&&showCreate&&<form onSubmit={create} className="space-y-3 rounded-2xl border border-border p-4">
      <h2 className="font-semibold">{st("Crear escena")}</h2>
      <input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder={st("Título")} className="w-full rounded-xl border border-border bg-background p-3"/>
      <textarea maxLength={4000} value={premise} onChange={e=>setPremise(e.target.value)} placeholder={st("Premisa")} className="w-full rounded-xl border border-border bg-background p-3"/>
      <select value={canon} onChange={e=>setCanon(e.target.value as 'main'|'alternate')} className="w-full rounded-xl border border-border bg-background p-3"><option value="main">{st("Canon principal")}</option><option value="alternate">{st("Universo alternativo")}</option></select>
      <div className="text-sm font-medium">{st("Participantes")}</div>
      <div className="max-h-40 space-y-2 overflow-y-auto">{characters.map(c=><label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={participants.includes(c.id)} onChange={e=>setParticipants(old=>e.target.checked?[...old,c.id]:old.filter(x=>x!==c.id))}/>{c.name}</label>)}</div>
      <fieldset className="space-y-2"><legend className="text-sm font-medium">{es?'Modo de turnos':'Turn mode'}</legend>
        <div className="grid grid-cols-2 gap-2">{(['manual','automatic'] as const).map(mode=><button key={mode} type="button" aria-pressed={createMode===mode} onClick={()=>setCreateMode(mode)} className={`rounded-xl border p-3 text-sm ${createMode===mode?'border-primary bg-primary/10':'border-border'}`}>{mode==='manual'?st('Manual'):st('Automático')}</button>)}</div>
        <p className="text-xs text-muted-foreground">{createMode==='manual'?(es?'Elegí quién responde tocando su avatar.':'Tap an avatar to choose who replies.'):(es?'Los personajes responden según el contexto.':'Characters reply based on context.')}</p>
      </fieldset>
      <button disabled={busy||!title.trim()||!participants.length} className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">{st("Crear")}</button>
    </form>}
    {!active&&<section className="space-y-2"><h2 className="font-semibold">{st("Mis escenas")}</h2>{scenes.map(s=><button key={s.sceneId} onClick={()=>setSelected(s.sceneId)} className={`block w-full rounded-xl border p-3 text-left ${selected===s.sceneId?'border-primary':'border-border'}`}><strong>{s.title}</strong><div className="text-xs text-muted-foreground">{s.canon==='main'?(es?'Principal':'Main'):(es?'Alternativo':'Alternate')} · {s.status}</div></button>)}</section>}
    {active&&<section className="relative isolate flex min-h-0 flex-1 flex-col gap-2 overflow-hidden bg-transparent px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
      {(sceneWallpaper||linkedGroupWallpaper)&&<div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat" style={{backgroundImage:`linear-gradient(rgba(0,0,0,.12),rgba(0,0,0,.28)),url("${(sceneWallpaper||linkedGroupWallpaper).startsWith("data:") ? (sceneWallpaper||linkedGroupWallpaper) : resolveMedia(sceneWallpaper||linkedGroupWallpaper)}")`}} />}
      <div className="relative z-10 flex shrink-0 items-center justify-between gap-2 bg-transparent p-1"><div className="flex min-w-0 items-center gap-2"><button type="button" onClick={()=>{setSelected(null);setEvents([]);}} aria-label={es?"Volver a escenas":"Back to scenes"} className="shrink-0 rounded-full border border-white/20 bg-background/40 px-3 py-2">‹</button><div className="flex min-w-0 flex-col items-center gap-1"><div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-black/35 text-xs font-semibold">{active.participantIds.slice(0,4).map(id=>{const c=state.characters.find(c=>c.id===id);return c?.avatar?<img key={id} src={resolveMedia(c.avatar)} alt="" className="h-full min-w-0 flex-1 object-cover"/>:<span key={id} className="flex-1 text-center">{(c?.name??"?").slice(0,1)}</span>})}</div><h2 className="max-w-[52vw] truncate text-sm font-semibold">{active.title}</h2></div></div>
        <div className="flex items-center gap-2">
          <button type="button" aria-expanded={showSceneSettings} onClick={()=>setShowSceneSettings(v=>!v)} className="rounded-full border border-white/20 bg-background/40 px-3 py-2 text-xs">{es?"Opciones":"Options"} ···</button>

        </div>
      </div>{showSceneSettings&&<div className="relative z-20 max-h-[38dvh] space-y-2 overflow-y-auto rounded-2xl border border-white/15 bg-black/35 p-2 backdrop-blur-lg"><div className="flex flex-wrap items-center gap-2">{matchingGroups.length>0&&<label className="flex items-center gap-2 text-xs">{es?"Fondo del grupo":"Group background"}<select className="max-w-40 rounded-xl border border-white/20 bg-black/60 p-2" value={effectiveGroupBackgroundId} onChange={e=>{const value=e.target.value;setGroupBackgroundId(value);try{localStorage.setItem(`echo:scene-source-group:${user!.id}:${universeId}:${me.id}:${selected}`,value);}catch{}}}><option value="none">{es?"Sin fondo de grupo":"No group background"}</option>{matchingGroups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}          {showSceneSettings&&<label className="cursor-pointer rounded-full border border-white/20 bg-background/40 px-3 py-2 text-xs backdrop-blur-xl">
            {wallpaperUploading?(es?'Subiendo fondo…':'Uploading wallpaper…'):(es?'Cambiar fondo':'Change wallpaper')}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={wallpaperUploading} className="sr-only" onChange={e=>{changeSceneWallpaper(e.target.files?.[0]);e.target.value='';}} />
          </label>}
          {showSceneSettings&&sceneWallpaper&&<button type="button" onClick={()=>changeSceneWallpaper()} className="rounded-full border border-white/20 bg-background/40 px-3 py-2 text-xs backdrop-blur-xl">{es?'Quitar':'Remove'}</button>}</div><details className="relative z-10 rounded-2xl border border-white/15 bg-background/35 p-2 backdrop-blur-xl"><summary className="cursor-pointer text-xs font-medium">{es?"Descripción e instrucciones":"Description and instructions"}</summary><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{active.premise}</p></details><details className="relative z-10 rounded-2xl border border-white/15 bg-background/50 p-3 backdrop-blur-xl"><summary className="cursor-pointer text-sm font-semibold">{st("Turnos y estado")}</summary>
        <div className="space-y-3 pt-3">
          <label className="block space-y-1 text-sm"><span className="font-medium">{st("Estilo de escritura de IA")}</span>
            <select disabled={busy||active.status==='finished'} value={active.turnSettings?.style??'natural'}
              onChange={e=>void updateTurns(active.turnSettings?.mode??'automatic',active.turnSettings?.nextCharacterId??null,{style:e.target.value as 'natural'|'cinematic'|'literary'|'concise'})}
              className="w-full rounded-xl border border-border bg-background p-3">
              <option value="natural">{st("Natural / Conversacional")}</option>
              <option value="cinematic">{st("Cinematográfico")}</option>
              <option value="literary">{st("Literario / Descriptivo")}</option>
              <option value="concise">{st("Breve / Directo")}</option>
            </select>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <input type="checkbox" className="mt-1" disabled={busy||active.status==='finished'||active.turnSettings?.mode==='manual'} checked={active.turnSettings?.autoReply??false}
              onChange={e=>void updateTurns(active.turnSettings?.mode??'automatic',active.turnSettings?.nextCharacterId??null,{autoReply:e.target.checked})}/>
            <span><strong>{st("Autonomía de respuesta")}</strong><span className="mt-1 block text-xs text-muted-foreground">{es?'La IA responde automáticamente una vez después de que escribís. Para continuar sin escribir, usá «Continuar escena».':'AI replies once after you send a message. To continue without writing, use Continue scene.'}</span></span>
          </label>
          <select disabled={busy||active.status==='finished'} value={active.turnSettings?.mode??'automatic'} onChange={e=>void updateTurns(e.target.value as 'automatic'|'manual'|'ordered')} className="w-full rounded-xl border border-border bg-background p-2">
            <option value="automatic">{st("Automático")}</option><option value="manual">{st("Manual")}</option><option value="ordered">{st("Por orden")}</option>
          </select>
          <select value={nextSpeaker} onChange={e=>setNextSpeaker(e.target.value)} className="w-full rounded-xl border border-border bg-background p-2">
            <option value="">{st("Elegir personaje")}</option>
            {active.participantIds.filter(id=>id!==me.id && (presence[id]??'present')==='present').map(id=><option key={id} value={id}>{state.characters.find(c=>c.id===id)?.name??id}</option>)}
          </select>
          <button type="button" disabled={busy||!nextSpeaker||active.status!=='active'} onClick={()=>void updateTurns(active.turnSettings?.mode??'automatic',nextSpeaker)} className="rounded-xl border border-border px-3 py-2 text-sm">{st("Elegir próximo turno")}</button>
          <div className="space-y-2"><div className="text-sm font-medium">{st("Presencia narrativa")}</div>
            {active.participantIds.map(id=><label key={id} className="flex items-center justify-between gap-2 text-sm">
              <span>{state.characters.find(c=>c.id===id)?.name??id}</span>
              <select disabled={busy||active.status==='finished'} value={presence[id]??'present'} onChange={e=>void updatePresence(id,e.target.value as 'present'|'absent'|'left')} className="rounded-lg border border-border bg-background p-2">
                <option value="present">{st("Presente")}</option>
                <option value="absent">{st("Ausente")}</option>
                <option value="left">{st("Se retiró")}</option>
              </select>
            </label>)}
          </div>
          <div className="flex gap-2">
            {active.status==='active'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('paused')} className="rounded-xl border border-border px-3 py-2 text-sm">{st("Pausar")}</button>}
            {active.status==='paused'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('active')} className="rounded-xl border border-border px-3 py-2 text-sm">{st("Reanudar")}</button>}
            {active.status!=='finished'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('finished')} className="rounded-xl border border-border px-3 py-2 text-sm">{st("Finalizar")}</button>}
            <button type="button" disabled={busy} onClick={()=>void deleteScene()} className="rounded-xl border border-destructive px-3 py-2 text-sm text-destructive disabled:opacity-50">{st("Eliminar escena definitivamente")}</button>
          </div>
        </div>
      </details></div>}{showSceneSettings && active.canon === "main" && <SceneCanonReview key={`${universeId}:${active.sceneId}`} universeId={universeId} sceneId={active.sceneId} />}<div ref={sceneEventsScrollRef} className="relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-transparent px-1 py-2">{events.length===0&&<div className="flex min-h-full flex-col items-center justify-center gap-3 px-5 text-center"><div className="flex -space-x-3">{active.participantIds.slice(0,4).map(id=>{const c=state.characters.find(ch=>ch.id===id);return <div key={id} className="grid h-12 w-12 place-items-center overflow-hidden rounded-full border-2 border-black/50 bg-background/65">{c?.avatar?<img src={resolveMedia(c.avatar)} alt="" className="h-full w-full object-cover"/>:<span>{(c?.name??"?").slice(0,1)}</span>}</div>})}</div><p className="font-semibold">{es?"La escena está lista":"Scene is ready"}</p><p className="max-w-xs text-sm text-white/65">{es?"Podés continuar la escena sin escribir, o elegir quién habla tocando su avatar.":"Continue the scene without writing, or tap a character avatar to choose who speaks."}</p></div>}{events.map(ev=><article key={ev.eventId} className="rounded-2xl border border-white/10 bg-black/30 p-3 text-sm backdrop-blur-md"><div className="mb-2 flex items-center gap-2"><div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary">{(()=>{const actor=state.characters.find(c=>c.id===ev.actorId);const avatar=ev.actorId===me.id?me.avatar:actor?.avatar;return avatar?<img src={resolveMedia(avatar)} alt="" className="h-full w-full object-cover"/>:<span>{(ev.actorId===me.id?me.name:actor?.name??"?").slice(0,1)}</span>})()}</div><strong className="min-w-0 truncate">{ev.actorId===me.id?me.name:state.characters.find(c=>c.id===ev.actorId)?.name??ev.actorId}</strong></div><p className="whitespace-pre-wrap"><SocialText text={ev.text} /></p></article>)}</div><div className="relative z-20 flex shrink-0 items-start justify-center gap-3 overflow-x-auto overscroll-x-contain bg-transparent px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={es?"Elegir quién habla":"Choose who speaks"}>
        {active.status==='active'&&active.participantIds.filter(id=>id!==me.id && (presence[id]??'present')==='present').map(id=><button type="button" key={id} disabled={busy} onClick={()=>void generateReply(id)}
          title={es?'Tocar para responder':'Tap to reply'} aria-label={es?`Responder como ${state.characters.find(c=>c.id===id)?.name??id}`:`Reply as ${state.characters.find(c=>c.id===id)?.name??id}`} className="flex w-14 shrink-0 flex-col items-center gap-1 bg-transparent px-0.5 py-1 text-[10px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] disabled:opacity-50">
          <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-black/20 text-lg shadow-md">{state.characters.find(c=>c.id===id)?.avatar?<img src={resolveMedia(state.characters.find(c=>c.id===id)!.avatar)} alt="" className="h-full w-full object-cover" loading="lazy" onError={e=>{e.currentTarget.style.display='none';e.currentTarget.parentElement?.append(document.createTextNode((state.characters.find(c=>c.id===id)?.name??'?').slice(0,1)));}}/>:(state.characters.find(c=>c.id===id)?.name??'?').slice(0,1)}</span>
          {state.characters.find(c=>c.id===id)?.name??id}
        </button>)}
      </div><form onSubmit={send} className="relative z-30 flex min-w-0 shrink-0 flex-wrap items-end gap-2 border-0 bg-transparent px-1 pb-1 pt-2"><FormattingToolbar inputRef={sceneMessageRef} value={message} onChange={setMessage} maxLength={5000} className="w-full" /><textarea ref={sceneMessageRef} rows={1} value={message} onChange={e=>{setMessage(e.target.value);e.currentTarget.style.height="auto";e.currentTarget.style.height=`${Math.min(e.currentTarget.scrollHeight,160)}px`;}} maxLength={5000} placeholder={st("Escribí en la escena…")} className="max-h-40 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto rounded-full border border-white/25 bg-black/25 px-4 py-3 text-white placeholder:text-white/55 backdrop-blur-md"/><button disabled={busy||active.status!=='active'||!message.trim()} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50" aria-label={st("Enviar")}><span aria-hidden="true" className="text-xl">➤</span></button></form></section>}
    {error&&<p role="alert" className="relative z-20 px-3 text-sm text-destructive">{error}</p>}
  </main>;
}
