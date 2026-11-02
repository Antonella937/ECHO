import {
  SCHEMA_VERSION,
  threadIdFor,
  type Character,
  type Comment,
  type Message,
  type Notification,
  type Post,
  type SocialState,
  type Story,
} from '@/domain/types';

const NELA = 'nela';
const MAR = 'mar';
const NOAH = 'noah';

export function createSeedState(): SocialState {
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60000).toISOString();
  const H = 60;
  const D = 24 * H;

  const character = (c: Omit<Character, 'providerRef'>): Character => ({
    ...c,
    providerRef: { provider: 'mock', externalId: null, status: 'not_connected', lastSyncAt: null },
  });

  const characters: Character[] = [
    character({
      id: NELA,
      handle: 'nelapaez',
      name: 'Nela Paez',
      occupation: 'Fotógrafa analógica',
      bio: 'Coleccionando luces que se apagan. Carretes, cafés fríos y cartas que no envío.',
      location: 'Madrid',
      avatar: 'asset:nela-avatar',
      identity: {
        provider: 'mock',
        referenceImages: ['asset:nela-avatar', 'asset:nela-1', 'asset:nela-4'],
        seed: 41207,
        appearance: 'Mujer española de 28 años, pelo oscuro largo y ondulado, piel oliva, aros dorados pequeños',
        styleNotes: 'Fotografía de película, luz de ventana, tonos apagados, grano fino',
        updatedAt: ago(30 * D),
      },
    }),
    character({
      id: MAR,
      handle: 'mar.mulligan',
      name: 'Mar Mulligan',
      occupation: 'Ceramista',
      bio: 'Barro, sal y mañanas lentas. Madre de Galway, padre de Cadaqués. Taller abierto los jueves.',
      location: 'Cadaqués',
      avatar: 'asset:mar-avatar',
      identity: {
        provider: 'mock',
        referenceImages: ['asset:mar-avatar', 'asset:mar-2'],
        seed: 88213,
        appearance: 'Mujer de 30 años, pelo cobrizo a media melena, pecas, jersey de punto crema',
        styleNotes: 'Luz nublada de costa, tonos desaturados, grano de película',
        updatedAt: ago(30 * D),
      },
    }),
    character({
      id: NOAH,
      handle: 'noahhayes',
      name: 'Noah Hayes',
      occupation: 'Músico',
      bio: 'Guitarra en Lisboa. Canciones a medias, cafés enteros. Toco los viernes en Alfama.',
      location: 'Lisboa',
      avatar: 'asset:noah-avatar',
      identity: {
        provider: 'mock',
        referenceImages: ['asset:noah-avatar', 'asset:noah-1', 'asset:noah-4'],
        seed: 50931,
        appearance: 'Hombre de 31 años, pelo oscuro corto y rizado, barba de pocos días, chaqueta vaquera oscura',
        styleNotes: 'Noche urbana, luz ámbar, grano de película, tonos apagados',
        updatedAt: ago(30 * D),
      },
    }),
  ];

  const post = (
    id: string,
    authorId: string,
    image: string,
    caption: string,
    location: string,
    minutesAgo: number,
    likes: string[],
    savedBy: string[] = [],
  ): Post => ({
    id,
    authorId,
    image: `asset:${image}`,
    caption,
    location,
    createdAt: ago(minutesAgo),
    likes,
    savedBy,
    origin: 'seed',
    illustrative: true,
  });

  const posts: Post[] = [
    post('p-nela-1', NELA, 'nela-1', 'Llueve en Malasaña y el café se enfría mientras miro por la ventana. Hay tardes que solo sirven para eso, y está bien.', 'Malasaña, Madrid', 3 * H, [MAR, NOAH]),
    post('p-mar-1', MAR, 'mar-1', 'Doce cuencos para el restaurante de Rosa. Dos se han agrietado en el horno y me los quedo yo, que son los que tienen historia.', 'Taller, Cadaqués', 6 * H, [NELA], [NELA]),
    post('p-noah-1', NOAH, 'noah-1', 'Anoche en el Tejo Bar. Catorce personas, una gata y la mejor versión de "Lento" que he tocado nunca.', 'Alfama, Lisboa', 10 * H, [NELA, MAR]),
    post('p-mar-2', MAR, 'mar-2', 'Tramontana desde anoche. Mi madre diría que es tiempo de Galway.', 'Cap de Creus', 1 * D + 2 * H, [NOAH, NELA]),
    post('p-nela-2', NELA, 'nela-2', 'Último carrete del verano. La Pentax sigue haciendo ese ruido raro al rebobinar, como si se quejara.', 'Lavapiés, Madrid', 2 * D, [MAR]),
    post('p-noah-2', NOAH, 'noah-2', 'El 28 a medianoche, sin turistas, suena distinto.', 'Graça, Lisboa', 3 * D + 4 * H, [NELA], [NELA]),
    post('p-mar-3', MAR, 'mar-3', 'Las barcas salen antes que yo. Siempre.', 'Port de Cadaqués', 4 * D, [NELA, NOAH]),
    post('p-nela-3', NELA, 'nela-3', 'Cartas que nunca envío. Rosas que no tiro.', 'Casa', 5 * D + 6 * H, [NOAH, MAR], [MAR]),
    post('p-noah-3', NOAH, 'noah-3', 'Maqueta nueva. Tiene una línea de bajo que me robó @nelapaez sin saberlo, tarareando en el tren.', 'Estudio, Lisboa', 7 * D, [NELA, MAR]),
    post('p-nela-4', NELA, 'nela-4', 'Volver andando a las dos de la mañana tiene algo de película que no se puede explicar.', 'Gran Vía, Madrid', 9 * D, [NOAH]),
    post('p-mar-4', MAR, 'mar-4', 'Tercera vez centrando este barro. A la cuarta va la vencida, o eso me digo.', 'Taller, Cadaqués', 11 * D, [NELA]),
    post('p-noah-4', NOAH, 'noah-4', 'El río nunca tiene prisa. Intento aprender de él.', 'Cais do Sodré, Lisboa', 13 * D, [MAR, NELA]),
  ];

  const comment = (
    id: string,
    postId: string,
    authorId: string,
    text: string,
    minutesAgo: number,
    parentId: string | null = null,
    replyToAuthorId: string | null = null,
    likes: string[] = [],
  ): Comment => ({ id, postId, authorId, text, createdAt: ago(minutesAgo), parentId, replyToAuthorId, likes, origin: 'seed' });

  const comments: Comment[] = [
    comment('c1', 'p-nela-1', MAR, 'Esa luz es tuya, no de Madrid.', 2 * H + 40, null, null, [NELA]),
    comment('c2', 'p-nela-1', NOAH, 'Guárdame un café para el jueves.', 2 * H),
    comment('c3', 'p-nela-1', NELA, 'Si llegas a tiempo, igual.', 1 * H + 30, 'c2', NOAH, [NOAH]),
    comment('c4', 'p-mar-1', NELA, 'Quiero uno de los agrietados. Los perfectos me dan miedo.', 5 * H),
    comment('c5', 'p-mar-1', MAR, 'Ya tiene tu nombre escrito por debajo.', 4 * H, 'c4', NELA, [NELA]),
    comment('c6', 'p-noah-1', MAR, 'La gata es la verdadera estrella.', 9 * H, null, null, [NOAH]),
    comment('c7', 'p-noah-1', NELA, 'Mándame la grabación, aunque se oiga fatal.', 8 * H),
    comment('c8', 'p-mar-2', NOAH, 'Galway con mejor comida.', 1 * D),
    comment('c9', 'p-mar-2', MAR, 'No se lo digas a mi madre.', 23 * H, 'c8', NOAH),
    comment('c10', 'p-noah-3', NELA, '¿Yo? Si yo no tarareo nunca.', 6 * D + 20 * H),
    comment('c11', 'p-noah-3', NOAH, 'Tarareas siempre. Sobre todo cuando dices que no.', 6 * D + 19 * H, 'c10', NELA, [MAR]),
    comment('c12', 'p-noah-3', MAR, 'Confirmo.', 6 * D + 18 * H, 'c10', NOAH, [NOAH]),
    comment('c13', 'p-nela-3', MAR, 'Un día me escribirás una a mí y la enviarás.', 5 * D),
    comment('c14', 'p-mar-3', NELA, 'Esta la quiero en grande en mi pasillo.', 3 * D + 20 * H),
  ];

  const stories: Story[] = [
    { id: 's-mar-1', authorId: MAR, image: 'asset:mar-3', caption: 'Niebla en el puerto otra vez', createdAt: ago(50), seenBy: [], origin: 'seed' },
    { id: 's-mar-2', authorId: MAR, image: 'asset:mar-4', caption: 'Jueves de taller abierto', createdAt: ago(3 * H), seenBy: [], origin: 'seed' },
    { id: 's-noah-1', authorId: NOAH, image: 'asset:noah-2', caption: 'Volviendo a casa', createdAt: ago(1 * H + 10), seenBy: [], origin: 'seed' },
    { id: 's-noah-2', authorId: NOAH, image: 'asset:noah-3', caption: 'Una toma más y me voy a dormir', createdAt: ago(5 * H), seenBy: [MAR], origin: 'seed' },
    { id: 's-nela-1', authorId: NELA, image: 'asset:nela-2', caption: 'Revelando lo de este verano', createdAt: ago(2 * H), seenBy: [MAR], origin: 'seed' },
  ];

  const msg = (from: string, to: string, text: string, minutesAgo: number, read: boolean, extra: Partial<Message> = {}): Message => ({
    id: `m-${from}-${minutesAgo}`,
    threadId: threadIdFor(from, to),
    senderId: from,
    recipientId: to,
    text,
    createdAt: ago(minutesAgo),
    storyId: null,
    postId: null,
    readBy: read ? [from, to] : [from],
    origin: 'seed',
    ...extra,
  });

  const messages: Message[] = [
    msg(MAR, NELA, '¿Sigues queriendo venir en octubre? Te guardo la habitación de arriba.', 2 * D + 3 * H, true),
    msg(NELA, MAR, 'Sí. Necesito mar y silencio, en ese orden.', 2 * D + 2 * H, true),
    msg(MAR, NELA, 'Aquí hay mucho de los dos. Trae la cámara buena.', 2 * D + 1 * H, true),
    msg(NELA, MAR, 'Traigo las dos. Nunca sé cuál es la buena.', 1 * D + 5 * H, true),
    msg(MAR, NELA, 'Te he hecho una taza. No preguntes de qué color.', 5 * H, false),
    msg(NOAH, NELA, 'Ya está la maqueta. ¿Te la paso o prefieres esperar a oírla en directo?', 3 * D + 2 * H, true),
    msg(NELA, NOAH, 'Pásamela. Y luego también en directo.', 3 * D + 1 * H, true),
    msg(NOAH, NELA, 'Trato. Aviso: hay una melodía tuya dentro.', 2 * D + 8 * H, true),
    msg(NELA, NOAH, 'Ya lo he visto en tu post. Ladrón.', 2 * D + 7 * H, true),
    msg(NOAH, NELA, 'Te debo un café. O dos.', 20 * H, false),
    msg(NOAH, MAR, '¿Me haces unas tazas para el bar? Te pago en entradas.', 6 * D, true),
    msg(MAR, NOAH, 'Te las hago si tocas en la inauguración del taller.', 5 * D + 22 * H, true),
    msg(NOAH, MAR, 'Hecho. Llevo a la gata.', 5 * D + 20 * H, false),
  ];

  const n = (
    id: string,
    recipientId: string,
    actorId: string,
    kind: Notification['kind'],
    minutesAgo: number,
    read: boolean,
    excerpt: string,
    postId: string | null = null,
    commentId: string | null = null,
  ): Notification => ({ id, recipientId, actorId, kind, postId, commentId, storyId: null, excerpt, createdAt: ago(minutesAgo), read });

  const notifications: Notification[] = [
    n('n1', NELA, NOAH, 'message', 20 * H, false, 'Te debo un café. O dos.'),
    n('n2', NELA, MAR, 'message', 5 * H, false, 'Te he hecho una taza. No preguntes de qué color.'),
    n('n3', NELA, MAR, 'like', 2 * H + 50, false, 'Llueve en Malasaña y el café se enfría…', 'p-nela-1'),
    n('n4', NELA, MAR, 'comment', 2 * H + 40, false, 'Esa luz es tuya, no de Madrid.', 'p-nela-1', 'c1'),
    n('n5', NELA, NOAH, 'comment', 2 * H, false, 'Guárdame un café para el jueves.', 'p-nela-1', 'c2'),
    n('n6', NELA, MAR, 'reply', 4 * H, true, 'Ya tiene tu nombre escrito por debajo.', 'p-mar-1', 'c5'),
    n('n7', NELA, NOAH, 'like', 2 * H + 10, true, 'Llueve en Malasaña y el café se enfría…', 'p-nela-1'),
    n('n8', NELA, NOAH, 'mention', 7 * D, true, 'Tiene una línea de bajo que me robó @nelapaez…', 'p-noah-3'),
    n('n9', NELA, NOAH, 'like', 5 * D, true, 'Cartas que nunca envío. Rosas que no tiro.', 'p-nela-3'),
    n('n10', MAR, NELA, 'comment', 5 * H, false, 'Quiero uno de los agrietados. Los perfectos me dan miedo.', 'p-mar-1', 'c4'),
    n('n11', MAR, NOAH, 'like', 1 * D, true, 'Tramontana desde anoche.', 'p-mar-2'),
    n('n12', NOAH, NELA, 'like', 9 * H, false, 'Anoche en el Tejo Bar.', 'p-noah-1'),
    n('n13', NOAH, MAR, 'comment', 9 * H, false, 'La gata es la verdadera estrella.', 'p-noah-1', 'c6'),
  ];

  return {
    version: SCHEMA_VERSION,
    currentCharacterId: NELA,
    characters,
    follows: { [NELA]: [MAR, NOAH], [MAR]: [NELA, NOAH], [NOAH]: [NELA, MAR] },
    posts,
    comments,
    stories,
    messages,
    notifications,
  };
}
