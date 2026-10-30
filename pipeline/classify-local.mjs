// Rule-based severity and theme for non-English headlines. Same ladder as classify.mjs, with word stems per language.
// Latin and Cyrillic stems must start a word; Arabic stems match anywhere because of attached prefixes.
const T = {
  es: {
    kill: 'muert|muri[oó]|murieron|asesin|fallec|mat[oó] |matan|masacr|ejecutad|decapit|cad[aá]ver',
    violence: 'ataque|atentad|bombard|explosi|disparo|balacera|tiroteo|secuestr|rehen|ofensiva|invasi|guerra|misil|dron|enfrentamiento|combate|terroris|sicari|emboscada|apu[nñ]al',
    disaster: 'terremoto|sismo|inundaci|hurac[aá]n|cicl[oó]n|tif[oó]n|tsunami|incendio|deslizamiento|derrumbe|erupci|volc[aá]n|sequ[ií]a|tormenta|accidente|choque|descarril|naufrag',
    health: 'brote|c[oó]lera|[eé]bola|sarampi|malaria|dengue|epidemia|pandemia|viruela|fiebre amarilla|gripe aviar|meningitis',
    hunger: 'hambruna|hambre|desnutrici|inseguridad alimentaria|crisis alimentaria',
    displace: 'refugiad|desplazad|migrante|[eé]xodo|evacuad|asilo|ap[aá]trida',
    unrest: 'protest|manifestaci|disturbio|mot[ií]n|toque de queda|estado de emergencia|estado de excepci|ley marcial|represi|huelga|golpe|levantamiento|gas lacrim',
    mass: 'masacre|genocidio|golpe de estado|fosa com[uú]n|lesa humanidad|limpieza [eé]tnica',
    persecute: 'cristian|iglesia|pastor|obispo|sacerdote|monja|misioner|evang[eé]lic|blasfemia|libertad religiosa|persegu|persecuci',
    harm: 'detenid|arrest|encarcel|prisi[oó]n|condenad|expuls|amenaz|tortur|quemad|prohib|asalt|atac',
    politics: 'elecci|parlamento|ministr|president|gobierno|sanci|cumbre|tratado|alto el fuego|negociaci|diplom|refer[eé]ndum|votaci',
    sport: 'f[uú]tbol|liga |torneo|campeonato|mundial|tenis|baloncesto|b[eé]isbol|concierto|pel[ií]cula|famos|moda|receta|hor[oó]scopo|telenovela'
  },
  fr: {
    kill: 'mort|tu[eé]|tuer|assassin|d[eé]c[eè]s|d[eé]c[eé]d|meurtr|massacr|ex[eé]cut|d[eé]capit|victimes',
    violence: 'attaque|attentat|bombard|explosion|tirs|fusill|enl[eè]v|otage|offensive|invasion|guerre|missile|drone|affrontement|combats|terroris|embuscade|poignard|jihadist|rebelles|milice',
    disaster: 's[eé]isme|tremblement de terre|inondation|ouragan|cyclone|typhon|tsunami|incendie|glissement de terrain|[eé]boulement|[eé]ruption|volcan|s[eé]cheresse|temp[eê]te|accident|collision|d[eé]raill|naufrage|effondrement',
    health: '[eé]pid[eé]mie|chol[eé]ra|ebola|rougeole|paludisme|dengue|mpox|pand[eé]mie|variole|grippe aviaire|m[eé]ningite|lassa|marburg|poliomy|peste',
    hunger: 'famine|faim|malnutrition|ins[eé]curit[eé] alimentaire|crise alimentaire',
    displace: 'r[eé]fugi|d[eé]plac[eé]|migrant|exode|[eé]vacu|asile|apatride',
    unrest: 'manifestation|manifestant|[eé]meute|couvre-feu|[eé]tat d.urgence|loi martiale|r[eé]pression|gr[eè]ve|coup d.[eé]tat|soul[eè]vement|gaz lacrymog|mutinerie',
    mass: 'massacre|g[eé]nocide|coup d.[eé]tat|fosse commune|crimes contre l.humanit|nettoyage ethnique',
    persecute: 'chr[eé]tien|[eé]glise|pasteur|[eé]v[eê]que|pr[eê]tre|religieuse|missionnaire|[eé]vang[eé]lique|blasph[eè]me|libert[eé] religieuse|pers[eé]cut',
    harm: 'arr[eê]t|incarc[eé]r|prison|condamn|expuls|menac|tortur|br[uû]l|interdit|attaqu',
    politics: '[eé]lection|parlement|ministre|pr[eé]sident|gouvernement|sanction|sommet|trait[eé]|cessez-le-feu|n[eé]gociation|diplomat|r[eé]f[eé]rendum|scrutin',
    sport: 'football|ligue|tournoi|championnat|coupe du monde|tennis|rugby|basket|concert|film|c[eé]l[eé]brit|mode|recette|horoscope'
  },
  pt: {
    kill: 'mort|assassin|falec|matou|mataram|massacr|execut|decapit|v[ií]timas',
    violence: 'ataque|atentado|bombard|explos|tiroteio|tiros|sequestr|ref[eé]m|ofensiva|invas[aã]o|guerra|m[ií]ssil|drone|confronto|terroris|emboscada|esfaque|mil[ií]cia|fac[cç][aã]o',
    disaster: 'terremoto|sismo|inunda|enchente|furac[aã]o|ciclone|tuf[aã]o|tsunami|inc[eê]ndio|deslizamento|desabamento|erup[cç][aã]o|vulc[aã]o|seca|tempestade|acidente|colis[aã]o|descarrilh|naufr[aá]gio',
    health: 'surto|c[oó]lera|ebola|sarampo|mal[aá]ria|dengue|epidemia|pandemia|var[ií]ola|febre amarela|gripe avi[aá]ria|meningite',
    hunger: 'fome|desnutri|inseguran[cç]a alimentar|crise alimentar',
    displace: 'refugiad|deslocad|migrante|[eê]xodo|evacua|asilo|ap[aá]trida',
    unrest: 'protesto|manifesta[cç]|manifestante|tumulto|toque de recolher|estado de emerg[eê]ncia|lei marcial|repress[aã]o|greve|golpe|levante|g[aá]s lacrimog',
    mass: 'massacre|genoc[ií]dio|golpe de estado|vala comum|crimes contra a humanidade|limpeza [eé]tnica',
    persecute: 'crist[aã]|igreja|pastor|bispo|padre|freira|mission[aá]r|evang[eé]lic|blasf[eê]mia|liberdade religiosa|persegui',
    harm: 'preso|pris[aã]o|condenad|expuls|amea[cç]|tortur|queimad|proibi|atac',
    politics: 'elei[cç]|parlamento|ministr|president|governo|san[cç]|c[uú]pula|tratado|cessar-fogo|negocia[cç]|diplomat|referendo|vota[cç]',
    sport: 'futebol|liga |torneio|campeonato|copa do mundo|t[eê]nis|basquete|show|filme|celebridade|moda|receita|hor[oó]scopo|novela'
  },
  de: {
    kill: 'tote[nr]? |getötet|tötet|ermordet|starben|todesopfer|massaker|hinricht|enthaupt',
    violence: 'angriff|anschlag|bombard|explosion|schüsse|entführ|geisel|offensive|invasion|krieg|rakete|drohne|gefecht|kämpfe|terror|hinterhalt|miliz|rebellen',
    disaster: 'erdbeben|überschwemm|hochwasser|hurrikan|zyklon|taifun|tsunami|großbrand|waldbrand|erdrutsch|einsturz|vulkan|dürre|sturm|unglück|zusammenstoß|entgleis',
    health: 'ausbruch|cholera|ebola|masern|malaria|dengue|epidemie|pandemie|pocken|vogelgrippe|meningitis',
    hunger: 'hungersnot|hunger|mangelernährung|ernährungsunsicherheit',
    displace: 'flüchtling|vertrieben|migrant|exodus|evakuier|asyl|staatenlos',
    unrest: 'protest|demonstr|unruhen|ausgangssperre|notstand|kriegsrecht|niederschlag|streik|putsch|aufstand|tränengas',
    mass: 'massaker|völkermord|putsch|massengrab|verbrechen gegen die menschlichkeit|ethnische säuberung',
    persecute: 'christ|kirche|pastor|bischof|priester|nonne|missionar|evangelikal|blasphemie|religionsfreiheit|verfolg',
    harm: 'festgenommen|verhaftet|inhaftiert|haft|verurteilt|vertrieben|bedroh|folter|verbrannt|verboten|angegriffen',
    politics: 'wahl|parlament|minister|präsident|regierung|sanktion|gipfel|vertrag|waffenruhe|verhandl|diplomat|referendum',
    sport: 'fußball|bundesliga|turnier|meisterschaft|weltmeisterschaft|tennis|handball|konzert|film|promi|mode|rezept|horoskop'
  },
  ru: {
    kill: 'погиб|убит|убий|гибел|смерт|жертв|расстрел|казн|обезглав|загин|вбит|вбив|страч',
    violence: 'атак|обстрел|бомбардиров|бомбардув|взрыв|вибух|стрельб|стрілянин|похищен|викраден|заложник|заручник|наступлен|вторжен|вторгн|война|війна|ракет|дрон|беспилотник|бпла|столкновен|зіткнен|терроризм|терорист|засад|мятежн|повстан',
    disaster: 'землетрясен|землетрус|наводнен|повінь|ураган|циклон|тайфун|цунами|пожар|пожеж|оползн|зсув|обвал|извержен|виверження|вулкан|засух|посух|шторм|авари|катастроф|крушен|затонул',
    health: 'вспышк|спалах|холер|эбол|ебол|корь|малярия|малярія|денге|эпидеми|епідемі|пандеми|оспа|птичий грипп|менингит',
    hunger: 'голод|недоеда|недоїда|продовольствен',
    displace: 'беженц|біженц|переселен|мигрант|эвакуац|евакуац|убежищ|притулок|апатрид',
    unrest: 'протест|митинг|демонстрац|беспоряд|заворуш|комендантск|чрезвычайн|надзвичайн|военное положение|воєнний стан|репресс|забастовк|страйк|переворот|путч|восстан|слезоточив',
    mass: 'геноцид|переворот|братск.. могил|этническ.. чистк',
    persecute: 'христиан|церков|церква|пастор|епископ|священник|монахин|миссионер|євангел|евангел|богохульств|преследован|переслідуван',
    harm: 'арестов|затрим|задерж|заключ|осужд|выслан|угроз|пытк|сожж|запрет|нападен',
    politics: 'выбор|вибор|парламент|министр|міністр|президент|правительств|уряд|санкци|саммит|саміт|договор|перемири|переговор|дипломат|референдум|голосован',
    sport: 'футбол|лига|ліга|турнир|чемпионат|чемпіонат|теннис|хоккей|концерт|фильм|фільм|гороскоп'
  },
  id: {
    kill: 'tewas|meninggal|dibunuh|pembunuhan|korban jiwa|gugur|dieksekusi|pembantaian|mayat',
    violence: 'serangan|penyerangan|pengeboman|bom\\b|ledakan|penembakan|ditembak|penculikan|disandera|sandera|ofensif|invasi|perang|rudal|drone|bentrok|pertempuran|teroris|penyergapan|penikaman|milisi|pemberontak',
    disaster: 'gempa|banjir|badai|siklon|topan|tsunami|kebakaran|longsor|runtuh|erupsi|gunung berapi|kekeringan|kecelakaan|tabrakan|tenggelam|puting beliung',
    health: 'wabah|kolera|ebola|campak|malaria|demam berdarah|dbd|mpox|epidemi|pandemi|cacar|flu burung|meningitis',
    hunger: 'kelaparan|gizi buruk|krisis pangan|rawan pangan',
    displace: 'pengungsi|pengungsian|migran|eksodus|evakuasi|suaka',
    unrest: 'protes|demo\\b|unjuk rasa|kerusuhan|jam malam|darurat militer|represi|mogok|kudeta|pemberontakan|gas air mata',
    mass: 'pembantaian|genosida|kudeta|kuburan massal|kejahatan terhadap kemanusiaan|pembersihan etnis',
    persecute: 'kristen|gereja|pendeta|uskup|biarawati|misionaris|injili|penodaan agama|kebebasan beragama|persekusi|penganiayaan',
    harm: 'ditangkap|penjara|dihukum|diusir|ancam|siksa|dibakar|dilarang|diserang',
    politics: 'pemilu|parlemen|menteri|presiden|pemerintah|sanksi|ktt|perjanjian|gencatan senjata|negosiasi|diplomat|referendum|pilkada',
    sport: 'sepak bola|liga|turnamen|kejuaraan|piala dunia|tenis|bulu tangkis|konser|film|selebriti|resep|zodiak'
  },
  tr: {
    kill: '[oö]ld[uü]|[oö]l[uü]|[oö]ld[uü]r|hayat[ıi]n[ıi] kaybet|katliam|infaz|can kayb',
    violence: 'sald[ıi]r[ıi]|bomba|patlama|silahl[ıi]|ka[cç][ıi]r|rehine|i[sş]gal|sava[sş]|f[uü]ze|dron|[cç]at[ıi][sş]ma|ter[oö]r|pusu|b[ıi][cç]ak',
    disaster: 'deprem|kas[ıi]rga|f[ıi]rt[ıi]na|tsunami|yang[ıi]n|heyelan|[cç][oö]kt[uü]|yanarda[gğ]|kurakl[ıi]k|kaza|[cç]arp[ıi][sş]|raydan|sel ',
    health: 'salg[ıi]n|kolera|ebola|k[ıi]zam[ıi]k|s[ıi]tma|pandemi|[cç]i[cç]ek|ku[sş] gribi|menenjit',
    hunger: 'k[ıi]tl[ıi]k|a[cç]l[ıi]k|yetersiz beslenme|g[ıi]da krizi',
    displace: 'm[uü]lteci|g[oö][cç]men|s[ıi][gğ][ıi]nmac[ıi]|tahliye|yerinden',
    unrest: 'protesto|g[oö]steri|isyan|soka[gğ]a [cç][ıi]kma|ola[gğ]an[uü]st[uü] hal|s[ıi]k[ıi]y[oö]netim|grev|darbe|ayaklanma|biber gaz',
    mass: 'katliam|soyk[ıi]r[ıi]m|darbe|toplu mezar',
    persecute: 'hristiyan|kilise|papaz|piskopos|rahip|misyoner|evanjelik|inan[cç] [oö]zg[uü]rl|zul[uü]m',
    harm: 'tutuklan|g[oö]zalt[ıi]|hapis|mahkum|s[ıi]n[ıi]r d[ıi][sş][ıi]|tehdit|i[sş]kence|yak[ıi]ld|yasak|sald[ıi]r',
    politics: 'se[cç]im|meclis|bakan|cumhurba[sş]kan|h[uü]k[uü]met|yapt[ıi]r[ıi]m|zirve|antla[sş]ma|ate[sş]kes|m[uü]zakere|diplomat|referandum',
    sport: 'futbol|lig |turnuva|[sş]ampiyona|d[uü]nya kupas|tenis|konser|film|[uü]nl[uü]|moda|tarif|bur[cç]'
  },
  sw: {
    kill: 'kuuawa|waliuawa|vifo|mauaji|alikufa|walikufa',
    violence: 'shambulio|mashambulizi|mlipuko|bomu|risasi|utekaji|mateka|vita|kombora|mapigano|ugaidi|waasi|wanamgambo',
    disaster: 'tetemeko|mafuriko|kimbunga|tsunami|maporomoko|volkano|ukame|dhoruba|ajali|kuzama|moto',
    health: 'kipindupindu|ebola|surua|malaria|dengue|janga|ndui|mafua ya ndege',
    hunger: 'njaa|utapiamlo|ukosefu wa chakula',
    displace: 'wakimbizi|wahamiaji|kuhama|uokoaji|hifadhi',
    unrest: 'maandamano|ghasia|kutotoka nje|hali ya hatari|sheria ya kijeshi|mgomo|mapinduzi|uasi',
    mass: 'mauaji ya kimbari|mapinduzi|kaburi la pamoja',
    persecute: 'wakristo|kanisa|mchungaji|askofu|padri|mmisionari|uhuru wa dini|mateso',
    harm: 'kukamatwa|jela|kifungo|kufukuzwa|vitisho|mateso|kuchomwa|kupigwa marufuku|kushambuliwa',
    politics: 'uchaguzi|bunge|waziri|rais|serikali|vikwazo|mkutano wa kilele|mkataba|usitishaji mapigano|mazungumzo|kidiplomasia|kura ya maoni',
    sport: 'mpira|ligi|michuano|kombe la dunia|tamasha|filamu|mitindo'
  },
  ar: {
    kill: 'قتل|مقتل|قتيل|قتلى|استشهاد|شهيد|وفاة|وفيات|مصرع|اغتيال|مجزرة|إعدام|ضحايا',
    violence: 'هجوم|غارة|غارات|قصف|تفجير|انفجار|إطلاق نار|اختطاف|خطف|رهائن|هجمات|حرب|صاروخ|مسيّر|مسيرة|اشتباك|إرهاب|كمين|طعن|ميليشيا|مسلح|اقتحام',
    disaster: 'زلزال|فيضان|إعصار|تسونامي|حريق|انهيار|انزلاق|بركان|جفاف|عاصفة|حادث|اصطدام|غرق|سيول',
    health: 'تفشي|وباء|كوليرا|إيبولا|حصبة|ملاريا|حمى الضنك|جدري|جائحة|إنفلونزا الطيور|شلل الأطفال|السحايا',
    hunger: 'مجاعة|جوع|سوء التغذية|انعدام الأمن الغذائي',
    displace: 'لاجئ|نازح|نزوح|مهاجر|إجلاء|لجوء|عديمي الجنسية',
    unrest: 'احتجاج|مظاهرات|تظاهر|شغب|حظر التجول|حالة الطوارئ|الأحكام العرفية|قمع|إضراب|انقلاب|انتفاضة|المسيل للدموع',
    mass: 'مجزرة|إبادة|انقلاب|مقبرة جماعية|جرائم ضد الإنسانية|تطهير عرقي',
    persecute: 'مسيحي|كنيسة|قس|أسقف|كاهن|راهبة|مبشر|إنجيلي|ازدراء الأديان|حرية الدين|اضطهاد',
    harm: 'اعتقال|اعتقل|سجن|حكم|طرد|تهديد|تعذيب|حرق|حظر|هاجم',
    politics: 'انتخابات|برلمان|وزير|رئيس|حكومة|عقوبات|قمة|معاهدة|وقف إطلاق النار|مفاوضات|دبلوماس|استفتاء',
    sport: 'كرة القدم|دوري|بطولة|كأس العالم|تنس|حفل|فيلم|مشاهير|موضة|وصفة|أبراج'
  }
};

T.vi = {
  kill: 'ch[ếe]t|t[ửu] vong|thi[ệe]t m[ạa]ng|gi[ếe]t|s[áa]t h[ạa]i|[sđ]ã thiệt mạng|nạn nhân|hành quyết|chặt đầu',
  violence: 't[ấa]n c[ôo]ng|đánh bom|v[ụu] n[ổo]|n[ổo] l[ớo]n|b[ắa]n|b[ắa]t c[óo]c|con tin|chi[ếe]n tranh|t[êe]n l[ửu]a|giao tranh|kh[ủu]ng b[ốo]|phục kích|đâm|phiến quân|dân quân|không kích|oanh tạc|xâm lược',
  disaster: 'đ[ộo]ng đ[ấa]t|l[ũu] l[ụu]t|b[ãa]o|sóng thần|h[ỏo]a ho[ạa]n|ch[áa]y|s[ạa]t l[ởo]|núi l[ửu]a|h[ạa]n h[áa]n|tai n[ạa]n|va ch[ạa]m|ch[ìi]m|đổ s[ậa]p|lốc xoáy|mưa lớn',
  health: 'd[ịi]ch b[ệe]nh|d[ịi]ch t[ảa]|ebola|s[ởo]i|s[ốo]t rét|s[ốo]t xu[ấa]t huy[ếe]t|đ[ạa]i d[ịi]ch|cúm gia c[ầa]m|bùng phát d[ịi]ch|đ[ậa]u mùa|viêm màng não',
  hunger: 'n[ạa]n đói|đói kém|suy dinh dưỡng|khủng hoảng lương thực|mất an ninh lương thực',
  displace: 't[ịi] n[ạa]n|ng[ườu]i t[ịi] n[ạa]n|di t[ảa]n|di c[ưu]|s[ơo] t[áa]n|xin t[ịi] n[ạa]n|không quốc tịch|sơ tán',
  unrest: 'bi[ểe]u t[ìi]nh|b[ạa]o lo[ạa]n|gi[ớo]i nghiêm|t[ìi]nh tr[ạa]ng kh[ẩa]n c[ấa]p|thi[ếe]t quân lu[ậa]t|đình công|đ[ảa]o chính|đàn áp|nổi dậy|hơi cay|đảo chính',
  mass: 'th[ảa]m s[áa]t|di[ệe]t ch[ủu]ng|m[ồo] chôn t[ậa]p th[ểe]|t[ộo]i ác ch[ốo]ng nhân loại|thanh lọc sắc tộc|đảo chính',
  persecute: 'kitô|ki-tô|nhà th[ờo]|m[ụu]c s[ưu]|giám m[ụu]c|linh m[ụu]c|nữ tu|truyền giáo|tin lành|t[ựu] do tôn giáo|đàn áp tôn giáo|bách hại|phỉ báng',
  harm: 'b[ắa]t gi[ữu]|b[ắa]t|t[ùu]|k[ếe]t án|tr[ụu]c xu[ấa]t|đe d[ọo]a|tra t[ấa]n|đ[ốo]t|c[ấa]m|t[ấa]n c[ôo]ng',
  politics: 'b[ầa]u c[ửu]|qu[ốo]c h[ộo]i|b[ộo] tr[ưu][ởo]ng|t[ổo]ng th[ốo]ng|chính ph[ủu]|tr[ừu]ng ph[ạa]t|h[ộo]i ngh[ịi] th[ưu][ợo]ng đ[ỉi]nh|hi[ệe]p ư[ớo]c|ng[ừu]ng b[ắa]n|đàm phán|ngo[ạa]i giao|tr[ưu]ng c[ầa]u|thủ tướng',
  sport: 'bóng đá|gi[ảa]i vô đ[ịi]ch|world cup|tennis|hòa nh[ạa]c|phim|ngôi sao|thời trang|công th[ứu]c|tử vi|ca sĩ'
};
const NOLEFT = new Set(['ar']);
const RX = {};
for (const [lang, groups] of Object.entries(T)) {
  RX[lang] = {};
  for (const [k, v] of Object.entries(groups)) RX[lang][k] = new RegExp((NOLEFT.has(lang) ? '' : '(?<![\\p{L}])') + '(?:' + v + ')', 'iu');
}
const KILL_NEAR = lang => new RegExp('(\\d[\\d.,]*)\\s{0,3}(?:\\p{L}+\\s+){0,2}(?:' + T[lang].kill + ')|(?:' + T[lang].kill + ')\\p{L}*\\s{0,3}(?:\\p{L}+\\s+){0,2}(\\d[\\d.,]*)', 'iu');
const NEAR = Object.fromEntries(Object.keys(T).map(l => [l, KILL_NEAR(l)]));

export const LANG_NAME = { es: 'Spanish', fr: 'French', pt: 'Portuguese', de: 'German', ru: 'Russian or Ukrainian', id: 'Indonesian', tr: 'Turkish', sw: 'Swahili', ar: 'Arabic', vi: 'Vietnamese' };
export const supports = lang => !!RX[lang];

export function classifyLocal(title, summary, lang) {
  title = title.normalize('NFC'); summary = summary.normalize('NFC');
  const r = RX[lang];
  const h = title, t = title + ' . ' + summary.slice(0, 240);
  const hard = r.kill.test(h) || r.violence.test(h) || r.disaster.test(h) || r.health.test(h);
  const th = r.persecute.test(t) && (r.harm.test(t) || r.violence.test(t) || r.kill.test(t)) ? 'persecution'
    : r.health.test(t) ? 'health' : r.disaster.test(t) ? 'disaster' : r.hunger.test(t) ? 'hunger'
    : r.violence.test(t) ? 'conflict' : r.displace.test(t) ? 'displacement' : r.unrest.test(t) ? 'unrest' : r.politics.test(t) ? 'politics' : 'other';
  if (r.sport.test(h) && !hard) return { s: 1, th: 'other' };
  let n = 0;
  const m = t.match(NEAR[lang]);
  if (m) n = parseInt(String(m[1] || m[2]).replace(/[.,]/g, ''), 10) || 0;
  if (n >= 1900 && n <= 2100) n = 0; // a year, not a casualty count
  let s;
  if (r.mass.test(h)) s = 5;
  else if (n >= 100 && n < 100000 && r.kill.test(h)) s = 5;
  else if (n >= 10 && r.kill.test(h)) s = 4;
  else if (r.kill.test(h) && (r.violence.test(t) || r.disaster.test(t))) s = 4;
  else if (th === 'persecution' && (r.harm.test(h) || r.kill.test(h))) s = 4;
  else if (r.disaster.test(h) && r.kill.test(t)) s = 4;
  else if (r.health.test(h) || r.hunger.test(h)) s = 4;
  else if (r.violence.test(h) || r.disaster.test(h) || r.displace.test(h) || r.unrest.test(h)) s = 3;
  else if (th === 'persecution') s = 3;
  else if (r.politics.test(h)) s = 2;
  else s = 1;
  return { s, th };
}
