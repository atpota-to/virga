// String.prototype.localeCompare as the web calls it, for VirgaCore's port
// (Support/JSCollation.swift, over the table
// ios/scripts/generate-collation-table.mjs reads from Node's collator):
//
//   a.localeCompare(b)                                   the reports' ties,
//     the composer's language list, rkeys
//   a.localeCompare(b, undefined, { sensitivity: 'base' })  template groups
//     and names, the library's names
//
// with no locale (the runtime's) and in every locale the app offers
// (LOCALE_CHOICES). Pairs come in chunks: the words the app sorts and their
// case, accent, width and compatibility variants, every pair within small
// groups of look-alikes, and seeded random text in each script, mutated so
// that pairs tie at the base letter and differ only in accent or case.
// Each case's output holds the sign of both comparisons, a character a
// pair ('<', '=' or '>': `variant`, `base`), and under `locales` any
// locale that answers differently from the runtime's (none does today:
// CLDR has no English tailoring).
//
// One thing is left out: Node's collator isn't canonically closed for the
// Kirat Rai vowel signs U+16D68..U+16D6A (Unicode 16, whose decompositions
// are runs of starters), so text that is canonically the same can sort
// apart there; the port, as the Unicode Collation Algorithm does, sorts it
// together.

import { each } from './_helpers.js';
import { seeded } from './_insights.js';
import { LANGUAGE_CODES } from '../../../src/posting/composer/languages.js';
import { LOCALE_CHOICES } from '../../../src/lib/locale.js';

export const sources = [
  'src/reports/models.js',
  'src/posting/templates/templateUsage.js',
  'src/posting/templates/templateService.js',
  'src/posting/library/model.js',
  'src/posting/composer/languages.js',
];

const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
/** Signs as one character a pair, '<', '=' or '>', to keep the fixture small. */
const signs = (list) => list.map((n) => '<=>'[n + 1]).join('');
const plain = (a, b) => sign(a.localeCompare(b));
const base = (a, b) =>
  sign(a.localeCompare(b, undefined, { sensitivity: 'base' }));
const inLocale = (tag) => {
  const v = new Intl.Collator(tag);
  const b = new Intl.Collator(tag, { sensitivity: 'base' });
  return {
    variant: (x, y) => sign(v.compare(x, y)),
    base: (x, y) => sign(b.compare(x, y)),
  };
};
const LOCALES = LOCALE_CHOICES.map((tag) => [tag, inLocale(tag)]);

/** Splits a string of space-separated tokens (escapes allowed). */
const tokens = (s) => s.split(' ').filter(Boolean);

// The scripts, each a pool of code points (and a few sequences) that its
// random text is drawn from.
const SCRIPTS = {
  latin: [
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĸĺļľŀłńņňŋòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵŷÿźżž',
    ...'ÀÁÂÃÄÅĀĂĄÇĆĈĊČĎĐÈÉÊËĒĔĖĘĚĜĞĠĢĤĦÌÍÎÏĨĪĬĮİĴĶĹĻĽĿŁŃŅŇŊÒÓÔÕÖØŌŎŐŔŖŘŚŜŞŠŢŤŦÙÚÛÜŨŪŬŮŰŲŴŶŸŹŻŽ',
    ...'ßẞæÆœŒþÞðÐəƏɛƐɔƆſǝƎǅǄǆǈǋ',
    ...'ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ',
    ...'ⱥȺꞵꞴꟸꝏꜳɐɑɒʃʒʔʕ',
    '̀',
    '́',
    '̂',
    '̃',
    '̈',
    '̊',
    '̌',
    '̣',
    '̧',
    '̨',
    '̵',
    '̸',
    'é',
    'ä',
    'ố',
    'ừ',
  ],
  greek: [
    ...'αβγδεζηθικλμνξοπρσςτυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ',
    ...'άέήίόύώΆΈΉΊΌΎΏϊϋΪΫΐΰ',
    ...'ἀἁἂἄἆἈἉὀὁὐὑὠὡᾳᾴᾶᾷῆῇῳῶῷῥῬ',
    ...'ϐϑϕϖϰϱϲϳϴϵ',
    '̓',
    '̔',
    '͂',
    'ͅ',
  ],
  cyrillic: [
    ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    ...'іїєґўђћџљњѕјІЇЄҐЎЂЋЏЉЊЅЈ',
    ...'ӣӢӯӮәӘөӨүҮұҰқҚғҒңҢһҺҗҖҳҲӑӓӗ',
    ...'ꙁꙀᲀꚙ',
    'й',
    'ё',
    'ў',
  ],
  armenian: [...'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆԱԲԳԴԵԶԷ', 'և', 'ﬓ'],
  georgian: [...'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ', ...'ᲐᲑᲒᲓᲔᲕᲖ', ...'ႠႡႢⴀⴁⴂ'],
  hebrew: [
    ...'אבגדהוזחטיכךלמםנןסעפףצץקרשת',
    'ְ',
    'ִ',
    'ַ',
    'ָ',
    'ּ',
    'ׁ',
    'ׂ',
    'שׁ',
    'בּ',
    'ײ',
    'װ',
  ],
  arabic: [
    ...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي',
    ...'ءآأإؤئةىپچژگکیےۀۂ',
    ...'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    'ً',
    'َ',
    'ُ',
    'ِ',
    'ّ',
    'ْ',
    'ٓ',
    'ٔ',
    'ٕ',
    'ٰ',
    'ـ',
    '،',
    '؟',
    'ﻻ',
    'ﺍ',
    'ﺑ',
    'ﷲ',
  ],
  syriac: [...'ܐܒܓܕܗܘܙܚܛܝܟܠܡܢ', 'ܰ', 'ܲ'],
  thaana: [...'ހށނރބޅކއ', 'ަ', 'ި'],
  devanagari: [
    ...'अआइईउऊएऐओऔकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह',
    ...'०१२३४५६७८९',
    'ा',
    'ि',
    'ी',
    'ु',
    'े',
    'ै',
    'ो',
    'ौ',
    '्',
    '़',
    'ं',
    'ँ',
    'ः',
    'क़',
    'ज़',
    'ड़',
    'क़',
    'ॐ',
    '।',
  ],
  bengali: [
    ...'অআইঈউকখগঘচছজঝটঠডঢণতথদধনপফবভমযরলশষসহ',
    ...'০১২৩',
    'া',
    'ি',
    'ী',
    'ে',
    'ৈ',
    'ো',
    'ৌ',
    'ৗ',
    '্',
    'ড়',
    'য়',
  ],
  gurmukhi: [
    ...'ਅਆਇਕਖਗਘਚਛਜਝਟਠਡਢਣਤਥਦਧਨਪਫਬਭਮਯਰਲਵਸਹ',
    'ਾ',
    'ਿ',
    'ੀ',
    '੍',
    'ਖ਼',
    'ਜ਼',
  ],
  gujarati: [...'અઆઇકખગઘચછજઝટઠડઢણતથદધનપફબભમયરલવસહ', 'ા', 'િ', 'ી', '્'],
  oriya: [...'ଅଆକଖଗଘଚଛଜଝଟଠଡଢତଥଦଧନପ', 'ା', 'େ', 'ୈ', 'ୋ', 'ୌ', 'ୖ', 'ୗ'],
  tamil: [
    ...'அஆஇஈஉஊஎஏஐஒஓஔகஙசஞடணதநபமயரலவழளறன',
    'ா',
    'ி',
    'ீ',
    'ெ',
    'ே',
    'ை',
    'ொ',
    'ோ',
    'ௌ',
    'ௗ',
    '்',
  ],
  telugu: [...'అఆఇకఖగఘచఛజఝటఠడఢణతథదధనప', 'ా', 'ె', 'ే', 'ై', '్', 'ౖ'],
  kannada: [...'ಅಆಇಕಖಗಘಚಛಜಝಟಠಡಢಣತಥದಧನಪ', 'ಿ', 'ೆ', 'ೇ', 'ೊ', 'ೋ', 'ೕ', 'ೖ', 'ೂ'],
  malayalam: [
    ...'അആഇകഖഗഘചഛജഝടഠഡഢണതഥദധനപ',
    'ാ',
    'െ',
    'േ',
    'ൊ',
    'ോ',
    'ൌ',
    'ൗ',
    '്',
  ],
  sinhala: [...'අආඇකඛගඝචඡජඣටඨඩඪණතථදධනප', '්', 'ා', 'ෙ', 'ේ', 'ො', 'ෝ', 'ෞ', 'ෟ'],
  thai: [
    ...'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮ',
    ...'ะาำิีึืุูเแโใไๅ',
    '่',
    '้',
    '๊',
    '๋',
    '์',
    '็',
    'ั',
    'ๆ',
    '๐',
    '๑',
    '๕',
  ],
  lao: [
    ...'ກຂຄງຈຊຍດຕຖທນບປຜຝພຟມຢຣລວສຫອຮ',
    ...'ະາຳິີເແໂໃໄ',
    '່',
    '້',
    '໊',
    '໋',
    'ໆ',
    'ໜ',
    'ໝ',
    '໑',
  ],
  tibetan: [
    ...'ཀཁགངཅཆཇཉཏཐདནཔཕབམཙཚཛཝཞཟའཡརལཤསཧཨ',
    'ི',
    'ུ',
    'ེ',
    'ོ',
    'ྐ',
    'ྑ',
    'ྒ',
    '་',
    '།',
    'ཀྵ',
    'གྷ',
  ],
  myanmar: [
    ...'ကခဂဃငစဆဇဈညဋဌဍဎဏတထဒဓနပဖဗဘမယရလဝသဟဠအ',
    'ဥ',
    'ဦ',
    'ါ',
    'ာ',
    'ိ',
    'ီ',
    'ု',
    'ေ',
    'ံ',
    '့',
    '္',
    '်',
    'ီ',
  ],
  khmer: [...'កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសហឡអ', 'ា', 'ិ', 'េ', 'ែ', 'ោ', '្'],
  ethiopic: [...'ሀሁሂሃሄህሆለሉሊላሌልሎሐመሙሚማሜምሞሠረሰሸቀበተቸነኘአከወዐዘየደጀገጠጨጰጸፀፈፐ'],
  cherokee: [...'ᎠᎡᎢᎣᎤᎥᎦᎧᎨᎩᎪᎫᎬᎭ', ...'ꭰꭱꭲꭳꭴꭵ'],
  hangul: [
    ...'가각간갇갈감갑강개객거건걸검것게겨결고공과관광괴교구국군굴권궤귀규균그극근글금기길김까깨꼬꾸끄끼나낙난날남납낭내너널네노녹논놀농뇌누눈뉴느는늘능니닌다단달담답당대더덕도독동돼되두둘뒤드득들등디따때또뚜뜨라락란람랑래러럭런렇레려력련렬령례로록론롱뢰료루류륙른를름릉리린림립마막만말망매머먹멀메며면명모목몰몸못무문물미민밀바박반발방배백버번벌범법벽변별병보복본봉부북분불붕비빈빛빠사삭산살삼상새생서석선설섬성세소속손솔송쇄수숙순술숨쉬스슬습승시식신실심십싸쌍쓰씨아악안알암압앙애액야약양어억언얼엄업없에여역연열염엽영예오옥온올옹와완왕외요욕용우운울움웅원월위유육윤율융은을음읍응의이익인일임입잉자작잔잠장재저적전절점접정제조족존종좌죄주죽준중즉증지직진질집징차착찬찰참창채책처척천철첨청체초촉촌총최추축춘출충취측층치칙친칠침칭카타탁탄탈탐탑탕태택터토통퇴투특파판팔패편평폐포폭표품풍피필하학한할함합항해핵행향허헌험혁현혈협형혜호혹혼홍화확환활황회획효후훈훼휘휴흉흐흑흔흥희히',
    ...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㄲㅃㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ',
    'ᄀ',
    'ᄁ',
    'ᅡ',
    'ᅢ',
    'ᆨ',
    'ᆫ',
    'ᆯ',
    'ㅤ',
    'ﾡ',
    'ﾤ',
    '㉠',
    '㈀',
  ],
  kana: [
    ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉっゃゅょゎゕゖ',
    ...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポァィゥェォッャュョヮヵヶヴヷヸヹヺ',
    ...'ｱｲｳｴｵｶｷｸｹｺｯｬｰﾞﾟ',
    ...'ーゝゞヽヾ・゛゜ゟヿ㋐㋑㌀㍿',
    'が',
    'ぱ',
    'ㇰ',
    'ㇱ',
  ],
  bopomofo: [
    ...'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ',
    '˙',
    'ˊ',
    'ˇ',
    'ˋ',
  ],
  han: [
    ...'日本語中文字人大小山川田口目耳手足心水火木金土月年時分上下左右前後東西南北国家学生先会社電話雨雪風花鳥魚犬猫馬牛羊',
    ...'一丁七万丈三上下不与丐丑专且丕世丘丙业丛东丝丞両並个丫中丰串临丸丹为主丼丽举乂乃久么义之乌乍乎乏乐乒乓乔乖乗乘乙九乞也习乡书乩买乱乳乾亀了予争事二亍于亏云互五井亘亙亚些亜亞亟亡交亥亦产亨亩享京亭亮亲亳亵人',
    ...'丂丄丅丆丌丏丒丗丠丨丩丬丮丯丰丱丳丵丷丼乀乁乂乄乆乊乑乕乗乚乛乢乣乤乥乧乨乪乫乬乭乮乯',
    ...'鿐鿑鿒鿓鿔鿕鿦鿧鿨鿩鿪鿫鿬鿭鿮鿯鿰鿿',
    ...'㐀㐁㐂㐃㐄㐅㐆㐇㐈㐉㐊㒨㒩㓁㓂㔾㘝㙇㛃㝵㞢㠯㤅㦲㨋㩧㫖㭍㯤㲋㳄㵕㷍㹴㻏㽞㿵䀝䂊䄀䆗䈥䊷䌫䎆䐈䒖䔢䖝䘚䚵䜣䞞䠊䢁䤆䥑䦦䨻䪝䬤䮮䰠䲝䴚䶵䶶䶿',
    ...'\u{20000}\u{20001}\u{20002}\u{2000B}\u{20089}\u{2070E}\u{20B9F}\u{21EB0}\u{2295F}\u{233B4}\u{24A12}\u{25D10}\u{26C21}\u{27DA0}\u{28E0F}\u{29E3D}\u{2A6D6}\u{2A700}\u{2B740}\u{2B820}\u{2CEB0}\u{2EBE0}\u{30000}\u{31350}\u{2F800}\u{2F801}\u{2FA1D}',
    ...'豈更車賈滑串句龜契金喇奈懶癩羅蘿螺裸邏樂洛烈裂説廓勞爐盧老蘆虜路露魯鷺碌祿綠菉錄鹿論壟弄籠聾牢磊賂雷壘屢樓淚漏累縷陋勒肋凜凌稜綾菱陵讀拏樂諾丹寧怒率異北磻便復不泌數索參塞省葉說殺辰沈拾若掠略亮兩凉梁糧良諒量勵﨎﨏﨑﨓﨔﨟﨡﨣﨤﨧﨨﨩',
    ...'⺀⺁⺂⺃⺄⺅⺆⺇⺈⺉⺊⺋⺌⺍⺎⺏⺐⼀⼁⼂⼃⼄⼅⼆⼇⼈⼉⼊⼋⼌⼍⼎⼏⿕',
    ...'〆〇〡〢〣〤〥〦〧〨〩㆒㆓㆔㆕',
    '\u{17000}',
    '\u{17001}',
    '\u{18800}',
    '\u{1B170}',
    '\u{18B00}',
  ],
  yi: [...'ꀀꀁꀂꀃꀄꀅꀆꀇꀈꀉꀊ'],
  canadian: [...'ᐁᐃᐄᐅᐆᐊᐋᐯᐱᑌᑎᑐᑕᑫᑭᑯᑲ'],
  mongolian: [...'ᠠᠡᠢᠣᠤᠥᠦᠨᠪᠫᠬᠭᠮᠯᠰᠱᠲᠳ', '᠋', '᠎'],
  runic: [...'ᚠᚡᚢᚣᚤᚥᚦᚧᚨᚩᚪᚫᚬ'],
  ogham: [...'ᚁᚂᚃᚄᚅᚆᚇᚈ'],
  deseretOsage: [
    ...'\u{10400}\u{10401}\u{10402}\u{10428}\u{10429}\u{1042A}\u{104B0}\u{104B1}\u{104D8}\u{104D9}',
  ],
  mathAlpha: [
    ...'\u{1D400}\u{1D401}\u{1D41A}\u{1D41B}\u{1D434}\u{1D44E}\u{1D468}\u{1D482}\u{1D49C}\u{1D4B6}\u{1D504}\u{1D51E}\u{1D538}\u{1D552}\u{1D5A0}\u{1D5BA}\u{1D670}\u{1D68A}\u{1D6A8}\u{1D6C2}\u{1D7CE}\u{1D7D8}\u{1D7E2}\u{1D7EC}\u{1D7F6}',
    'ℂ',
    'ℍ',
    'ℕ',
    'ℙ',
    'ℚ',
    'ℝ',
    'ℤ',
    'ℓ',
    '℘',
  ],
  digits: [
    ...'0123456789',
    ...'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९০১২৩৪৫৬৭৮৯๐๑๒๓๔๕๖๗๘๙０１２３４５６７８９',
    ...'\u{1D7CE}\u{1D7CF}\u{1D7D0}\u{1D7D8}\u{1D7E2}\u{1D7EC}\u{1D7F6}\u{104A0}\u{104A1}\u{11066}\u{11067}\u{1E950}\u{1E951}',
    ...'¹²³⁰⁴⁵⁶⁷⁸⁹₀₁₂₃₄½⅓⅔¼¾⅕⅙⅛⅐⅑⅒↉',
    ...'①②③④⑤⑩⑪⑳㉑㊿⑴⑵⒈⒉⓪⓵❶➀🄁🄂',
    ...'ⅠⅡⅢⅣⅤⅥⅩⅬⅭⅮⅯⅰⅱⅲⅳⅴⅹⅼↀↁↂ',
    ...'〇一二三十百千万',
    '1⁄2',
    '3⁄',
  ],
  punctuation: [
    ...' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
    ...'¡¢£¤¥¦§¨©ª«¬®¯°±´µ¶·¸º»¿×÷',
    ...'‐‑‒–—―‖‗‘’‚‛“”„‟†‡•‣․‥…‧‰‱′″‴‵‶‷‸‹›※‼‽‾‿⁀⁁⁂⁃⁄⁅⁆⁇⁈⁉⁊⁋⁌⁍⁎⁏⁐⁑⁒⁓⁔⁕⁖⁗⁘⁙⁚⁛⁜⁝⁞',
    ...'₠₡₢₣₤₥₦₧₨₩₪₫€₭₮₯₰₱₲₳₴₵₸₹₺₽₿',
    ...'←↑→↓↔↕⇐⇒⇔∀∂∃∅∇∈∉∑−∓∕∗∘√∝∞∧∨∩∪∫≈≠≡≤≥⊂⊃⊕⊗⋅⌘⌚⌛⏏⏰─│┌┐└┘├┤■□▪▫▲△▶▷▼▽◆◇○◎●◯★☆☎☐☑☒♠♣♥♦♪♫♭♮♯✓✔✕✖✗✘✝✡✨❄❤❥➔➜⟨⟩⦅⦆〈〉《》「」『』【】〔〕〖〗〘〙〚〛〜〝〞〟〰〽',
    ...'。、・〃〄〓',
    ...'！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～｟｠｡｢｣､･￠￡￢￣￤￥￦',
    ...'︐︑︒︓︔︕︖︗︘︙︰︱︲︳︴︵︶︷︸﹀﹁﹂﹃﹄﹅﹆﹇﹈﹉﹊﹋﹌﹍﹎﹏﹐﹑﹒﹔﹕﹖﹗﹘﹙﹚﹛﹜﹝﹞﹟﹠﹡﹢﹣﹤﹥﹦﹨﹩﹪﹫',
    ...'℃℉№℗℠™Ω℧Å℮ℵ⅍',
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    '　',
    ' ',
    ' ',
    '\t',
    '\n',
    '\r',
    '\u000B',
    '\u000C',
    '\u0085',
    ' ',
  ],
  invisible: [
    '\u0000',
    '\u0001',
    '\u001F',
    '\u007F',
    '\u0080',
    '\u009F',
    '­',
    '͏',
    '؜',
    'ᅟ',
    'ᅠ',
    '឴',
    '᠎',
    '​',
    '‌',
    '‍',
    '‎',
    '‏',
    '‪',
    '‬',
    '‮',
    '⁠',
    '⁡',
    '⁤',
    '⁦',
    '⁩',
    '⁪',
    '⁯',
    'ㅤ',
    '︀',
    '︎',
    '️',
    '﻿',
    'ﾠ',
    '￹',
    '￻',
    '￼',
    '�',
    '\u{1BCA0}',
    '\u{1D173}',
    '\u{E0001}',
    '\u{E0020}',
    '\u{E0061}',
    '\u{E007F}',
    '\u{E0100}',
    '\u{E01EF}',
    '\u{F0000}',
    '',
    '',
    '͸',
    '￾',
    '\u{2FFFE}',
    '\u{E0080}',
  ],
  emoji: [
    ...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗🙂🤗🤩🤔🫡🤨😐😑😶🫥🙄😏😣😥😮🤐😯😪😫🥱😴😌😛😜😝🤤😒😓😔😕🫤🙃🫠🤑😲',
    ...'👍👎👌✌🤞🫰🤟🤘🤙👈👉👆🖕👇☝🫵👋🤚🖐✋🖖👏🙌🫶👐🤲🤝🙏',
    ...'❤🧡💛💚💙💜🖤🤍🤎💔❣💕💞💓💗💖💘💝🩷🩵🩶',
    ...'🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🪱🐛🦋🐌🐞🐜🪰🪲🪳🦟🦗🕷🕸🦂🐢🐍🦎🦖🦕🐙🦑🦐🦞🦀🪼🪸🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🫏🦍🦧🦣🐘🦛🦏🐪🐫🦒🦘🦬🐃🐂🐄🫎🪿',
    ...'⌚⌛⏩⏪⏫⏬⏰⏳◽◾☔☕♈♉♿⚓⚡⚪⚫⚽⚾⛄⛅⛎⛔⛪⛲⛳⛵⛺⛽✅✊✋✨❌❎❓❔❕❗➕➖➗➰➿⬛⬜⭐⭕〰〽㊗㊙',
    ...'🀄🃏🅰🅱🅾🅿🆎🆑🆒🆓🆔🆕🆖🆗🆘🆙🆚🈁🈂🈚🈯🈲🈳🈴🈵🈶🈷🈸🈹🈺🉐🉑',
    '\u{1F3FB}',
    '\u{1F3FC}',
    '\u{1F3FD}',
    '\u{1F3FE}',
    '\u{1F3FF}',
    '👍🏽',
    '👍🏿',
    '❤️',
    '☺️',
    '☺',
    '☺︎',
    '🇳🇿',
    '🇯🇵',
    '🇺🇸',
    '🇦',
    '🇿',
    '👨‍👩‍👧',
    '🏳️‍🌈',
    '🧑🏽‍💻',
    '1️⃣',
    '#️⃣',
    '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    '\u{1FAE9}',
    '\u{1FAC6}',
    '\u{1FA89}',
    '\u{1FADC}',
    '\u{1FADF}',
    '\u{1F7E0}',
    '\u{1F7F0}',
  ],
  compat: [
    ...'ﬀﬁﬂﬃﬄﬅﬆĳĲǆǅǄǉǈǇǌǋǊŉ',
    ...'ＡＢＣａｂｃＺｚ',
    ...'ⓐⓑⓒⒶⒷⒸⓏⓩ⒜⒝🄐🄰🅐🅰',
    ...'ᵃᵇᶜᴬᴮªºⁱⁿₐₑ',
    ...'㎏㎞㎡㏄㍱㍲㋿㍻㍼㍽㍾',
    ...'ℎℏℊℯℴ',
    ...'ﬓﬔﬕﬖﬗ',
    ...'\u{1D400}\u{1D41A}\u{1D5BA}\u{1D670}\u{1D68A}',
    'K',
    'Å',
    'Ω',
    'Ⅻ',
    'ⅻ',
    '…',
    '‥',
    '℻',
    '℡',
    '™',
    '℠',
    '¼',
    '⅟',
    '㏒',
    '㎆',
  ],
};

/**
 * Words the app sorts by name: template names and groups, tags, linked
 * sites, language tags and names, list names, rkeys.
 */
const WORDS = [
  '',
  ' ',
  'a',
  'A',
  'b',
  'B',
  'Thanks',
  'thanks',
  'THANKS',
  'Thanks!',
  'Thanks 🙏',
  'Thank you',
  'thank-you',
  'Thank you',
  'Welcome',
  'welcome back',
  'Welcome, {{their.firstName}}',
  'Replies',
  'replies',
  'Réponses',
  'Reponses',
  'Antworten',
  'Ärger',
  'Arger',
  'Ångström',
  'Angstrom',
  'Øl',
  'Ol',
  'Ölüdeniz',
  'İstanbul',
  'Istanbul',
  'istanbul',
  'ıspanak',
  'Straße',
  'Strasse',
  'STRASSE',
  'Æsir',
  'Aesir',
  'œuvre',
  'oeuvre',
  'ﬁnal',
  'final',
  'Final',
  'Ｆｉｎａｌ',
  'café',
  'café',
  'Café',
  'cafe',
  'CAFE',
  'naïve',
  'naive',
  'résumé',
  'resume',
  'Resume',
  'coop',
  'co-op',
  'co op',
  'co_op',
  'co.op',
  'coöp',
  'a1',
  'a2',
  'a10',
  'a 1',
  'item 2',
  'item 10',
  'Item 2',
  '2026',
  '2026-11-22',
  '2026/11/22',
  '#art',
  '#Art',
  'art',
  'Art',
  '@alice',
  'alice.bsky.social',
  'Alice',
  'alice',
  'Ålice',
  'bob',
  'Bob',
  'example.com',
  'Example.com',
  'example.org',
  'www.example.com',
  'xn--bcher-kva.example',
  'bücher.example',
  'bsky.app',
  'github.com',
  'youtu.be',
  'youtube.com',
  'en',
  'EN',
  'en-US',
  'en-GB',
  'en_US',
  'fr',
  'pt-BR',
  'pt',
  'zh-Hant',
  'zh-Hans',
  'zh',
  'ja',
  'ko',
  'de',
  'und',
  'Moderation list',
  'moderation list',
  'Muted accounts',
  'Art people',
  'art people',
  'Ärzte',
  'Zürich',
  'Zurich',
  'Ελληνικά',
  'ελληνικά',
  'Русский',
  'русский',
  'ёж',
  'еж',
  'Ёлка',
  'Елка',
  'мой',
  'моим',
  'Київ',
  'Кийв',
  'עברית',
  'العربية',
  'أحمد',
  'احمد',
  'فارسی',
  'اردو',
  'हिन्दी',
  'हिंदी',
  'বাংলা',
  'தமிழ்',
  'ไทย',
  'เกม',
  'ขาว',
  'ລາວ',
  '한국어',
  '한글',
  '日本語',
  '日本',
  '中文',
  '漢字',
  '汉字',
  'ひらがな',
  'カタカナ',
  'ｶﾀｶﾅ',
  'かたかな',
  'がっこう',
  'かっこう',
  'カッコウ',
  'コーヒー',
  'こうひい',
  '😀',
  '😀 party',
  '🎉',
  '👍',
  '👍🏽',
  '❤',
  '❤️',
  '🇳🇿',
  'ok👍',
  'ok',
  'OK',
  'Ok',
  'a\tb',
  'a​b',
  'a­b',
  'ab',
  'a-b',
  'a b',
  'a‐b',
  'a–b',
  'a—b',
  'ab‍',
  'ab️',
  '3jzfcijpj2z2a',
  '3jzfcijpj2z2b',
  '3kabcdefghi2a',
  '3JZFCIJPJ2Z2A',
  'self',
  'default',
  'template-1',
  'template_1',
  'template1',
  'Template 1',
  ...LANGUAGE_CODES.map((code) =>
    new Intl.DisplayNames(['en'], { type: 'language' }).of(code),
  ),
];

/**
 * Look-alikes: every pair within a group is compared. Case, accents
 * precomposed and combining, width, compatibility forms, ignorables,
 * contractions and letters ICU weighs as their own.
 */
const GROUPS = [
  tokens('a A á Á à â ä Ä ã å Å ā ą ǎ ạ ả ấ ầ ặ ª ᵃ ａ Ａ ⓐ Ⓐ 𝐚 𝐀 á Á ä å'),
  tokens('ae Ae AE aE æ Æ ǽ ǣ ä aë áe a­e ae​'),
  tokens('ss SS Ss ß ẞ sß ſs ſ s S ſt ﬅ ﬆ st St ST'),
  tokens('o O ö Ö ø Ø ő ǫ ō ô ọ ơ ở º ᵒ ⓞ ｏ ɔ ɵ œ Œ oe OE'),
  tokens('c C ç Ç ć č ĉ ċ ℂ ⓒ ｃ ꞓ ȼ cz ch Ch CH č̣'),
  tokens('d D ď đ Đ ð Ð ɖ ḍ dz Dz DZ ǳ ǲ Ǳ dž Dž DŽ ǆ ǅ Ǆ'),
  tokens('i I ı İ í Í ì î ï ĩ ī į ǐ ỉ ị ⁱ ⓘ ｉ Ｉ ĳ Ĳ ij IJ Ij i̇ İ ι Ι'),
  tokens('l L ł Ł ľ ĺ ļ ŀ Ŀ ḷ ℓ ⓛ ｌ ǉ ǈ Ǉ lj Lj LJ'),
  tokens('n N ñ Ñ ń ň ņ ŉ ŋ Ŋ ⁿ ⓝ ｎ ǌ ǋ Ǌ nj Nj NJ ŉn'),
  tokens('th Th TH þ Þ ŧ t T ţ ť ṭ ⓣ ｔ'),
  tokens('fi fI Fi FI ﬁ ｆi ⓕi ff fF Ff FF ﬀ ffi ﬀi ﬀI ﬃ FFI fl ﬂ ffl ﬄ'),
  tokens('½ 1⁄2 1/2 ¹⁄₂ ⅟2 1 ¹ ₁ ① ⑴ ⒈ ١ ۱ १ ১ ๑ １ 𝟏 Ⅰ ⅰ'),
  tokens('2 ² ₂ ② ٢ ۲ ২ ２ 𝟐 Ⅱ ⅱ 10 1٠ 10​ ⑩ Ⅹ'),
  tokens(
    'и й Й й Й і І ї Ї к мой моим Мой мои йод иод Йошкар Иван Київ Кий їжак іній Ӣ ӣ',
  ),
  tokens('е ё Ё ё Е є Є ж ёж еж ежа ёжа'),
  tokens(
    'ا أ أ إ آ ء ب و ؤ ؤ ؤّ ؤّ وّ ي ئ ى ی ﺍ ﺎ أب اج أحمد احمد إسلام اسم مسؤول مسوق',
  ),
  tokens('ك ک گ ه ة ۀ ہ ھ ے ﻻ لا لأ ﻷ ﷲ الله'),
  tokens('কে কৈ কো কো কৌ কৌ কেক'),
  tokens('கெ கே கை கொ கொ கோ கோ கௌ கௌ கெட'),
  tokens('ဥ ဦ ဦ ဦး'),
  tokens('क क़ क़ ख ख़ कि की कं कँ कः क्ष क्‍ष क्‌ष'),
  tokens('เก ก เ กา ขา แก ไก โก ใก เกา กเ เข'),
  tokens('ເກ ກ ເ ກາ ຂາ ແກ ໄກ ໂກ ໃກ'),
  tokens('か が が カ ガ ｶ ｶﾞ ㋕ ゕ ヵ き キ ｷ かあ かー カー かぁ カァ'),
  tokens('は ば ぱ ハ バ パ ﾊ ﾊﾞ ﾊﾟ ば ぱ ひ'),
  tokens('つ っ ツ ッ ｯ ｼ ゝ ゞ ヽ ヾ ゟ より ヿ コト'),
  tokens('가 각 가 각 ㄱ ㅏ ᄀ ㉠ ㈀ 까 간 가나 가가'),
  tokens(
    '一 二 丁 七 㐀 \u{20000} 乙 人 日 曰 本 木 末 未 豈 豈 更 \u{2F800} 丽 〇 〆 ⼀ ⺀ ㆒',
  ),
  tokens(
    '😀 😁 👍 👍🏻 👍🏽 👍🏿 🏽 ❤ ❤️ ❤︎ 💛 🇳🇿 🇳 🇿 🇳🇿🇯🇵 1️⃣ 1 1⃣ # #️⃣ 👨‍👩‍👧 👨👩👧 👨',
  ),
  tokens(
    'a ab a​b a‌b a‍b a⁠b a﻿b a­b a͏b a️b a\u{E0100}b a\u0000b a\u0001b a\u007Fb a\u{E0061}b',
  ),
  tokens('- ‐ ‑ ‒ – — ― − ﹣ － _ ‗ ﹍ ＿ a-b a‐b a–b a—b a_b ab'),
  tokens("' ’ ‘ ‛ ` ´ ′ ＇ \" “ ” „ ″ ＂ it's it’s its"),
  tokens('. 。 ． ｡ … ‥ .. ... , 、 ， ､ ; ; ； : ：'),
  tokens('$ ＄ ﹩ € £ ¥ ￥ ₹ ¢ ￠ ₩ ￦'),
  tokens('A Ａ 𝐀 𝔄 𝔸 Ⓐ 🄰 🅐 🅰 ᴬ ℀ a/c'),
  tokens('K k K Å å Å Ω ω Ω µ μ µ'),
  tokens('σ ς Σ ϲ Ϲ ό ὸ ό ὸ ᾳ ᾼ ᾳ ι ͅ ΐ ΐ'),
  tokens('ש שׁ שׂ שׁ בּ ב בּ יִ ײ יי'),
  // What measuring the port against Node turned up: contractions no code
  // point decomposes to (l·, ํา, the Tibetan vocalic vowels), canonical
  // ones inside compatibility forms (ﻷ), expansions no decomposition gives
  // (ײ, ༀ, ʩ), accents no mark makes (ß before ſs), cases between a
  // letter's cases (ꟹ, 🆏, ㎩, ﮤ, ㉰, ꙶ, ﬃ, ⅟), marks that are several
  // accents (ﳳ), and contractions across marks that don't block them.
  tokens('l· L· ŀ Ŀ l L l·l ŀl l·· ĺ· l·́'),
  tokens('ํา ำ ໍາ ຳ กำ กํา ກຳ'),
  tokens('ྲཱྀ ཷ ླཱྀ ཹ ྲྀ ྲྀ ླྀ ླྀ ྲཱྀ ླّཱྀ ྲ़ཱྀྀ'),
  tokens('ﻷ لأ ﻻ لا ﻸ ﻹ ﻺ ﻵ لآ ﻼ'),
  tokens('ײ יי ױ וי װ וו ׯ'),
  tokens('ༀ ཨོཾ ཨོ ཨ'),
  tokens('ʩ fŋ ʨ tɕ ꭦ dʐ ʪ ls'),
  tokens('ß ss ſs ſ s ẞ SS sſ Ss ſſ'),
  tokens('œ Œ ꟹ oe OE Oe ɶ'),
  tokens('æ Æ ᷔ 𐞃 ᴭ ae AE Ae ǽ ǣ'),
  tokens('🆏 🅏 WC wc Wc 🆌 ㎩ PA Pa pa'),
  tokens('ﮤ ﮥ ۀ ۀ ۀ'),
  tokens('㉢ ㉰ ᄃ 다 ㉢ￂ ㉢ᅡ ﾷ ﾷￂ'),
  tokens('ﺲﺮ ﴪ سر ﺲ ﺮ ﴎ'),
  tokens('ꙶ ї Ї ї Ї і'),
  tokens('ﬃ ﬀi ﬀ ffi FFI ﬁ fi ﬀI'),
  tokens('⅟2 ½ 1⁄2 ⅟ 1⁄ ⅟₂ ⅟² ⅓ ⅟³ ⅒ ⅟¹0 ⅟10'),
  tokens('㎜ ㎟ ㎜² ㎣ ㎜³ mm² ㎝² ㎠ ㎞ ㎢ ㎞²'),
  tokens('⩵ ⩶ ⩵⁼ ⩵₌ ⩵﹦ ⩵= === ︰ ︙ ︰․ ︰．'),
  tokens('㌔ ㌕ ㌔ｸﾞラム ㌔㋗゙ラム キログラム ㌖ ㌔ﾒートル ㍉ ㍊'),
  tokens('ﳳ ُّ ـُّ ﱡ ﹹ ﹽ ﹹﹽ ﳲ'),
  tokens('ෝ ෝ़ ෝ़ ෝ़ ෝ़ ෝ̴ ෞ'),
];

// The pairs compared, in chunks.
const CHUNK = 100;
const chunks = [];
function addPairs(label, pairs) {
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const part = pairs.slice(i, i + CHUNK);
    chunks.push({
      $id: `${label}#${i / CHUNK + 1}`,
      a: part.map(([x]) => x),
      b: part.map(([, y]) => y),
    });
  }
}

/** Text a little different from `a`: the same letters in another case,
 * accent, width or form, an ignorable put in, a letter changed. */
function mutate(rand, a, pool) {
  const units = [...a];
  const at = rand.int(units.length + 1);
  switch (rand.int(10)) {
    case 0:
      return a.toUpperCase();
    case 1:
      return a.toLowerCase();
    case 2:
      return a.normalize(rand.next() < 0.5 ? 'NFD' : 'NFKC');
    case 3:
      units.splice(at, 0, rand.pick(SCRIPTS.invisible));
      return units.join('');
    case 4:
      units.splice(at, 0, rand.pick(COMBINING));
      return units.join('');
    case 5:
      if (units.length) units[Math.min(at, units.length - 1)] = rand.pick(pool);
      return units.join('');
    case 6:
      return a + rand.pick(pool);
    case 7:
      return units.slice(0, -1).join('');
    case 8: {
      if (!units.length) return a;
      const i = Math.min(at, units.length - 1);
      const c = units[i];
      units[i] = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
      return units.join('');
    }
    default:
      units.splice(at, 0, rand.pick(SCRIPTS.punctuation));
      return units.join('');
  }
}

const COMBINING = [
  '̀',
  '́',
  '̂',
  '̃',
  '̄',
  '̆',
  '̇',
  '̈',
  '̊',
  '̋',
  '̌',
  '̛',
  '̣',
  '̧',
  '̨',
  '̱',
  '̸',
  'ͅ',
  '֑',
  'ִ',
  'َ',
  'ّ',
  'ٔ',
  '़',
  '्',
  '่',
  'ཱ',
  '᪰',
  '᷀',
  '⃐',
  '⃝',
  '⃣',
  '゙',
  '゚',
  '︠',
  '\u{1D165}',
  '\u{1E944}',
];

const wellFormed = (s) => s.toWellFormed();

export default async function cases() {
  chunks.length = 0;
  const rand = seeded(20261122);

  // The app's words, against words a few steps on.
  const words = [];
  for (let i = 0; i < WORDS.length; i += 1)
    for (let j = i + 1; j < WORDS.length; j += 19)
      words.push([WORDS[i], WORDS[j]]);
  addPairs('words', words);

  // Every pair within each group of look-alikes, both ways round for half.
  const groups = [];
  for (const group of GROUPS)
    for (let i = 0; i < group.length; i += 1)
      for (let j = i + 1; j < group.length; j += 1)
        groups.push(
          rand.next() < 0.5 ? [group[i], group[j]] : [group[j], group[i]],
        );
  addPairs('groups', groups);

  // Each script on its own, with digits, spaces and punctuation now and
  // then: fresh pairs, and pairs one change apart.
  const common = [' ', '-', '.', '1', '2', 'a'];
  for (const [name, pool] of Object.entries(SCRIPTS)) {
    const pairs = [];
    const n =
      name === 'han' || name === 'latin' || name === 'emoji' ? 200 : 120;
    for (let i = 0; i < n; i += 1) {
      const draw = () => {
        const length = 1 + rand.int(5);
        let s = '';
        for (let k = 0; k < length; k += 1)
          s += rand.next() < 0.1 ? rand.pick(common) : rand.pick(pool);
        return s;
      };
      const a = draw();
      const b = rand.next() < 0.6 ? mutate(rand, a, pool) : draw();
      pairs.push([wellFormed(a), wellFormed(b)]);
    }
    addPairs(name, pairs);
  }

  // Every script at once.
  const all = Object.values(SCRIPTS).flat();
  const mixed = [];
  for (let i = 0; i < 600; i += 1) {
    const a = rand.string(all, 5);
    const b = rand.next() < 0.5 ? mutate(rand, a, all) : rand.string(all, 5);
    mixed.push([wellFormed(a), wellFormed(b)]);
  }
  addPairs('mixed', mixed);

  // Words with a script's text after them, so the tie is broken late.
  const late = [];
  for (let i = 0; i < 300; i += 1) {
    const w = rand.pick(WORDS);
    const a = w + rand.string(all, 2);
    late.push([wellFormed(a), wellFormed(mutate(rand, a, all))]);
  }
  addPairs('late', late);

  const out = await each('localeCompare', chunks, ({ a, b }) => {
    const result = {
      variant: signs(a.map((x, i) => plain(x, b[i]))),
      base: signs(a.map((x, i) => base(x, b[i]))),
    };
    const locales = {};
    for (const [tag, col] of LOCALES) {
      const variant = signs(a.map((x, i) => col.variant(x, b[i])));
      const baseOrder = signs(a.map((x, i) => col.base(x, b[i])));
      if (variant !== result.variant || baseOrder !== result.base)
        locales[tag] = { variant, base: baseOrder };
    }
    if (Object.keys(locales).length) result.locales = locales;
    return result;
  });

  // Whole lists sorted as the app sorts them: plainly (the composer's
  // language names, the reports' ties) and at base strength (template
  // names), which keeps ties in their order (Array.prototype.sort is stable).
  const lists = [];
  const names = WORDS.slice(-LANGUAGE_CODES.length);
  lists.push({ $id: 'languageNames', list: [...names].reverse() });
  for (let i = 0; i < 24; i += 1) {
    const list = [];
    for (let k = 0; k < 16; k += 1)
      list.push(
        wellFormed(
          rand.next() < 0.5
            ? rand.pick(WORDS)
            : rand.string(rand.pick(Object.values(SCRIPTS)), 4),
        ),
      );
    lists.push({ $id: `list#${i + 1}`, list });
  }
  out.push(
    ...(await each('sort', lists, ({ list }) => ({
      variant: [...list].sort((x, y) => x.localeCompare(y)),
      base: [...list].sort((x, y) =>
        x.localeCompare(y, undefined, { sensitivity: 'base' }),
      ),
    }))),
  );
  return out;
}
