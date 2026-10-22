// The five Instagram videos: hook (first 2 s), app screens with one line each, end card. Voice = public/audio/*.mp3
// (uz-UZ-MadinaNeural, scripts/voice.py); the caption timings come from the matching *.json.
import navbat from '../public/audio/navbat.json';
import shifokor from '../public/audio/shifokor.json';
import kassa from '../public/audio/kassa.json';
import kamera from '../public/audio/kamera.json';
import nega from '../public/audio/nega.json';

export type Cue = { start: number; end: number; text: string };
export type Scene = { shot: string; title: string; sub?: string; desktop?: boolean; focus?: 'top' | 'middle' | 'bottom' };
export type Promo = {
  id: string; hook: string; hookSub?: string; accent: string; scenes: Scene[]; cta: string; voice: { cues: Cue[]; end: number };
  compare?: { name: string; what: string; tone: 'grey' | 'brand' }[]; compareCues?: number;
};

export const PROMOS: Promo[] = [
  { id: 'navbat', hook: 'Navbatda kutish — 20 daqiqa?', hookSub: 'Qabulxona telefoni tinmaydi', accent: '#0a58ca', voice: navbat, cta: 'Bemor Telegram’dan o‘zi yoziladi',
    scenes: [
      { shot: 'schedule', title: 'Bemor Telegram’dan yoziladi', sub: 'bot bo‘sh vaqtni ko‘rsatadi, eslatma yuboradi', focus: 'top' },
      { shot: 'queue', title: 'Registrator jadvalni telefonida ko‘radi', sub: 'kim keldi, kim kechikdi', focus: 'top' },
      { shot: 'patients', title: 'Navbat yo‘q, qo‘ng‘iroq yo‘q', focus: 'middle' },
    ] },
  { id: 'shifokor', hook: 'Shifokor kuniga 2 soat yozuv yozadi', hookSub: 'Bemorga emas — qog‘ozga', accent: '#0f766e', voice: shifokor, cta: 'AI qoralama, imzo — shifokorniki',
    scenes: [
      { shot: 'desk-doctor', title: 'Shikoyatni yozasiz', sub: 'AI qayd qoralamasini tuzadi', desktop: true },
      { shot: 'doctor', title: 'MKB-10 tashxis takliflari', sub: 'bir bosishda imzo', focus: 'top' },
      { shot: 'desk-doctor', title: 'Qaror hamisha shifokorniki', sub: 'AI faqat taklif beradi', desktop: true },
    ] },
  { id: 'kassa', hook: 'Kassadagi pul bilan hisobot mos keladimi?', hookSub: 'Oy oxirida hamma hisoblaydi', accent: '#b45309', voice: kassa, cta: 'Kassa, qaytarish, hisobot — bir joyda',
    scenes: [
      { shot: 'cashier', title: 'Har to‘lov smena bilan bog‘liq', sub: 'naqd, karta, qaytarish, xarajat', focus: 'top' },
      { shot: 'dashboard', title: 'Rahbar daromadni real vaqtda ko‘radi', sub: 'telefonida', focus: 'top' },
      { shot: 'finance', title: 'Oy hisoboti — bir daqiqada', focus: 'top' },
    ] },
  { id: 'kamera', hook: 'Tunda klinikangizda kim yuradi?', hookSub: 'Kamera bor, lekin kim qaraydi?', accent: '#b91c1c', voice: kamera, cta: 'Hikvision kameralari bilan ishlaydi',
    scenes: [
      { shot: 'desk-cameras', title: 'Xodimlar davomati — avtomatik', sub: 'kamera tanidi, jadval to‘ldi', desktop: true },
      { shot: 'cameras', title: 'Tungi ogohlantirish surati', sub: 'rahbarning telefoniga keladi', focus: 'bottom' },
      { shot: 'cameras', title: 'Yuzlar kamerada qoladi', sub: 'bizda faqat kod va vaqt — qonuniy', focus: 'top' },
    ] },
  { id: 'nega', hook: 'Nega Med.uz.ai?', hookSub: 'DMED va Med Plus bor-ku?', accent: '#1f3b78', voice: nega, cta: 'Telefonda · 3 tilda · ma’lumot O‘zbekistonda',
    compareCues: 2,
    compare: [
      { name: 'DMED', what: 'davlatning elektron tibbiy kartasi', tone: 'grey' },
      { name: 'Med Plus', what: 'klinika hisob-kitob dasturi', tone: 'grey' },
      { name: 'Med.uz.ai', what: 'klinikaning kundalik ishi: Telegram, AI, kamera, kassa', tone: 'brand' },
    ],
    scenes: [
      { shot: 'schedule', title: 'Bemor Telegram’dan yoziladi', focus: 'top' },
      { shot: 'desk-doctor', title: 'AI shifokorga yozuvda yordam beradi', desktop: true },
      { shot: 'desk-cameras', title: 'Kameralar davomatni oladi', desktop: true },
      { shot: 'dashboard', title: 'Kassa va hisobot bir joyda', focus: 'top' },
    ] },
];
