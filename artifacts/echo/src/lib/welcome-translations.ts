import { useLanguage } from './i18n';

const copy = {
  es: { heading:'¡Bienvenid@ a ECHO!', message:'Este espacio es para crear, imaginar y conectar a tu manera. Gracias por estar acá desde el comienzo. Espero que encuentres un lugar que sientas tuyo. 🖤', signature:'Con cariño, Nela', button:'Empezar a explorar' },
  en: { heading:'Welcome to ECHO!', message:'This is a space to create, imagine, and connect your own way. Thank you for being here from the beginning. I hope you find a little corner that feels like yours. 🖤', signature:'With love, Nela', button:'Start exploring' },
  pt: { heading:'Boas-vindas ao ECHO!', message:'Este é um espaço para criar, imaginar e se conectar do seu jeito. Obrigada por estar aqui desde o começo. Espero que encontre um cantinho que seja seu. 🖤', signature:'Com carinho, Nela', button:'Começar a explorar' },
  fr: { heading:'Bienvenue sur ECHO !', message:'Un espace pour créer, imaginer et tisser des liens à votre façon. Merci d’être là dès le début. J’espère que vous y trouverez un petit coin à vous. 🖤', signature:'Avec affection, Nela', button:'Commencer à explorer' },
  de: { heading:'Willkommen bei ECHO!', message:'Ein Ort zum Gestalten, Träumen und Vernetzen – ganz auf deine Art. Danke, dass du von Anfang an dabei bist. Ich hoffe, du findest hier deinen eigenen Platz. 🖤', signature:'Alles Liebe, Nela', button:'Jetzt entdecken' },
  it: { heading:'Benvenutə su ECHO!', message:'Uno spazio per creare, immaginare e connetterti a modo tuo. Grazie per essere qui fin dall’inizio. Spero che tu possa trovare un angolo tutto tuo. 🖤', signature:'Con affetto, Nela', button:'Inizia a esplorare' },
  ko: { heading:'ECHO에 오신 걸 환영해요!', message:'나만의 방식으로 만들고, 상상하고, 소통하는 공간이에요. 시작부터 함께해 주셔서 고마워요. 이곳에서 나만의 자리를 찾길 바라요. 🖤', signature:'사랑을 담아, Nela', button:'둘러보기' },
  ja: { heading:'ECHOへようこそ！', message:'自分らしく創作し、想像し、つながるための場所です。最初から参加してくれてありがとう。ここがあなたにとって居心地のよい場所になりますように。🖤', signature:'愛を込めて、Nela', button:'探索を始める' },
  zh: { heading:'欢迎来到 ECHO！', message:'这是一个让你以自己的方式创作、想象和交流的空间。谢谢你从一开始就来到这里。希望你能在这里找到属于自己的小天地。🖤', signature:'爱你的 Nela', button:'开始探索' },
} as const;
export function useWelcomeText() { return copy[useLanguage()]; }
