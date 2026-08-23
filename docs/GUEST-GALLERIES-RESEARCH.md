# Svatba z 80 telefonů

Tržní rešerše, roundtable a copy deck, ze kterých vzešel [`docs/GUEST-GALLERIES.md`](./GUEST-GALLERIES.md).
Původně artifact z 2026-08-23 (`claude-ai-code-artifact-8f6b132f-3446-4567-b2e2-7e554429bf99`), teď
kopie v repu, aby šla verzovat a aktualizovat spolu s kódem. Ceny a limity konkurence jsou odečtené
k 23. 8. 2026 — časem zastarají, GUEST-GALLERIES.md je zdroj pravdy pro to, co je _postavené_.

## Závěr napřed (§01)

Trh je hotový a levný. Vyhrát se na něm nedá funkcí „hosté nahrávají přes QR“ — tu má každý. Dá se vyhrát tím, co žádný z těch nástrojů nemá: fotografa na druhém konci a galerii, která nezmizí za 60 dní.

**Trh:** 5 CZ / 12+ svět

Funkčně skoro identických služeb. QR, bez appky, bez účtu, ZIP — to je dnes vstupenka, ne výhoda.

**Cena:** 179–990 Kč

Jednorázově za jednu svatbu v ČR ($29–99 venku). Nikdo neúčtuje za hosta. Prostor pro nový placený produkt je malý.

**Slabina všech:** 14–90 dní

Typická retence v ČR. Pár si album stáhne, službu zapomene. Nulová vazba na finální fotky od fotografa.

**Náš náskok:** Jedna adresa

Za QR kódem roste rozcestník: fotky od hostů večer, výběr za tři dny, kompletní set za tři týdny. Stejný odkaz, oddělené galerie.

### Doporučení

1. **Stavět, ale ne jako samostatný produkt.** Host mode je funkce existující galerie, ne druhá aplikace. Sdílíme s ní token, grid, lightbox, ZIP, offline i notifikace.
2. **Nabízet zdarma jako bonus k full-day balíčku.** Cena, kterou by šlo vybrat (cca 700 Kč), je menší než hodnota toho, že 80 lidí ze svatby stráví týden v _tvé_ galerii pod _tvou_ doménou.
3. **MVP je úzké:** nahrávání hostem, kvóta, moderace a živá projekce. Video a tisková grafika jsou samostatná rozhodnutí, ne součást první verze.
4. **Retence je produkt.** Držet galerii rok, ne 60 dní — a dát lidem důvod se vrátit tím, že za stejným odkazem postupně přibývají další galerie ( §07). To je jediná věc v celém srovnání, kterou zákazník pocítí a konkurence ji nedodá bez zdražení.

## Co se dnes prodává v Česku (§02)

Pět služeb obsluhuje celý český trh, všechny s prakticky stejným popisem: naskenuj QR, nahraj z prohlížeče, bez aplikace, bez registrace. Rozdíly jsou v limitech a době uchování — tedy v tom, co si zákazník přečte až po nákupu.

| Služba            | Cena                  | Limit obsahu                                      | Retence                                                     | Co má navíc                                                                            | Kde tlačí bota                                                              |
| ----------------- | --------------------- | ------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Snapshare.cz      | 290 / 690 / 990 Kč    | 150 / 1 000 / ∞ souborů                           | 30 / 90 / 180 dní nahrávání<br>30 / 180 / 365 dní stahování | Plné rozlišení, video, ZIP automaticky po uzavření alba, 2–9 tiskových šablon s QR     | Moderace jen na vyžádání e-mailem — pořadatel sám nemaže                    |
| FotoDrop.cz       | zdarma / 179 Kč       | 100 fotek / „běžná svatba“<br>video do 100–500 MB | 14 / 90 dní<br>(od první fotky)                             | Premoderace („soukromý sběr“), slideshow na TV, vlastní vzhled, kniha hostů +99 Kč     | Fotky se zmenšují na 4 000 px — originál nedostaneš. Tiskoviny si řešíš sám |
| OnlineSvatba.cz   | zdarma / 369 / 479 Kč | ∞ fotek, 30 GB videa (∞ u top)                    | 60 dní + prodloužení                                        | EU servery, ZIP, QR kartičky, řazení podle času pořízení, host smaže svou fotku do 6 h | Zdarma verze dává vodoznak a nižší kvalitu                                  |
| ShareLove.cz      | 730 Kč                | ∞ (fotky i videa)                                 | 14 dní nahrávání<br>60 dní album                            | Plná kvalita, ZIP, šablona QR k tisku                                                  | Jeden tarif, žádná moderace ani projekce                                    |
| MomentsForLove.cz | free plán + placené   | podle plánu                                       | neuvedeno                                                   | Živá projekce fotek a videí během party, moderace, statistiky zhlédnutí                | Nový hráč, ceník na webu nedostupný bez kontaktu                            |
| Svatbaa.cz        | 1 390 Kč              | —                                                 | neuvedeno                                                   | QR sdílení jako přílepek ke svatebnímu webu                                            | Prodává web, galerie je bonus — opačný model než náš                        |

Ceny a limity odečteny z veřejných ceníků 23. 8. 2026. MomentsForLove a Momentu.cz blokují automatizované čtení (HTTP 403), údaje o nich pocházejí z popisu ve vyhledávání — před citováním navenek je nutné ověřit ručně.

## Co se prodává venku (§03)

Zahraniční trh je o dva roky napřed a ukazuje, kam to jde: od „úložiště fotek“ k **zážitku během svatby** — živý feed, projekce, kniha hostů, RSVP — a k **AI dohledávání**, aby host našel sám sebe.

| Služba             | Cena                      | Přístup             | Retence                           | Charakteristická funkce                                                                               |
| ------------------ | ------------------------- | ------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GuestPix           | $49–177                   | QR / PIN, bez appky | 3 měs. upload / 12 měs. hosting   | **180+ editovatelných Canva šablon** na cedule s QR, video kniha hostů, RSVP pozvánka, silná moderace |
| Kululu             | $39–79                    | QR, bez appky       | 6 měsíců                          | Feed ve stylu sociální sítě, textové příspěvky, živá projekce na plátno                               |
| GuestCam           | $35–85                    | QR / odkaz          | 12 měsíců                         | MagicFind — rozpoznání obličeje, host si vyfiltruje vlastní fotky                                     |
| Wedibox            | $59–99                    | QR                  | 3–6 měsíců                        | QR jako rozcestník: fotky + kniha hostů + RSVP + zasedací pořádek                                     |
| POV                | $34                       | vyžaduje aplikaci   | neuvedeno                         | Jednorázový foťák: omezený počet snímků na hosta, odhalí se až po svatbě                              |
| PixelParty         | $20–200                   | QR                  | 6 měs. upload / 12 měs. stahování | Nejširší škálování tarifů, originály i v základu                                                      |
| WedUploader        | $24–69                    | QR / URL            | tvůj Google Drive                 | Nahrává rovnou do Drivu páru — nula nákladů na úložiště                                               |
| Joy, The Knot Live | zdarma se svatebním webem | vyžaduje aplikaci   | dokud žije účet                   | Zdarma, ale agresivní komprese a špatný export                                                        |
| Honcho             | $39/měs.                  | aplikace + tether   | předplatné                        | **Pro fotografy:** snímky z foťáku tečou do cloudu během focení, živá projekce, rozpoznání obličejů   |

Údaj, který se táhne všemi srovnávacími články: prohlížečové QR služby hlásí **65–85 % účasti hostů**, aplikace vyžadující instalaci **30–45 %**. Pozor — čísla publikují sami dodavatelé v marketingových srovnáních, nezávislý zdroj neexistuje. Směr je ale konzistentní a shoduje se s tím, co dává smysl: instalace aplikace na svatbě je bariéra, kterou většina hostů nepřekoná.

**Co si z toho brát.** Základ (QR, bez appky, bez účtu, ∞ hostů, ZIP) je povinná výbava. Prodávají se tři nadstavby: **projekce během večera**, **moderace** a **hotová grafika k tisku**. GuestPix má 180 Canva šablon a staví na tom celý marketing — což potvrzuje, že Pavlův nápad s vygenerovanou grafikou není doplněk, ale prodejní argument.

## Kulatý stůl (§04)

Šest lidí, jedna otázka: jak z g-gallery udělat galerii, do které svatebčan nahraje fotku dřív, než mu dojde baterka.

**Marek** — _Product manager_

Nesmíme si namlouvat, že stavíme nový produkt. Stavíme _akviziční kanál_. Osmdesát lidí ze svatby otevře odkaz na naší doméně, stráví v něm dohromady pár hodin a dvacet z nich se bude příští rok ženit nebo vdávat. To je hodnota, kterou 700 Kč za album nikdy nedožene.

Z toho plyne jediná metrika, na které záleží: **kolik procent hostů nahrálo aspoň jednu fotku**. Ne počet fotek, ne velikost alba. Když bude 70 %, funguje to. Když 20 %, postavili jsme drahý ZIP.

**Pavel** — _Owner / fotograf_

Souhlasím, ale mám k tomu vlastní zájem, který je potřeba pojmenovat nahlas: **já ty fotky od hostů chci.** Vidí věci, u kterých nejsem — přípravu u nevěsty po mém odchodu, dvě ráno na parketu, historky u stolu. Když je mám v jedné galerii se svými, je výsledek pro pár úplnější než cokoliv, co dodám sám.

A druhá věc: nechci provozovat čtvrtou službu. Musí to sedět do toho, co je postavené. Když to znamená nový deploy, nový billing a nová doména, nedělám to.

**Tomáš** — _Vývojář_

Dobrá zpráva: většina toho už stojí. Sdílený odkaz s hashovaným tokenem, heslem a expirací máme (`src/lib/share-access.ts`). Identitu diváka bez účtu máme — `Viewer.anonKey` v localStorage plus dobrovolné jméno. Presignovaný PUT do R2, CRC32 v prohlížeči, strip GPS z EXIF, obnovení přerušeného uploadu — všechno je v `src/components/uploader.tsx`.

Chybí v podstatě jedno: `/api/uploads/presign` dnes volá `requireAdmin()`. Musí umět druhou cestu — ověřit share token přes `resolveShareLink` a podepsat upload do prefixu galerie. To je den práce. **Zbytek jsou kvóty, moderace a náklady**, a to je zbývajících devadesát procent.

A jedna věc, kterou navrhuju hned: **thumbnail si vyrobí telefon**. Fotku už drží v paměti, zmenšení na 512 px stojí nic a nahraje se spolu s originálem. Ušetří to transformace na Cloudflare a hlavně to dá grid, který na venue s jednou čárkou signálu vůbec naskočí.

**Klára** — _QA_

Já mám tři scénáře, které to rozbijí, a ani jeden nezachytí unit test.

**Za prvé iPhone a HEIC.** Půlka hostů má fotky ve formátu, který si naše validace `image/(jpeg|png|webp|avif)` odmítne vzít. Safari to někdy převede samo, podle nastavení telefonu, které uživatel nikdy neviděl. „Někdy“ je v QA sprosté slovo.

**Za druhé signál.** Zámek, stodola, sklep. Dvacet lidí naráz nahrává přes jednu LTE buňku. Potřebuju frontu, která přežije zamčení displeje a přepnutí aplikace, a stav, který hostovi řekne pravdu — ne spinner, který se točí do prázdna.

**Za třetí video.** Host nerozlišuje fotku a video, prostě označí, co má v roli filmu. Když video nepodpoříme, musí to říct _před_ výběrem, ne po dvouminutovém uploadu.

**Lucie** — _Copywriterka_

Celá tahle věc stojí a padá s jednou cedulkou na stole a třemi obrazovkami v mobilu. Host jí věnuje čtyři vteřiny, v ruce má skleničku a je zrovna uprostřed rozhovoru.

Takže žádné „naskenujte QR kód pro vstup do sdílené galerie“. To je popis funkce, ne důvod. Důvod je: _máš v telefonu fotku, kterou nikdo jiný nemá._ A instrukce musí být tři slova, ne odstavec.

Ještě jedna věc — jméno. Když se po nahrání zeptáme „kdo jsi?“, není to kvůli statistice. Je to proto, aby si pár za měsíc otevřel album a viděl _od koho_. Tohle je moment, kde se z úložiště stane vzpomínka, a stojí za to ho napsat pořádně.

**Klára** — _QA_

Ještě něco, co není technické, ale je to riziko: jakmile může nahrávat kdokoliv s odkazem, je to **anonymní zápisový endpoint do našeho úložiště**. Odkaz se snadno předá dál. Potřebujeme strop na galerii, strop na jeden `anonKey`, a hlavně možnost, aby pár nevhodnou fotku sám a hned smazal — bez psaní e-mailu podpoře, jak to má Snapshare.

**Marek** — _Product manager_

Souhlas, a přidávám režim, který má FotoDrop a je chytrý: **premoderace jako volba páru.** Někdo chce, aby se fotky objevovaly hned a bavilo to lidi během večera. Někdo chce sbírat potichu a album pustit až druhý den. Obojí je legitimní a rozdíl je jeden boolean.

**Tomáš** — _Vývojář_

Poslední věc ode mě, protože je to jediná, která může ekonomicky bolet. Cloudflare Image Transformations mají zdarma 5 000 unikátních transformací měsíčně. Osm set fotek od hostů krát tři varianty je 2 400 — **jedna svatba sní polovinu měsíčního rámce**. Dvě svatby v jednom měsíci a platíme.

Proto ten klientský thumbnail. Když si telefon vyrobí náhled sám, jde přes transformace jen to, co někdo doopravdy otevře na celou obrazovku. To není optimalizace, to je předpoklad, aby to bylo zdarma.

**Pavel** — _Owner / fotograf_

Beru. A rozhoduju takhle: **první verze je bez videa.** Ne proto, že by ho lidi nechtěli, ale protože přehrávání, náhledy a přenosová data jsou samostatný projekt. Radši jednu věc, která funguje na každém telefonu, než dvě, které padají.

## Nevěsta ve třech časech (§05)

Eliška, 31, vdává se v srpnu na zámku v Podkrkonoší, 78 hostů. Není to persona z výzkumu — je to seznam věcí, které to rozbijí.

T−30 dní _plánování_

> „Hlavně ať nikdo nemusí nic instalovat. Babička má tlačítkový telefon a teta se bojí, že jí ukradnou účet.“

**Co z toho plyne:** žádná aplikace, žádná registrace, žádné přihlášení. Odkaz musí fungovat i ve starém Chromu na Androidu 9. A musí existovat verze cedulky, kterou pochopí člověk, co QR kód nikdy neskenoval — tedy s větou „namiřte na to foťák v telefonu“.

Den D _19:40, po přípitku_

> „Nikdo nebude na svatbě čumět do telefonu čtyřicet vteřin, než se to nahraje. A na zámku není wifi.“

**Co z toho plyne:** nahrávání běží na pozadí a přežije zamčení telefonu. Host vidí okamžité potvrzení („mám to, dodělám to sám“) a může telefon odložit. Fronta se dokončí, až bude signál. Bez toho je celá funkce k ničemu přesně v ten jediný večer, kdy má fungovat.

T+7 dní _neděle večer_

> „Chci to poslat mámě, chci si to stáhnout celé, a chci vyhodit ty tři fotky, kde tancuje švagr na stole.“

**Co z toho plyne:** ZIP celého alba (máme rozpracovaný), mazání jednotlivých fotek párem bez psaní podpoře, a přeposílatelný odkaz. A hlavně: za tři týdny přibude na stejný rozcestník druhá galerie od fotografa — takže odkaz, který Eliška poslala mámě, se sám o sobě zhodnotí. To je celá pointa.

## Návrh produktu: režim „hosté“ (§06)

Není to nová aplikace ani nová galerie. Je to **vlastnost sdíleného odkazu**: existující `ShareLink` dostane příznak, že přes něj lze i nahrávat. Všechno ostatní — mřížka, lightbox, reakce, oblíbené, ZIP, offline režim — funguje tak, jak funguje dnes.

#### Vstup

QR na cedulce → `/g/{token}/{slug}`. Žádné přihlášení. První obrazovka je galerie, ne formulář. Tlačítko „Přidat fotky“ je fixní ve spodní liště, palcem dosažitelné.

#### Nahrání

Systémový výběr souborů nebo přímo foťák (`capture`). Telefon spočítá CRC32, vyhodí GPS z EXIF a vyrobí náhled 512 px — všechno už máme v uploaderu. Nahrává se na pozadí, s frontou a obnovením.

#### Identita

Po prvním nahrání jedna otázka: „Jak se jmenuješ?“ Uloží se do `Viewer.displayName`, který už existuje. Fotky se seskupí podle autora — pro pár je to hodnota, pro nás moderační nástroj.

#### Moderace

Dva režimy podle volby páru: _rovnou viditelné_ (baví lidi během večera) nebo _soukromý sběr_ (host nahraje, vidí to jen pár). Skrytí a smazání jednou klepnutím v adminu.

#### Projekce

Samostatná adresa `/g/{token}/show` — celá obrazovka, žádné ovládání, nové fotky naskakují živě. Supabase Realtime už v projektu je (`src/lib/realtime-channel.ts`), takže je to hlavně otázka jedné stránky.

#### Místo v rozcestníku

Galerie od hostů je jedna z několika galerií jedné svatby. Zůstává oddělená od fotografových setů, ale vede k ní stejný odkaz. Podrobně v oddílu §07.

### Vědomě mimo první verzi

- **Video.** Chce ho každý host a má ho každý konkurent, ale znamená to přehrávač, náhledy, transkódování a přenosová data — samostatný projekt. Do té doby to musí být řečeno _před_ výběrem souboru, ne po něm.
- **Kniha hostů a RSVP.** Wedibox a GuestPix z toho dělají rozcestník celé svatby. Zajímavé, ale odvádí to od jádra a k fotografii to nepatří.
- **Rozpoznání obličejů.** „Najdi sebe“ je venku silný prodejní argument (GuestCam), ale u 78 hostů to hodnotu nepřidá a biometrika v GDPR je vlastní kapitola.
- **Tisková grafika.** Podle zadání teď neřešíme — ale z rešerše plyne, že to není doplněk. GuestPix jich má 180 a staví na tom kampaň. Až na to dojde, je to prodejní argument, ne cedulka.

## Rozcestník: jedna svatba, víc galerií (§07)

Galerie zůstávají oddělené — a mají zůstat. Nad nimi vzniká **svatba**: jedno místo, kam vede QR kód a které v čase roste. Pár si přitom sám určí, co z toho kdo uvidí.

### Jak to vidí pár

Jedna stránka svatby, nezalistovaná — kdo dostane odkaz, ten dovnitř. Nadpis nese identitu svatby, karty pod ním jsou krátké. To je záměr: v zadání zněly všechny tři galerie jako _„12\. 8. 2026 Pavel a Patricie, Statek Benice — od lidí / 1. set / full set“_, jenže na telefonu je to třikrát pod sebou stejný odstavec a rozdíl je až na jeho konci. Identita patří do hlavičky, karty rozlišuje to, čím se liší.

| Karta         | Popisek pod ní        | Kdy se objeví           | Nahrávání |
| ------------- | --------------------- | ----------------------- | --------- |
| Od hostů      | 412 fotek · přibývají | od začátku, QR na stole | ano       |
| První výběr   | 30 fotek · 15. 8.     | +3 dny                  | ne        |
| Kompletní set | 500 fotek · 2. 9.     | +3 týdny                | ne        |

Adresa: `photos.svatebni-fotograf-cechy.cz/s/{token}/pavel-a-patricie-statek-benice-2026-08-12`. Hlavička stránky: **Pavel a Patricie** · 12\. 8. 2026 · Statek Benice. Nezalistovaná znamená _není dohledatelná_ — ne _zabezpečená_; odkaz se přeposílá dál a musí se tak i pojmenovat směrem k páru.

### Model

Nový záznam `Event` (svatba) s vlastním tokenem je rodičem galerií. `Gallery.eventId` je nepovinné, takže dnešní samostatné galerie fungují dál. A hlavně: **`ShareLink` se nemění vůbec.** Jeden odkaz pořád znamená jednu galerii — přesně to, co je dnes v produkci na `/g/{token}/{slug}`.

Celý přístupový model jsou **dva nezávislé přepínače**:

| Přepínač              | Co znamená                                 | Koho se týká                        |
| --------------------- | ------------------------------------------ | ----------------------------------- |
| Galerie má živý odkaz | dostane se do ní každý, kdo drží ten odkaz | komu pár odkaz na galerii přeposlal |
| `listedOnEvent`       | je jako karta na stránce svatby            | každý, kdo drží odkaz na svatbu     |

Tím padá celý jeden podsystém, který jsem navrhoval předtím: **seznam odemčených galerií na odkazu je zbytečný.** Případ, kvůli kterému existoval — babička vidí kompletní set, osmdesát hostů ne — vypadne z modelu zadarmo. Pošle se jí odkaz té galerie a na stránku svatby se nedostane, protože token svatby je jiné tajemství, které nikdy nedostala.

- Odebrání karty ze svatby _neruší_ odkaz galerie a zrušení odkazu _neodebírá_ kartu. Dva přepínače, dva účinky. V administraci je „odebrat ze stránky svatby“ jedno tlačítko, které udělá obojí, ale stav pod tím zůstává poctivý.
- Galerie může mít víc odkazů (jeden s heslem, jeden bez). `eventLinkId` říká, na který z nich karta míří, místo aby to stránka hádala.
- Heslo, expirace a revokace zůstávají na odkazu galerie — tam, kde už dnes jsou. Na úrovni svatby se v první verzi nic neodemyká.

### Jak se to plní

Tohle je ta část, kvůli které to celé stojí za práci: **URL na cedulce se nikdy nezmění, mění se jen to, co za ním je.**

Den D _QR na stole_

> Existuje jediná galerie — „Od hostů“.

**Co host vidí:** rovnou tu galerii, žádný rozcestník s jednou kartou. Když odkaz odemyká právě jednu galerii, otevře se přímo. Rozcestník naskočí sám, jakmile přibude druhá.

+3 dny _první set_

> Přidáš galerii „Výběr“ — 30 fotek — a zapneš ji na hostitelském odkazu.

**Co se stane:** stejná adresa, kterou si hosté uložili, teď ukazuje dvě karty. Kdo má zapnuté oznámení, dozví se to; ostatní to najdou, až se vrátí pro své fotky. Tohle je návratový důvod, který dnes na trhu nikdo nemá.

+3 týdny _kompletní set_

> Přibude „Kompletní“ — 500 fotek. Odkaz pro pár ji vidí okamžitě.

**Rozhodnutí páru:** zapnout ji i hostům? Zapnout jen rodině zvlášť? Nezapnout vůbec? Všechny tři odpovědi jsou legitimní a všechny tři jsou jeden přepínač u jednoho odkazu. Nic se nekopíruje a fotky se nikam nepřesouvají.

### Adresy

- `/g/{token}/{slug}` — **beze změny.** Přeposílatelná adresa jedné galerie, která už dnes běží v produkci. Každá galerie pod svatbou jednu takovou má a karty na stránce svatby míří rovnou na ni.
- `/s/{token}/{slug}` — **nová stránka svatby.** Stejný tvar, stejná pravidla: token řeší přístup, koncový segment je kosmetický a nikdy se neparsuje.

Protože galerie bydlí na vlastních `/g/` adresách, stránka svatby nikdy nepotřebuje třetí významový segment — a pravidlo „slug nic neznamená“ z `docs/TODO.md` §6 platí beze zbytku pro obě trasy. Slug se tvoří stejně jako dnes (`src/lib/gallery-slug.ts`: název, pak ISO datum), takže adresa svatby vypadá jako `/s/{token}/pavel-a-patricie-statek-benice-2026-08-12` a sedí ke galeriím vedle sebe.

**Žádné přesměrování do galerie.** Když má svatba jedinou zalistovanou galerii, stránka svatby vykreslí její mřížku rovnou v sobě — nepřesměruje na `/g/`. Přesměrování by v ten jediný večer, kdy si osmdesát lidí odkaz ukládá, rozdalo adresu, které už nikdy nemůže přibýt druhá karta. Na ceduli, v záložce i v rodinném chatu musí skončit `/s/`.

### Galerie přicházejí a mizí

Galerie pod svatbou vznikají a zanikají — první výběr může být po měsíci stažený, kompletní set přibude, „od hostů“ se po roce zavře. Z toho plyne jediné pravidlo, ale důležité: **stabilní adresa je stránka svatby, ne galerie.** Cedule, záložka i odkaz v rodinném chatu míří na svatbu.

- Odebraná galerie nesmí končit chybovou stránkou. Přesměruje na svatbu s větou, že tahle část už není dostupná.
- Když má svatba právě jednu zalistovanou galerii, stránka svatby vykreslí její mřížku v sobě — bez přesměrování. QR tedy na svatební noc vede přímo do nahrávání, ale v adresním řádku pořád stojí `/s/`, takže co si lidi uloží, je stránka svatby.
- Servisní worker už dnes zahazuje offline kopii galerie, když stránka vrátí 403/404/410 (`public/sw.js`). Musí to samé udělat i pro galerii odebranou ze svatby.
- Nová galerie u svatby, kterou už lidi znají, je notifikační událost — nikoliv tichá změna.

### PIN: ano, ale ne tady a ne teď

Zamknout jednotlivou galerii PINem dává smysl jako **sociální brzda**, ne jako zabezpečení. Odkaz je neuhodnutelný sám o sobě; PIN nechrání před uhodnutím, chrání před nechtěným přeposláním. To je legitimní funkce, ale musí se tak i pojmenovat — čtyřmístné číslo napsané na kartičce a nasdílené v rodinné skupině není přístupové právo.

Tři věci, které je potřeba vyřešit dřív, než to zapneme:

- **Na galerii od hostů nikdy.** Ve chvíli, kdy má host mezi sebou a nahráním fotky ještě jedno číslo, účast padá — a účast je jediná metrika, na které tady záleží.
- **Zamykání je dnes společné pro celý odkaz.**`failedUnlockAttempts` a `unlockLockedUntil` jsou sloupce na `ShareLink` (`src/lib/share-access.ts`), takže pět chybných pokusů zamkne odkaz _všem_. U klientské galerie, kam chodí dva lidi, to nevadí. U svatby s osmdesáti hosty je to zbraň, kterou proti nám nechtěně použije první strýc s brýlemi na čtení. Před PINem se počítadlo musí přesunout na diváka (`anonKey`), ne na odkaz.
- **Čtyři číslice je 10 000 možností.** S dnešním zamykáním je útok otázkou týdnů, ne minut, ale jistota to není. Buď delší kód, nebo počítadlo na diváka plus strop na galerii — nejlépe obojí.

Levnější a v praxi dostačující je **stav galerie**: připravená, zveřejněná, stažená. „Kompletní set ještě nesdílíme“ i „rozmysleli jsme si to“ jsou obojí jen to, že karta na stránce svatby není — bez PINu, bez zamykání, bez nové plochy k testování. PIN si necháme na jediný případ, který stav galerie neumí: _ukázat některým, ne všem_. Tenkrát ho postavíme pořádně.

### Kdo ty přepínače mačká

Formálně pár, prakticky — pro dvacet svateb ročně — **fotograf na jeho žádost**. To je nula práce navíc a doporučuju s tím začít.

Vlastní přístup pro pár („co-host“, jak tomu říká GuestPix) je až druhá fáze a je potřeba k němu přistupovat opatrně: je to **token v URL s právem zápisu**, tedy něco docela jiného než dnešní odkaz na čtení. Když na to dojde, tak s vynuceným heslem, kratší platností, výhradně vratnými operacemi (skrýt, ne trvale smazat) a se zápisem do `ActivityEvent`. Server to musí ověřovat na každé akci zvlášť, přesně jako u session — Server Actions jsou veřejné POST endpointy (invariant 3).

**Tím padá „dvě vrstvy v jedné galerii“.** Předchozí návrh mixoval fotky od hostů a od fotografa v jedné mřížce a odděloval je filtrem. Tvoje verze je lepší: oddělení je strukturální, mřížka zůstává jednoduchá a nikdo si nespletl, čí fotku má před sebou. `Photo.source` tím neztrácí smysl — uvnitř hostitelské galerie pořád nese, kdo fotku přinesl — ale přestává být filtrem celého zobrazení.

**Na co si dát pozor.** ZIP zůstává po galeriích, ne po svatbě — jinak stavíme osmigigabajtový archiv pokaždé, když někdo přidá fotku do kterékoli z nich. Životní cyklus a mazání do koše se musí přesunout o úroveň výš, na svatbu, jinak zbude osiřelý rozcestník s prázdnými kartami. A v analytice přibude `eventId` vedle `galleryId`; token do ní nesmí ani teď (invariant 7).

## Technický rozdílový soupis (§08)

Co v repozitáři stojí, co chybí a co je riziko. Odkazy míří na skutečné soubory na větvi `feat/free-zip-background-build`.

| Oblast                  | Stav       | Kde to je / co udělat                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sdílený odkaz           | máme       | Hash tokenu, heslo (scrypt), expirace, revokace, lockout po 5 pokusech — `src/lib/share-access.ts`                                                                                                                                                                                                                                    |
| Identita hosta          | máme       | `Viewer.anonKey` \+ dobrovolné `displayName`, bez IP adres — přesně to, co host mode potřebuje                                                                                                                                                                                                                                        |
| Upload do R2            | máme       | Presignovaný PUT, CRC32, strip GPS, obnovení přerušeného přenosu — `src/components/uploader.tsx`                                                                                                                                                                                                                                      |
| Mřížka a lightbox       | máme       | Justified layout, virtualizace, kurzorové stránkování, swipe, barevné placeholdery                                                                                                                                                                                                                                                    |
| Stažení celé galerie    | máme       | ZIP se staví na pozadí na free tieru — právě rozpracováno, `docs/TODO.md` §7                                                                                                                                                                                                                                                          |
| Živý kanál              | máme       | Supabase Realtime (`src/lib/realtime-channel.ts`) — projekce z toho vyleze skoro zadarmo                                                                                                                                                                                                                                              |
| Presign pro hosta       | chybí      | `/api/uploads/presign` a `/confirm` dnes volají `requireAdmin()`. Přidat druhou větev přes `resolveShareLink` \+ `ShareLink.allowUpload`                                                                                                                                                                                              |
| Původ fotky             | chybí      | Nové `Photo.source` (OWNER \| GUEST) a `Photo.uploadedByViewerId` — bez toho nejde ani filtr, ani moderace, ani atribuce                                                                                                                                                                                                              |
| Kvóty a zneužití        | chybí      | Strop na galerii, na `anonKey` a na rychlost. Bez toho je to otevřený zápis do našeho úložiště, ať už token unikne omylem nebo ne                                                                                                                                                                                                     |
| Moderace                | chybí      | `Photo.moderationState` \+ režim soukromého sběru + mazání a skrývání v adminu                                                                                                                                                                                                                                                        |
| Svatba jako rodič       | chybí      | Nový `Event` s vlastním tokenem a slugem, `Gallery.eventId` / `position` / `listedOnEvent` / `eventLinkId`. `ShareLink` se nemění                                                                                                                                                                                                     |
| Trasa stránky svatby    | chybí      | `/s/[token]/[[...slug]]` vedle stávající `/g/`; slug zůstává kosmetický na obou (`docs/TODO.md` §6). Jediná zalistovaná galerie se vykreslí v místě, bez přesměrování                                                                                                                                                                 |
| Neindexovatelnost       | riziko     | `/g/` už vrací `noindex, nofollow` na všech větvích — `/s/` to musí mít od prvního commitu. Do `robots.txt` _nedávat_`Disallow`: zakázaná cesta se nestáhne, takže crawler `noindex` nikdy neuvidí. Na CDN chybí `X-Robots-Tag`                                                                                                       |
| Životní cyklus          | riziko     | Koš, purge a přesun do levnější třídy dnes pracují nad galerií (`src/lib/lifecycle.ts`). Musí se posunout na svatbu, jinak zbude rozcestník s prázdnými kartami                                                                                                                                                                       |
| HEIC z iPhonu           | riziko     | Validace bere jen jpeg/png/webp/avif. Safari konvertuje jen podle nastavení telefonu. Nutné otestovat na skutečném zařízení a mít čitelnou hlášku, ne tichý propad                                                                                                                                                                    |
| Náklady na transformace | riziko     | 5 000 unikátních transformací měsíčně zdarma; 800 fotek × 3 varianty = 2 400 na jednu svatbu. Řešení: náhled generuje telefon, transformace jen pro detail                                                                                                                                                                            |
| Slabá síť               | riziko     | Fronta uploadů musí přežít zamčení displeje a přepnutí aplikace. Service worker v projektu je (`public/sw.js`), background sync ne                                                                                                                                                                                                    |
| Video                   | rozhodnutí | Dnes jen obrázky. Podpora znamená přehrávač, náhledy a přenosová data — vlastní projekt, ne položka MVP                                                                                                                                                                                                                               |
| Právo a soukromí        | riziko     | Host nahrává fotky jiných lidí. Potřeba: krátký souhlas u nahrání, kontakt na stažení fotky, a dodržení invariantu, že token nesmí do analytiky. „Nezalistovaná“ znamená neindexovatelná a neuhodnutelná — ne neviditelná: náhledové roboti WhatsAppu a Messengeru si stránku stáhnou, URL je v historii prohlížeče i v našich logách |

**Invarianty zůstávají v platnosti.** Bajty fotek ani ZIPů netečou přes Vercel — host nahrává presignovaným PUT rovnou do R2, stejně jako dnes vlastník. Server jen podepisuje a zapisuje metadata. Limit 4,5 MB na tělo požadavku se tím pádem netýká ničeho, co host dělá.

## Testovací plán (§09)

Klářin seznam. Řazeno podle toho, co je nejpravděpodobnější, že to na svatbě selže.

#### Zařízení, ne prohlížeče

- iPhone se „Zachovat originály“ (HEIC ven) i „Nejkompatibilnější“ (JPEG ven)
- Android 9 a starší Chrome — cílová babička
- Výběr 40 fotek najednou z galerie
- Foto přímo z fotoaparátu v prohlížeči

#### Síť

- Škrcení na 3G a ztrátovost paketů uprostřed uploadu
- Zamčení displeje během nahrávání, návrat po pěti minutách
- Přepnutí z prohlížeče do Instagramu a zpět
- Dvacet souběžných hostů na jednu galerii

#### Bezpečnost

- Nahrávání odkazem po expiraci, po revokaci, do archivované galerie
- Nahrávání odkazem, který má `allowUpload = false`
- Překročení kvóty na `anonKey` i na galerii
- Podvržený content-type a soubor větší, než hlásí

#### Prázdné a mezní stavy

- Prázdná galerie — první host nesmí vidět prázdnou obrazovku bez vysvětlení
- Pár smaže fotku, kterou má host otevřenou
- Přechod z 0 na 800 fotek — výkon mřížky na starším telefonu
- ZIP postavený před tím, než hosté dosypali zbytek

E2E sada v `e2e/` už pokrývá nepřihlášeného diváka. Host mode se do ní dá přidat bez testovacího přihlášení — což je výhoda oproti admin flow, které na chybějící test-auth bypass čeká (`docs/TODO.md` §0).

## Texty (§10)

Lucie: host čte čtyři vteřiny, jednou rukou, ve stoje. Každá věta níž je návrh k použití, ne popis toho, co by tam mělo být.

Cedulka u fotokoutku · hlavní

Máte v telefonu fotku, kterou jsme neviděli.

Namiřte na kód foťák v telefonu. Bez aplikace, bez přihlašování.

Cedulka na stole · kratší varianta

Nechte nám tu, co jste vyfotili.

Naskenovat → vybrat → hotovo.

První obrazovka po naskenování

Svatba Elišky a Honzy

Vaše fotky uvidí všichni svatebčané. Přidat je můžete do neděle.

Hlavní tlačítko

Přidat fotky

Vedle: „Vyfotit“ — otevře rovnou foťák.

Během nahrávání

Nahrávám na pozadí. Telefon můžete zamknout.

12 z 34 · dokončí se i bez signálu, až se připojíte.

Po nahrání · dotaz na jméno

Komu za ně poděkovat?

Napište křestní jméno — objeví se u vašich fotek. Nechat prázdné je taky v pořádku.

Prázdná galerie

Zatím prázdno. Buďte první.

Ostatní fotky se objeví, jak je kdo přidá.

Soukromý sběr zapnutý

Díky! Fotky uvidí nejdřív novomanželé.

Album se otevře všem po svatbě.

Notifikace páru

Od hostů přibylo 47 fotek.

Podívat se →

Prodejní věta k balíčku

Než ode mě dostanete fotky, budete mít svatbu z osmdesáti telefonů.

Galerie pro hosty je součástí celodenního balíčku. Cedulky s QR kódem dodám.

**Čeho se držet.** Nikde neříkáme „QR kód“ jako první slovo — říkáme, co host získá. Nikde neslibujeme, co neumíme („videa“). A tam, kde je něco časově omezené (nahrávání do neděle, album na rok), je to napsané dřív, než se na to někdo zeptá.

## Balení a cena (§11)

Trh je zakotvený mezi 179 a 990 Kč za jednu svatbu. Do téhle mezery vstupovat jako šestý dodavatel nemá smysl — obhájit tam jde nanejvýš pár tisíc korun ročně, a to za cenu zákaznické podpory pro lidi, kteří nejsou naši klienti.

#### Doporučeno · Bonus k balíčku

**0 Kč** ke každému celodennímu focení. Součástí je cedulka s QR, galerie na rok a fotky od hostů promíchané s finálními.

Co za to dostáváme: 80 lidí ze svatby na naší doméně, seznam jmen, a argument, který v nabídce nikdo jiný nemá.

#### Samostatně

**890 Kč** pro pár, který si nebere focení. Cenově mezi ShareLove (730 Kč) a Snapshare top (990 Kč), ale s roční retencí místo 60 dní.

Bere se to jako ceník, ne jako produkt — hlavní cesta je bonus.

#### Prodloužení

**390 Kč / další rok.** Jediná opakující se položka. Dává smysl teprve tehdy, až galerie obsahuje i finální fotky — do té doby není co prodlužovat.

**Co se měří.** Podíl hostů, kteří nahráli aspoň jednu fotku (cíl ≥ 60 % z počtu hostů podle páru). Počet návratů do galerie po dni svatby. Kolik z hostů si otevřelo galerii i podruhé, když přibyly fotky od fotografa. Zbytek jsou marnivá čísla.

## Postup (§12)

Odhady jsou v člověkodnech na jednoho vývojáře a předpokládají, že se nemění nic z toho, co už stojí. Fáze 1–3 jsou minimum, se kterým se dá jet skutečná svatba.

#### Rozhodnutí (F0)

Zavřít pět otázek z posledního oddílu. Bez toho se F1 stejně předělá.

0,5 dne

#### Nahrávání hostem (F1)

`ShareLink.allowUpload`, druhá větev v presignu a confirmu přes share token, `Photo.source` a `uploadedByViewerId`, kvóty na galerii i na `anonKey`, migrace.

3–4 dny

#### Stránka svatby (F2)

`Event` s vlastním tokenem, `Gallery.eventId` / `position` / `listedOnEvent` / `eventLinkId`, trasa `/s/`, karty s obálkou a počty, vykreslení jediné galerie v místě, přesměrování odebrané, přesun životního cyklu o úroveň výš.

2–3 dny

#### Mobilní realita (F3)

Klientský náhled 512 px, fronta uploadů odolná proti zamčení displeje, HEIC (detekce a čitelná hláška, případně konverze), stav nahrávání, který neklame.

2–3 dny

#### Moderace a kontrola (F4)

Režim soukromého sběru, skrytí a smazání v adminu, seskupení podle autora, souhlas u nahrání a stránka pro žádost o stažení fotky.

2 dny

#### Projekce (F5)

`/g/{token}/show` — celoobrazovkový režim, živý přísun přes Supabase Realtime, ochrana proti prohoření displeje, chování při ztrátě spojení.

1–2 dny

#### Testy a ostrá zkouška (F6)

Rozšíření E2E sady o host flow, test na skutečných telefonech, zkušební běh na malé akci před první svatbou.

2 dny

#### Tisková grafika (F7)

Generované cedulky s QR — samostatné zadání, mimo tuto dávku. Z rešerše: 180 šablon je u GuestPixu hlavní prodejní argument, takže to není maličkost na konec.

samostatně

#### Video (F8)

Vlastní projekt. Rozhodnout až podle toho, kolikrát si o něj hosté řeknou na první ostré svatbě.

samostatně

## Sedm otázek k rozhodnutí (§13)

Každá z nich mění zadání první nebo druhé fáze. Doporučení je uvedené, ale rozhoduje owner.

#### Jak pár sdílí míň než všechno?

Ne seznamem odemčených galerií na odkazu — ten padl. Každá galerie má vlastní přeposílatelnou `/g/` adresu a `listedOnEvent` rozhoduje, jestli je i kartou na stránce svatby. Přeposlání odkazu na galerii nikdy neodhalí stránku svatby, protože její token je jiné tajemství.

**Doporučeno:** Dva přepínače místo jednoho podsystému. `allowUpload` zůstává na odkazu galerie od hostů, vedle `allowDownload` a `allowReactions`.

#### Kolik fotek smí jeden host nahrát?

Bez stropu je to otevřený zápis do úložiště. Se stropem naštveme toho jednoho hosta, který má nejlepší fotky z celého večera.

**Doporučeno:** 150 souborů na `anonKey` a 2 000 na galerii, s možností zvednout to v adminu. Po dosažení stropu čitelná hláška, ne tiché selhání.

#### Vidí host fotky ostatních hned, nebo až po svatbě?

Okamžitá viditelnost je celý zážitek — lidi se dívají, co nafotili ostatní, a přidávají další. Zároveň je to jediné místo, kde se do galerie může dostat něco nevhodného před očima všech.

**Doporučeno:** Volba páru při zakládání, výchozí _hned viditelné_. Konkurence to má obojí a jeden boolean to nerozbije.

#### Zamykat jednotlivou galerii PINem?

PIN nechrání před uhodnutím odkazu — ten je neuhodnutelný sám o sobě. Chrání před přeposláním, a to je sociální brzda, ne přístupové právo. Navíc dnešní počítadlo chybných pokusů sedí na odkazu, takže by pět omylů zamklo galerii celé svatbě.

**Doporučeno:** V první verzi ne. Stav galerie (připravená / zveřejněná / stažená) pokryje reálné případy bez nové plochy. PIN až pro „některým, ne všem“ — a tehdy s počítadlem na diváka místo na odkazu a nikdy na galerii od hostů.

#### Kdo rozhoduje, co je na rozcestníku vidět?

Pár má rozhodovat, co se sdílí. Otázka je, jestli to má i sám přepínat. Vlastní přístup pro pár znamená token v URL s právem zápisu — jiná bezpečnostní třída než dnešní odkaz na čtení.

**Doporučeno:** Pro první verzi přepíná fotograf na žádost páru. Při dvaceti svatbách ročně je to pár kliknutí a nula nové bezpečnostní plochy. Přístup pro pár až potom, s vynuceným heslem a jen vratnými operacemi.

#### Jak dlouho galerii držíme?

Konkurence v ČR drží 14–90 dní. Rok je náš rozlišovací znak, ale platíme za něj úložištěm v R2 za každou svatbu, která nikdy neskončí.

**Doporučeno:** Rok od data svatby, pak přesun do levnější třídy a upozornění páru. Životní cyklus už v projektu existuje (`src/lib/lifecycle.ts`), takže je to konfigurace, ne stavba.

#### Kdo odpovídá za fotku, kterou nahrál host?

Host nahraje fotku někoho třetího. Ten člověk může chtít, aby zmizela. Galerie sice není veřejně dohledatelná — token je neuhodnutelný a stránka má být `noindex` — ale odkaz se předává dál a to nestačí jako obhajoba.

**Doporučeno:** Jedna věta souhlasu u tlačítka nahrání, kontakt na stažení fotky v patičce galerie, a mazání v rukou páru bez prodlevy. Tohle je levné udělat teď a drahé dodělávat potom.
