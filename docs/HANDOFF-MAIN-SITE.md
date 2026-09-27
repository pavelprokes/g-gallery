# Podklad pro web svatebni-fotograf-cechy.cz: jak prodávat fotogalerii

Tento dokument předává agentovi, který pracuje na hlavním webu (`svatebni-fotograf-cechy-2.0`), vše, co
potřebuje, aby na webu představil fotogalerii a její funkce. Galerie běží jako samostatná aplikace na
`photos.svatebni-fotograf-cechy.cz` (tento repozitář, `g-gallery`). Do hlavního webu se nic z galerie
nevkládá: web o galerii **mluví a odkazuje na ni**.

Sestaveno 2026-09-27 z kódu a dokumentace `g-gallery` (hlavně `docs/GUEST-GALLERIES.md`,
`docs/GUEST-GALLERIES-RESEARCH.md`, `docs/PROMO-CARDS.md`). Každá funkce v §4 je ověřená v kódu. Co není
rozhodnuté, je v §13 jako otázka pro Pavla, ne jako fakt.

## Jak s tím pracovat (pro agenta)

1. Nejdřív si projdi hlavní web: jeho strukturu stránek, ceník/balíčky, komponenty, theme
   (`style/theme.ts`), fonty (`lib/fonts.ts`, Bitter) a jazykové mutace. Všechno nové staví na
   stávajícím designu. Nic nevymýšlej od nuly.
2. Implementuj §6 v pořadí, v jakém je napsaný. Texty ber z §7. Jsou to hotové návrhy, ne popisy.
3. Tvrzení o funkcích ber jen z §4. Nic tam neuvedeného galerii nepřisuzuj, a hlavně ne video (§11).
4. Než cokoli pustíš ven, projdi s Pavlem otázky z §13. Týkají se ceny a slibů vůči klientům.

## 1. Co se prodává, jednou větou

Galerie není samostatný produkt. Je to **bonus k celodennímu focení**, který dělá balíček
nesrovnatelným s konkurencí. Web má prodávat focení. Galerie je argument, proč právě tohle focení.

## 2. Pozicování

- **Na trhu.** „Hosté nahrávají fotky přes QR kód“ dnes v Česku nabízí nejméně pět služeb za 179–990 Kč
  (Snapshare, FotoDrop, OnlineSvatba, ShareLove, MomentsForLove) a v zahraničí přes deset dalších. Je
  to vstupenka, ne výhoda. Tyhle služby vrátí album, které **zmizí za 14–90 dní**, a nemají žádnou vazbu
  na fotky od fotografa.
- **V čem je náskok.** Je v tom, co konkurence nemá:
  1. **Jeden odkaz, který roste.** Za stejnou adresou (a stejným QR kódem na stole) přibývají galerie:
     večer fotky od hostů, za pár dní první výběr od fotografa, za pár týdnů kompletní set.
  2. **Fotky od fotografa i od hostů na jednom místě** a na doméně fotografa. Ne v cizí službě.
  3. **Vydrží.** Galerie je online minimálně rok od svatby (§13, bod 2), ne 60 dní.
- **Hlavní sdělení (headline):**
  > Než ode mě dostanete fotky, budete mít svatbu z osmdesáti telefonů.

## 3. Adresy a jak galerie vypadá navenek

| Co               | Adresa                                       | Poznámka                                                                                                        |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Aplikace galerie | `https://photos.svatebni-fotograf-cechy.cz/` | Kořen je veřejná nápověda pro hosty (co galerie umí, FAQ, tipy). Hodí se jako odkaz „Jak to funguje pro hosty“. |
| Stránka svatby   | `/s/{token}/{jmena-a-datum}`                 | Jedna adresa na svatbu. Rozcestník galerií. Tohle vede z QR kódu na stole.                                      |
| Jedna galerie    | `/g/{token}/{nazev}`                         | Samostatná galerie.                                                                                             |

Adresy svateb a galerií jsou **neveřejné** (nedají se najít, nejsou v Googlu), ale **nejsou
zabezpečené**: kdo odkaz má, ten se podívá. Na webu nikdy nepsat „soukromá galerie“ (§11). Skutečné
odkazy klientů na web nepatří. Ukázková galerie viz §13, bod 3.

Stránka svatby: nahoře jména, datum a místo. Pod tím velké dlaždice galerií od fotografa (jedna přes
celou šířku, nebo dvě vedle sebe). Pod nimi nízký řádek „Od hostů“ s výzvou „Přidej i svoje fotky
z mobilu“.

## 4. Ověřené funkce: co smíš tvrdit

Všechno níže je v kódu a v produkci. Řazeno podle toho, co pár zajímá nejvíc.

### Pro pár a hosty, kteří si fotky prohlížejí

| Funkce                          | Jak to říct                                                                               | Pozor                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Jeden odkaz, nic se neinstaluje | Otevře se v prohlížeči na mobilu i počítači, bez účtu.                                    | –                                                                                         |
| Stránka svatby s víc galeriemi  | Za jedním odkazem postupně přibývají galerie od hostů, první výběr i kompletní set.       | Galerie přidává a skrývá fotograf, pár to sám nepřepíná.                                  |
| Stažení všeho                   | Celá galerie jedním tlačítkem jako ZIP ve vysokém rozlišení.                              | U velkých galerií se ZIP chvíli připravuje a u vícegigabajtových galerie předem upozorní. |
| Rychlé prohlížení               | Mřížka bez ořezávání fotek, prohlížení na celou obrazovku, plynulé i na starším telefonu. | –                                                                                         |
| Oblíbené a reakce               | Srdíčko a reakce u fotek. Vidí je i ostatní.                                              | Fotograf je může u galerie vypnout.                                                       |
| Výběr k tisku                   | Hosté i pár si mohou fotky označit k tisku i s počtem kusů.                               | Samotný tisk ani objednávku galerie neřeší. Je to jen výběr.                              |
| Pokračovat na jiném zařízení    | Výběr z telefonu jde jednorázovým kódem přenést na počítač.                               | –                                                                                         |
| Offline                         | Galerii jde uložit do telefonu a prohlížet bez signálu.                                   | –                                                                                         |
| Heslo a platnost                | Fotograf může galerii dát heslo nebo časově omezit odkaz.                                 | Na galerii pro nahrávání hostů se heslo nedává.                                           |
| Tři jazyky                      | Čeština, angličtina a francouzština, podle nastavení telefonu. Přepínač v patičce.        | –                                                                                         |

### Pro hosty, kteří nahrávají

| Funkce                | Jak to říct                                                                                                 | Pozor                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Nahrávání přes QR     | Hosté naskenují kód na stole a přidají fotky. Bez aplikace a bez registrace.                                | –                                                                                                                           |
| Rovnou foťák          | Tlačítko „Vyfotit“ otevře fotoaparát.                                                                       | –                                                                                                                           |
| Jméno u fotek         | Před prvním nahráním se galerie nepovinně zeptá na jméno a to se pak ukáže u fotek. Pár ví, komu poděkovat. | Nepovinné. Host může pokračovat bez jména.                                                                                  |
| Nahrávání na pozadí   | Telefon během nahrávání nezhasne. Když se nahrávání přeruší, dopošle se, až se host na stránku vrátí.       | Neslibovat nahrávání „při zamčeném telefonu“. Dokončí se po návratu.                                                        |
| Smazání vlastní fotky | Fotku nahranou omylem host sám smaže.                                                                       | Jen svoje fotky.                                                                                                            |
| Soukromí polohy       | Z fotek hostů se ještě v telefonu odstraní GPS poloha. Adresu domova nikdo nezjistí.                        | –                                                                                                                           |
| iPhone                | Fotky z iPhonu fungují.                                                                                     | Formát HEIC se nepřijímá. Prohlížeč ho ale běžně sám převede, jen při zapnutém „Zachovat originály“ se hostovi ukáže návod. |
| Limity                | Až 150 fotek na hosta, 25 MB na fotku, 2 000 fotek na galerii.                                              | Na webu stačí „stovky fotek od hostů“. Čísla uvádět jen ve FAQ.                                                             |

### Na svatbě

| Funkce             | Jak to říct                                                                           | Pozor                                                             |
| ------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Projekce           | Fotky od hostů se promítají na plátno nebo televizi a nové naskočí **do půl minuty**. | Obnovuje se každých 30 s, nepsat „v reálném čase“ ani „okamžitě“. |
| Cedulka s QR kódem | Tiskovou cedulku s QR kódem připraví fotograf.                                        | Jeden hotový design, žádný výběr ze šablon.                       |

### Co galerie **neumí** (nikde to nenaznačovat)

- **Video.** Jen fotky, videa hosté nahrát nemohou.
- **Hledání podle obličeje** („najdi se“).
- **Schvalování fotek předem.** Fotky od hostů jsou vidět hned. Nevhodnou fotku smaže fotograf.
- **Tisk a objednávka fotek.** Galerie umí jen výběr k tisku.
- **RSVP, zasedací pořádek, svatební web.**

## 5. Cena a balení

| Varianta                                                                               | Cena         | Stav                                                                                             |
| -------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| Bonus k celodennímu focení (galerie pro hosty, cedulky s QR, galerie minimálně na rok) | 0 Kč         | Rozhodnuto (`docs/GUEST-GALLERIES.md` §15). Tohle je hlavní cesta a jediné, co ukazovat na webu. |
| Samostatně pro pár bez focení                                                          | 890 Kč       | Návrh (research §11), **nepotvrzeno**. Na webu neuvádět bez Pavlova souhlasu.                    |
| Prodloužení o další rok                                                                | 390 Kč / rok | Návrh, **nepotvrzeno**. Na webu neuvádět.                                                        |

## 6. Co na webu postavit (v tomto pořadí)

### 6.1 Ceník / balíčky (nejdůležitější)

- U celodenního balíčku přidat řádek „**Galerie pro hosty + cedulky s QR kódem**“ s odkazem na
  podstránku z §6.2.
- Vizuálně jako součást balíčku, ne jako placený příplatek.
- U kratších balíčků galerii pro hosty **neuvádět**. Rozdíl je součástí argumentu pro celý den.
- Galerie od fotografa (hotové fotky, stažení, oblíbené) je u všech balíčků. Když ji ceník už zmiňuje,
  sjednotit formulaci s §7.

### 6.2 Nová podstránka „Galerie pro hosty“

Doporučená adresa `/galerie-pro-hosty` (nebo podle konvence webu). Sekce shora dolů:

1. **Hero:** headline + podtitulek (§7.1), vizuál: telefon se stránkou svatby. CTA „Zjistit volný termín“ →
   kontakt/poptávka.
2. **Jak to funguje:** 3 kroky (§7.2).
3. **Jeden odkaz, který roste:** časová osa „večer / za pár dní / za pár týdnů“ (§7.3). Hlavní
   argument proti konkurenci, dát mu prostor.
4. **Co hosté zvládnou:** 4–6 funkcí z §4 s ikonami (§7.4).
5. **Projekce na svatbě:** krátký blok s fotkou plátna nebo televize (§7.5).
6. **Soukromí a bezpečí:** GPS, neveřejný odkaz, smazání vlastní fotky (§7.6).
7. **FAQ:** §7.7, strukturovaná data `FAQPage`.
8. **Závěrečné CTA:** „Galerie pro hosty je součástí celodenního focení.“ + tlačítko na poptávku.

Odkaz „Jak to funguje pro hosty“ může vést na `https://photos.svatebni-fotograf-cechy.cz/`. Tam je
veřejná nápověda, kterou dostávají i hosté.

### 6.3 Úvodní stránka

Jeden blok (vizuál telefonu + 2 věty z §7.1 + odkaz na podstránku). Nic víc. Úvodní stránka má dál
prodávat hlavně fotky.

### 6.4 Reference / svatby

U svateb, kde galerie pro hosty běžela, přidat jeden řádek s číslem (např. „312 fotek od 41 hostů“) a
citaci páru, pokud souhlasí. Čísla zjistí Pavel v administraci galerie. **Nevymýšlet je.**

### 6.5 FAQ na webu

Pokud má web obecné FAQ, přidat 3 otázky z §7.7 (instalace, jak dlouho vydrží, kdo fotky uvidí).

### 6.6 Poptávkový formulář

Zaškrtávátko „Zajímá mě i galerie pro hosty“. Pavel tak uvidí, co zabírá. Pokud formulář ukládá data,
přidat pole do stejného úložiště, žádná nová služba.

## 7. Hotové texty (čeština)

Tón: tykání/vykání podle konvence hlavního webu (galerie sama hostům tyká, pár na webu oslovuje podle
stávajících textů). Níže je vykání, uprav podle webu. Pokud má web i anglickou mutaci, přelož podle
stejné struktury.

### 7.1 Hero

- **Nadpis:** Než ode mě dostanete fotky, budete mít svatbu z osmdesáti telefonů.
- **Podtitulek:** Hosté naskenují kód na stole a přidají svoje fotky: bez aplikace, bez registrace. Za
  stejným odkazem pak najdete i první výběr a kompletní fotky ode mě.
- **CTA:** Zjistit volný termín
- **Pod CTA (drobně):** Součást celodenního focení. Cedulky s QR kódem dodám.

### 7.2 Jak to funguje

1. **Na stolech leží cedulky.** Hosté namíří foťák v telefonu na kód. Nic neinstalují.
2. **Přidají, co nafotili.** Z galerie v telefonu, nebo rovnou foťákem. Nahrávání doběhne, i když se na
   chvíli ztratí signál.
3. **Vy máte všechno na jednom odkazu.** Fotky od hostů, večer promítnuté na plátně, a později i ty ode
   mě.

### 7.3 Jeden odkaz, který roste

- **Večer na svatbě:** fotky od hostů přibývají, jak je kdo přidá.
- **Za pár dní:** první výběr ode mě, na stejné adrese.
- **Za pár týdnů:** kompletní fotky ve vysokém rozlišení, ke stažení jedním tlačítkem.

Doplňující věta: _Odkaz ani QR kód se nemění. Co si hosté uložili na svatbě, funguje i za rok._

### 7.4 Co hosté zvládnou

- **Bez aplikace:** stačí foťák v telefonu a prohlížeč.
- **Jméno u fotek:** víte, komu za kterou fotku poděkovat.
- **Omyl jde vzít zpět:** svoji fotku si host sám smaže.
- **Fotky z iPhonu i Androidu:** bez převádění.
- **Tři jazyky:** česky, anglicky a francouzsky, podle telefonu hosta.
- **Stažení všeho:** celou galerii jedním tlačítkem.

### 7.5 Projekce

- **Nadpis:** Svatba z pohledu hostů, na plátně ještě ten večer.
- **Text:** Stačí notebook u projektoru nebo televize. Nové fotky od hostů naskočí do půl minuty a
  prolínají se samy, nikdo u toho nemusí stát.

### 7.6 Soukromí

- **Odkaz nenajde nikdo, komu ho nedáte:** není v Googlu a nedá se uhodnout. Kdo ho ale dostane, může
  ho poslat dál, stejně jako fotku v chatu.
- **Poloha zůstává v telefonu:** z fotek hostů se ještě před odesláním odstraní GPS.
- **Každá fotka se dá vzít zpět:** host smaže svoji, nevhodnou fotku smažu já.

### 7.7 FAQ

- **Musí si hosté něco instalovat?** Ne. Naskenují kód foťákem v telefonu a otevře se jim stránka
  v prohlížeči. Žádná aplikace ani registrace.
- **Jak dlouho galerie vydrží?** Minimálně rok od svatby. Hosté i vy se k ní můžete vracet a fotky ode
  mě přibudou na stejné adrese. _(Ověřit s Pavlem, §13, bod 2.)_
- **Kdo fotky uvidí?** Každý, kdo má odkaz nebo naskenuje kód. Odkaz není veřejně k nalezení, ale dá se
  přeposlat. Galerii ode mě můžu zamknout heslem.
- **Kolik fotek můžou hosté nahrát?** Až 150 fotek na hosta a do 25 MB na fotku. Na běžnou svatbu to
  stačí s velkou rezervou.
- **Jde nahrát i video?** Zatím ne. Galerie je jen na fotky.
- **Může mi někdo nahrát nevhodnou fotku?** Fotky od hostů jsou vidět hned. Když se objeví něco, co tam
  být nemá, napište mi a smažu to. Host může svoje fotky smazat sám.
- **Co když host nemá signál?** Nahrávání pokračuje, jakmile se připojí a vrátí na stránku.

### 7.8 Ceník (řádek u balíčku)

**Galerie pro hosty + cedulky s QR kódem:** hosté přidávají fotky ze svatby, večer je promítnete a
za stejným odkazem pak najdete i fotky ode mě.

### 7.9 Meta (SEO) pro podstránku

- **Title:** Galerie pro hosty: svatební fotky od hostů přes QR kód | Pavel Prokeš
- **Description:** Hosté přidají fotky ze svatby bez aplikace a bez registrace. Na stejném odkazu pak
  najdete i profesionální fotky. Součást celodenního svatebního focení.

## 8. Vizuály

Na hlavním webu se nesmí objevit skutečná jména ani fotky klientů bez jejich souhlasu. Pro všechny
screenshoty použít ukázkovou galerii (§13, bod 3), nebo svatbu, kde pár souhlasil.

Pořídit (mobil 390 × 844, světlý režim, pokud web nemá tmavý):

1. Stránka svatby: dvě dlaždice od fotografa a řádek „Od hostů“.
2. Panel „Jak se jmenuješ?“ před nahráním.
3. Mřížka galerie s fotkami od hostů.
4. Lightbox s ikonou foťáku a jménem autora nad ovládáním.
5. Projekce na televizi nebo plátně (fotka reálné situace, ne screenshot).
6. Cedulka s QR kódem na stole (fotka; `public/qr-sign-table.webp` v `g-gallery` je ilustrační
   podklad).
7. Volitelně: krátké video (10–15 s) nahrávání z mobilu. Silnější než statické obrázky.

Barvy a písmo: galerie přebírá tokeny z `style/theme.ts` hlavního webu (terakota `#825238`, tmavá
`#34190e`, světlá `#fdf8f5`, okraje `#dfc8bf`, font Bitter). Na hlavním webu tedy použij jeho vlastní
theme. Nic nekopíruj z `g-gallery`.

## 9. Propojení s galerií a měření

- **UTM parametry na odkazech z galerie na web.** Galerie má v mřížce kartu fotografa, jejíž odkaz se
  nastavuje v administraci galerie (`/admin/promo`) a počítají se na ní kliknutí
  (`docs/PROMO-CARDS.md`). Do jejího odkazu stačí dát UTM. Návrh:
  `?utm_source=galerie&utm_medium=promo-karta&utm_campaign={rok}`. Patička galerie odkazuje na
  `svatebni-fotograf-cechy.cz` bez UTM. Jestli ji rozšířit, rozhodne Pavel (změna v `g-gallery`, ne na
  webu).
- **Na webu** zajistit, aby analytika UTM zachytila a poptávka šla přiřadit ke zdroji „galerie“.
- **Co sledovat:** návštěvy podstránky z §6.2, kliknutí na CTA, poptávky se zaškrtnutým zájmem o galerii
  (§6.6), návštěvy z `utm_source=galerie`.

## 10. SEO

- Podstránka z §6.2 cílí na dotazy typu „svatební fotky od hostů“, „sdílená svatební galerie“,
  „QR kód fotky svatba“. **Jsou to odhady bez dat o hledanosti.** Ověř je nástrojem, který web
  používá, pokud nějaký má.
- FAQ ze §7.7 jako strukturovaná data `FAQPage`.
- Interní odkazy: z ceníku, úvodní stránky a referencí na podstránku.
- Galerie a svatby (`photos.…/g/*`, `photos.…/s/*`) jsou záměrně `noindex`. Neodkazovat na ně jako na
  obsah pro SEO.
- **Pozor na souboj o stejné dotazy.** Kořenová stránka `https://photos.svatebni-fotograf-cechy.cz/`
  se indexuje (je v sitemapě galerie) a má titulek „Svatební fotogalerie s QR kódem pro hosty“. Míří
  tedy na stejné dotazy jako nová podstránka. Doporučení: prodejní stránkou je podstránka na hlavním
  webu. Kořen `photos.…` zůstane nápovědou pro hosty a bude na podstránku odkazovat (úprava
  v `g-gallery`, viz §14). Oba weby na sebe mají odkazovat navzájem.

## 11. Pravidla a zákazy

- **Nezačínat slovem „QR kód“.** Nejdřív říct, co pár získá. QR je až způsob.
- **Neslibovat video**, hledání obličejů, schvalování fotek předem ani tisk.
- **Nepsat „soukromá galerie“.** Správně je „neveřejná“, „nedá se najít“, „vidí ji ten, kdo má odkaz“.
- **Nepsat „v reálném čase“ ani „okamžitě“** u projekce. Správně „do půl minuty“.
- **Nezveřejňovat ceny ze §5** kromě „součást celodenního focení“, dokud je Pavel nepotvrdí.
- **Neuvádět čísla z referencí**, která nedodal Pavel.
- **Časová omezení psát předem.** Když něco platí jen po nějakou dobu (galerie minimálně rok), napsat
  to dřív, než se pár zeptá.

## 12. Hotovo, když

- [ ] Ceník u celodenního balíčku obsahuje řádek z §7.8 a odkaz na podstránku.
- [ ] Podstránka z §6.2 má všech 8 sekcí, texty ze §7 upravené na tón webu a funguje na mobilu.
- [ ] Úvodní stránka má jeden blok s odkazem na podstránku.
- [ ] FAQ je vyznačené jako `FAQPage`, meta title a description podle §7.9.
- [ ] Poptávkový formulář má zaškrtávátko z §6.6.
- [ ] Na webu není nic, co zakazuje §11, a každé tvrzení o funkcích má oporu v §4.
- [ ] Otázky ze §13 jsou zodpovězené a promítnuté do textů.

## 13. Otázky pro Pavla (zodpovědět před zveřejněním)

1. **Balíček:** ke kterému balíčku (nebo balíčkům) galerie pro hosty patří? Návrh: jen celodenní.
2. **Doba:** platí „minimálně rok od svatby“? V dokumentaci galerie je rok rozhodnutý jako doba, po
   kterou fotky zůstávají v rychlém úložišti. Nic se ale automaticky nemaže a odkazy platí, dokud jim
   Pavel nenastaví konec. Chceš na webu slibovat rok, nebo déle?
3. **Ukázková galerie:** máme svatbu, jejíž fotky smíme ukázat veřejně? Bez ní nejsou screenshoty ani
   odkaz „vyzkoušejte si to“.
4. **Samostatná cena a prodloužení** (890 Kč, 390 Kč/rok): uvádět, nebo zatím jen na dotaz?
5. **Reference:** které svatby a s jakými čísly (počet fotek a hostů) smíme uvést?
6. **Tykání/vykání** na podstránce: podle zbytku webu?
7. **Jazyky:** má hlavní web anglickou verzi, na kterou je potřeba podstránku přeložit?

## 14. Navazující úpravy v `g-gallery` (mimo hlavní web)

Nejsou úkolem agenta hlavního webu. Jsou tu, aby se na ně nezapomnělo. Udělají se v tomto repozitáři.

- Kořenová stránka `photos.…` v bloku o projekci slibuje „v reálném čase“. Projekce se ale obnovuje
  každých 30 s. Sjednotit na „do půl minuty“ (`messages/*.json`, `marketing.highlights.projector`).
- Kořenová stránka `photos.…` má odkazovat na novou podstránku hlavního webu (až bude její adresa
  známá) a její titulek přizpůsobit roli nápovědy pro hosty (§10).
- Patička galerie odkazuje na hlavní web bez UTM. Pokud Pavel chce měřit i ji, doplnit UTM (§9).
