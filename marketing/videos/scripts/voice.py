"""Voiceovers for the Instagram videos: Microsoft neural voice uz-UZ-MadinaNeural via edge-tts, with word-timed subtitles."""
import json, subprocess, re, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'audio')
SCRIPTS = {
 'navbat': "Qabulxonangizda bemorlar navbatda kutyaptimi? Med.uz.ai bilan bemor Telegram orqali o‘zi qabulga yoziladi, eslatmani o‘zi oladi. Registrator jadvalni telefonida ko‘radi: kim keldi, kim kechikdi. Navbat yo‘q, telefon qo‘ng‘iroqlari yo‘q. Bepul demo — med.uz.ai.",
 'shifokor': "Shifokor kuniga ikki soatini yozuvga sarflaydi. Med.uz.ai’da shikoyatni yozasiz — sun’iy intellekt qaydning qoralamasini va MKB o‘n tashxis takliflarini beradi. Siz tekshirasiz, bir bosishda imzolaysiz. Qaror hamisha shifokorniki. Shifokorga vaqt, bemorga e’tibor. Bepul demo — med.uz.ai.",
 'kassa': "Kassadagi pul bilan hisobotdagi raqam mos keladimi? Med.uz.ai’da har bir to‘lov smena bilan bog‘lanadi: naqd, karta, qaytarish, xarajat — hammasi bir joyda. Rahbar daromadni real vaqtda, telefonida ko‘radi. Oy oxirida hisobot bir daqiqada. Bepul demo — med.uz.ai.",
 'kamera': "Tunda klinikangizda kim yurganini bilasizmi? Med.uz.ai Hikvision kameralari bilan ishlaydi: xodimlar davomati avtomatik, bemor kelganini kamera taniydi, tungi ogohlantirish surati rahbarning telefoniga keladi. Yuz rasmlari kamerada qoladi, bizda faqat vaqt. Xavfsiz va qonuniy. Bepul demo — med.uz.ai.",
 'nega': "Nega Med.uz.ai? DMED — davlatning elektron tibbiy kartasi. Med Plus — klinika hisob-kitob dasturi. Med.uz.ai esa klinikaning kundalik ishi uchun yaratilgan: bemor Telegram’dan yoziladi, sun’iy intellekt shifokorga yozuvda yordam beradi, kameralar davomatni oladi, kassa va hisobot bir joyda. Hammasi telefonda, uch tilda, ma’lumotlar O‘zbekistonda. Bepul demo — med.uz.ai.",
}
def srt_to_cues(path):
    txt = open(path, encoding='utf-8').read().strip()
    cues = []
    for block in re.split(r'\n\s*\n', txt):
        lines = block.strip().split('\n')
        if len(lines) < 3: continue
        m = re.match(r'(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)', lines[1])
        if not m: continue
        g = [int(x) for x in m.groups()]
        s = g[0]*3600+g[1]*60+g[2]+g[3]/1000; e = g[4]*3600+g[5]*60+g[6]+g[7]/1000
        cues.append({'start': s, 'end': e, 'text': ' '.join(lines[2:]).strip()})
    return cues
os.makedirs(OUT, exist_ok=True)
for name, text in SCRIPTS.items():
    mp3 = os.path.join(OUT, f'{name}.mp3'); srt = os.path.join(OUT, f'{name}.srt')
    subprocess.run([sys.executable, '-m', 'edge_tts', '--voice', 'uz-UZ-MadinaNeural', '--rate=+6%', '--text', text, '--write-media', mp3, '--write-subtitles', srt], check=True)
    cues = srt_to_cues(srt)
    json.dump({'text': text, 'cues': cues, 'end': cues[-1]['end'] if cues else 0}, open(os.path.join(OUT, f'{name}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(name, f"{cues[-1]['end']:.1f}s" if cues else 'no cues', os.path.getsize(mp3)//1024, 'KB', len(cues), 'cues')
