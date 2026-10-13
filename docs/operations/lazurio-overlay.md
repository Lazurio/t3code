# Lazurio T3 Code: overlay

Specifikace chování, které overlay Lazuria přidává do T3 Code a které je příliš
podrobné pro [runbook vydávání](./lazurio-fork-release.md). Runbook drží, jaké
commity overlay má, jak se hlídá, testuje a vydává; tady je popsané, co overlay
dělá a kde jsou jeho švy v upstream souborech.

## Prohlížeč Environmentu

**Rozhodnutí 0191 (plán DEV-6646, Lazurio/t3code#40); záložky vlákna a Nová karta podle
LazurioPlatform F47, krok 4 (úkol 501).** Na Remote
Environmentu běží jeden sdílený Chromium. Agenti každého vlákna v něm pracují ve
vlastním okně přes CLI `agent-browser` a člověk s nimi pracuje v pohledu za
bránou Environmentu, kde `https://browser.<vm>.<org>.lazurio.io/t/<id>` ukazuje
právě jednu vzdálenou záložku (rozhodnutí F39 LazurioPlatform). Webový klient
T3 žádný prohlížeč nemá, a tak overlay dělá tohle:

- **Server: sezení vlákna.** Každý proces poskytovatele, který T3 spustí pro
  vlákno (app-server Codexu, Claude Code i ostatní adaptéry), dostane
  `AGENT_BROWSER_SESSION=t3-<id vlákna>`. Jméno smí mít jen `[A-Za-z0-9_-]` a
  nejvýš 64 znaků (gramatika agent-browser a limit jeho dashboardu). Běžné id
  vlákna (UUID) se do jména vejde beze změny. Id s jinými znaky nebo delší
  (například importované vlákno `import:<instance>:<sezení>`) dostane místo
  nich `-`, zkrátí se a na konec dostane hash celého id, takže dvě vlákna
  nikdy nesdílejí sezení ani okno. ProviderService jméno zapíše do sezení
  poskytovatele, které pro vlákno vede; prostředí toho sezení už každý adaptér
  předává procesům vlákna (stejnou cestou jde CLI `agent-device`). Proměnná jen
  pojmenovává sezení, nic nepovoluje a platí i při vypnutém přístupu agentů k
  prohlížeči T3.
- **Server: nástroje prohlížeče T3.** Nástroje `preview_open`,
  `preview_snapshot`, `preview_click` a další ovládají prohlížeč Environmentu,
  takže agent ve webovém T3 pracuje ve stejném okně jako `agent-browser` a člověk
  v pohledu. Hostitel uvnitř serveru T3 se u brokera náhledu registruje jako
  preferovaný a hlásí všechny operace. Dokud je připojený, dostane veškerou
  práci prohlížeče před každým desktopem, i v relaci agenta, kterou předtím
  obsloužil desktop (třeba než se hostitel zaregistroval); na desktop jde jen
  výslovně zadaná záložka, kterou desktop hlásí. Registruje se jen, dokud
  Environment prohlížeč deklaruje:
  `~/.local/bin/lazurio browser link --json` skončí 0 s `{"kind":"browser-link"}`.
  Jinak (exit 10, chybějící binárka, cokoli jiného) se neregistruje a ptá se
  znovu každou minutu. Záložka je id cíle DevTools prohlížeče. `preview_open` bez
  záložky znovu použije aktuální záložku, dokud je otevřená (kontrakt nástroje);
  vlákno bez ní dostane vlastní okno z
  `lazurio browser window --session t3-<id vlákna>`, tedy okno, ke kterému je
  navázané sezení agent-browser, a restartovaný server ho najde znovu;
  `reuseExistingTab: false` otevře další okno ve výchozím kontextu a `tabId`
  z odkazu pohledu `…/t/<id>` nebo od jiného agenta záložku předá. V jedné
  záložce běží jedna operace po druhé a člověk v ní smí pracovat současně.
  `preview_resize` a `preview_set_appearance` by změnily, co člověk vidí, a
  nahrávat host neumí: odpoví chybou, která řekne, co místo toho. Každou záložku, kterou
  `preview_open` otevře nebo převezme, zapíše host do záložek vlákna (viz níže),
  se žádostí ji ukázat, pokud nežádá práci na pozadí (`open: false`, nebo
  zastaralé `show: false`; `open` má přednost jako v desktopové aplikaci).
  `preview_open` pak odpoví `visible: true` a další `preview_status`,
  `preview_open` a `preview_navigate` vlákna odpovídají `visible: true`, dokud je
  jeho aktuální záložka otevřená; rozhoduje poslední `preview_open`. Webové T3
  na takovou žádost otevře pravý panel samo. Obrazovku člověka host nevidí:
  zavřený panel i klient bez panelu se počítají jako ukázané. Engine je
  `ServerBrowserPage.ts` serverového prohlížeče upstreamu (#15328, ac8e9453c),
  převzatý ve stavu upstream `main` 611132c1, nad Playwrightem připojeným přes
  CDP. Prohlížeč přitom zůstává prohlížečem Environmentu: Playwright nemění
  výchozí kontext (`noDefaults`), host nepřidává kontext, skript, binding ani
  user agent, dialog stránky zůstane otevřený pro toho, kdo v ní pracuje, a
  odpojení prohlížeč ani okna nezavře. Samotné připojení zapne domény CDP (Page,
  Runtime, Network, Log) ve všech stránkách prohlížeče, od první operace do
  zastavení serveru. Verze 0.0.45 je průzkumná; upstream 0.0.46 má vlastní
  serverový prohlížeč s izolovanými kontexty.
- **Server: pohled jiného Environmentu.** Agent, který přes SSH pracuje v jiném
  Environmentu, dostane odkaz na pohled jeho prohlížeče
  (`https://browser.<machine>.<org>.lazurio.io/t/<id>`, u osobního Environmentu
  `browser.<login>.lazurio.io`). Takový odkaz v `preview_open` host do prohlížeče
  tohoto Environmentu nenačte: pohled v pohledu by tento prohlížeč přihlásil do
  brány toho Environmentu. Pohled Lazuria na jiném originu, než jaký Environment
  uvádí v `link` z `lazurio browser link --json`, host zodpoví hned, bez
  prohlížeče i CLI: `tabId` té záložky, `visible: true` (pokud nežádá
  `open: false`), `view` a `message`, že ji člověk vidí v pravém panelu a agent
  ji ovládá přes `agent-browser` na tom Environmentu přes SSH, protože nástroje
  prohlížeče tohoto Environmentu na ni nedosáhnou. Každá jiná operace s touto
  záložkou (pojmenovanou i jako aktuální záložkou sezení) selže se stejnou
  radou, `preview_open` bez záložky se vrátí do okna vlákna v tomto prohlížeči a
  `preview_navigate` pohled jiného Environmentu nenačte. Zařízením, která vlákno
  ukazují, pošle server takovou záložku jako živou událost `foreign`; do souboru
  držitele ji nezapisuje, protože není tohoto hubu.
- **Záložky vlákna.** Záložky prohlížeče, které vlákno drží, žijí jen v jeho
  souboru držitele `$XDG_RUNTIME_DIR/lazurio-browser/holders/t3-<id vlákna>.json`
  (jméno je sezení agent-browser vlákna), který čte hub pohledu a podle něj
  záložku drží (LazurioPlatform F47 body 4 a 5). Vedle id je čas záznamu na
  hodinách bootu (`recordedAt`, hub ho ignoruje), takže restart, aktualizace ani
  pád T3 záložky neztratí; databáze T3 a její migrace zůstávají upstream. Server
  je drží v souladu s prohlížečem jako Launchpad: srovnává je s hubovým seznamem
  živých záložek `tabs.json` při startu, při jeho změně (sledováno, dávka změn je
  jedno srovnání), každých 30 s a před každým zápisem, a pustí jen to, co
  `keptTabs` dovolí: id, které chybí v seznamu tohoto bootu pořízeném po jeho
  záznamu. Chybějící nebo nečitelný seznam, seznam jiného bootu i chybějící
  hodiny bootu (mimo Linux) nepustí nic; nástěnné hodiny se nikde nečtou. Každý
  zápis nejdřív soubor znovu přečte a nečitelný soubor nikdy nepřepíše: jeho
  záložky zůstávají, podržení i puštění odpoví 503. Vlákno drží nejvýš 128
  záložek; další podržení odmítne (409) a žádnou kvůli němu nezahodí. Soubor bez
  záložek smaže. Kód je v `apps/server/src/lazurio/`: `holders.ts` je kopie
  pomocníků Platformy `src/browser/people/holds.ts` z 49d54c9 (pod licencí MIT,
  viz [Licence](./lazurio-fork-release.md#licence)) a jeho testy jsou její
  vektory, `threadTabs.ts` je služba, `threadTabsRoute.ts` cesta a
  `threadLifecycle.ts` jediný adaptér orchestrace.
- **Jak záložka do pásu vlákna přijde.** Podrží ji člověk (volba v Nové kartě,
  nová záložka stránky, odkaz v chatu, Vrátit), otevře nebo převezme ji
  `preview_open`, nebo sezení agent-browser vlákna `t3-<id>` naváže jinou záložku
  (server sleduje `<socket dir>/t3-<id>.target` jako hub). Vazby nalezené při
  startu se nezapisují a vazba, která se po puštění záložky nezmění, ji nevrátí:
  vrátí ji jen nové okno agenta nebo `preview_open`.
- **Cesta pro web.** `GET /api/lazurio/thread-tabs?threadId=<id>` vrátí snímek
  nebo `{"available": false}`, `GET …/events?threadId=<id>` je SSE se snímkem
  hned a při každé změně (a s událostmi `foreign`), `POST …/hold` a
  `POST …/release` s `{threadId, tabId}`. Cesta se ověřuje jako ostatní HTTP
  cesty T3 (cookie, bearer nebo DPoP; POST s cookie jen z externího originu,
  EventSource bez Origin projde) a rozsahy jsou upstream rozsahy `preview.list`,
  `preview.open` a `preview.close` (`requiredScopeForRpcMethod`). Proud má
  `cache-control: no-cache, no-transform` a `x-accel-buffering: no`, takže ho
  komprese ani proxy nezdrží. Snímek nese u každé záložky `alsoHeldBy` (jiné
  pásy, které ji drží), `agent` (pracuje v ní agent: navázané sezení s živým
  démonem) a `revealRequest` (agent ji chce ukázat). Revize snímku roste s každou
  změnou pásu, i když ho žádné zařízení neodebírá, a stejná revize je stejný
  snímek; `epoch` je běh serveru, v novém začínají revize znovu.
- **Bez služby.** Bez absolutního `XDG_RUNTIME_DIR`, nebo dokud Environment
  prohlížeč nedeklaruje (`lazurio browser link --json` s `link`, stejná
  deklarace jako u hostitele nástrojů), je služba vypnutá: odpovídá
  `{"available": false}`, nic nezapisuje a web nechá upstream panel.
- **Web: záložky v pravém panelu.** Bez desktopového náhledu
  (`window.desktopBridge.preview`) a jen pro vlákna Environmentu, který stránku
  servíruje, sleduje stránka seznam vlákna a každé zařízení srovná svůj pás s
  tímtéž seznamem. Nové záložky přidá na konec v pořadí souboru a neotevře jimi
  zavřený panel; kde už záložku ukazuje, zůstává volbou zařízení (záložky jde
  přetahovat, i povrchy overlaye). Kde není vybraný žádný povrch, nebo vybraný
  zmizel, vybere první záložku prohlížeče jako upstream srovnání svého
  prohlížeče, takže se panel otevře na ní, a ne na prázdné Nové kartě vedle
  záložek, jejichž rámy by nenačetl (vlákno přijde do zobrazení až po tom, co
  agent stránku otevřel). Povrch je `environment-browser:<ID>` (id
  velkými písmeny) bez adresy; rám ukazuje `<origin pohledu>/t/<ID>` s originem
  ze snímku. Jen záložka jiného Environmentu má uloženou adresu (`view`). Čekající
  podržení srovnání nezahodí, pozůstatky lazurio.7 (vlastní záložka vlákna, nové
  záložky na holém originu pohledu, adresy tohoto Environmentu) zahodí. Snímek
  s `available: false` nechá pás, jak je. Zařízení vezme jen snímek, který není
  starší než poslední přijatý z téhož běhu serveru (nový `epoch` začne znovu,
  opuštěný se nevrátí), takže opožděná odpověď na POST nevrátí pás, který už
  změnil proud.
- **Panel se otevře sám jen na žádost serveru.** První snímek po příchodu vlákna
  do zobrazení (a po restartu serveru) je základ; každá novější `revealRequest`
  otevře inline panel na své záložce jako automatická změna (`openProactive`,
  volba člověka mezitím má přednost). Panel se tedy otevře na `preview_open`
  (pokud nežádá `open: false`) a na nové okno agenta, ne na každé kliknutí
  agenta. Na úzké obrazovce, kde je panel sheet přes chat, se sám neotevře.
- **Nová karta.** Kde shell Environmentu definuje `<lazurio-new-tab>`, server
  záložky vlákna drží a vlákno je Environmentu stránky, otevře „+“ místo upstream
  nabídky záložku Nová karta (`environment-browser:new-tab:<uuid>`) a prázdný
  panel místo upstream seznamu ukáže Novou kartu. Element rámuje stránku
  Launchpadu `/new-tab` (adresa, Přehled, nástroje) s atributy `strip` a `tools`
  a řekne, čím se karta stala: stránka nebo záložka prohlížeče (adresa na originu
  pohledu vlákna) se z karty stane na jejím místě a vlákno ji podrží, záložka,
  kterou pás už má, přijde dopředu; nástroj spustí upstream akci „+“ a povrch,
  který otevře, zaujme místo Nové karty. Nástroje jsou dostupné upstream akce „+“
  bez Browser, který adresní řádek nahrazuje, s jejich písmeny. Písmena fungují,
  když je Nová karta vidět a fokus je v dokumentu T3; v rámu je předává stránka.
  Bez elementu (starší Platforma) zůstává upstream nabídka i prázdný stav a
  Browser je ve webu nedostupný.
- **Rozepsané vlákno** (Lazurio/t3code#53, varianta, kterou Admin zvolil
  2026-10-12). Koncept ještě není vlákno serveru: proud záložek by odpověděl
  404, který EventSource znovu nezkouší, a koncept si po první zprávě nechá
  stejný ref vlákna. Proto koncept proud neotevře a jeho prázdný panel zůstane
  upstream, jen místo „Only available in the desktop app.“ řekne pod seznamem
  i jako důvod u řádku Browser „Prohlížeč Environmentu bude k dispozici po
  první zprávě.“ Jakmile ho ChatView přestane označovat za koncept, proud se
  otevře a panel ukáže Novou kartu. Kde server o jiném vlákně řekl, že
  Environment prohlížeč nemá, zůstane upstream řádek. Menu „+“ při jiných
  otevřených površích konceptu nechává u Browser upstream důvod.
- **× pustí záložku jen pro toto vlákno.** ×, prostřední tlačítko i Zavřít,
  Zavřít ostatní, Zavřít vpravo a Zavřít vše pošlou release. Jeden toast (i pro
  Zavřít vše) řekne podle snímku, co se stane: pracuje-li v záložce agent,
  zůstává otevřená; drží-li ji Apps nebo jiné vlákno, zůstává tam; jinak se
  zavře v Environmentu po 8 s milosti hubu. **Vrátit** (7 s) vrátí záložku na
  její místo a podrží ji znovu (nový záznam), tedy uvnitř té milosti. Zavření
  poslední záložky zavře panel jako upstream. Novější záměr se záložkou (×,
  Vrátit, odkaz) zruší opakování staršího POST i účinek jeho odpovědi.
- **Sdílená záložka.** Šedá tečka u ikony záložky a její tooltip řeknou, že je
  sdílená a kde dál je: pás `launchpad` je „Apps“, `t3-*` vlákno se svým názvem,
  jiný pás jeho label; modrá tečka a tooltip řeknou „pracuje tu agent“. Řádek
  pod lištou pohledu panel nemá. Česky, má-li prohlížeč češtinu, jinak anglicky.
- **Odkaz do panelu.** Prostý klik levým tlačítkem na odkaz v chatu na jednu
  vzdálenou záložku tohoto Environmentu, přesně `https://<host>/t/<32 hex číslic>`
  na originu pohledu ze snímku vlákna, otevře záložku v pravém panelu jako povrch
  `environment-browser:<ID>` místo nové záložky prohlížeče a vlákno ji podrží. Cmd, Ctrl, Shift,
  Alt a prostřední tlačítko otevřou odkaz jako dřív. Overlay poslouchá kliknutí
  na dokumentu ve fázi capture a bere jen odkazy v řádcích časové osy chatu
  (`[data-timeline-root]`); jen u nich volá `preventDefault`. Origin pohledu zná
  stránka až z prvního snímku vlákna; do té doby odkaz otevře novou záložku
  prohlížeče.
  Stejně se otevře odkaz na záložku jiného Environmentu: přesně
  `https://browser.<labels>.lazurio.io/t/<32 hex číslic>` bez portu, ne na
  originu pohledu tohoto Environmentu ani na sesterském hostu stránky (aplikace
  Environmentu a jeho pohled jsou sourozenci pod jednou doménou), takže ho
  stránka pozná i bez odpovědi Environmentu.
- **Záložky ze stránky** (rozhodnutí 0191 bod 12, F47 bod 6). Pohled v rámu
  posílá rodiči `lazurio-browser:info` s adresou a titulkem své záložky,
  `lazurio-browser:new-tab` s adresou `/t/<id>` záložky, kterou stránka otevřela
  jako novou (odkaz s `target=_blank`), a `lazurio-browser:closed`, když jeho
  záložka skončila. Panel bere jen zprávy, jejichž `event.source` je jeho vlastní
  rám a `event.origin` je origin pohledu v rámu. Nová záložka stránky přibude v
  panelu jako povrch `environment-browser:<ID>` a vlákno ji podrží; přepne se na
  ni, jen když stránka byla vidět (jinak přibude na pozadí, typicky práce
  agenta), a tutéž vzdálenou záložku panel neotevře dvakrát. Adresa musí být
  přesně `https://<host>/t/<32 hex číslic>` na originu rámu, bez přihlašovacích
  údajů, query a fragmentu. Skončená záložka hned zmizí, vlákno ji pustí a
  starší snímek ji nevrátí (bez Vrátit, záložka už není). Záložka panelu ukazuje
  místo „Browser“ titulek, který pohled hlásí (jinak host adresy stránky);
  titulky žijí jen v paměti stránky.
- **Záložka jiného Environmentu.** Je nezaměnitelně označená barevným okrajem;
  ten Environment jmenuje čip v liště jeho pohledu. Kde se pohled nenačte
  (níže), jmenuje ho nad výzvou k přihlášení prvek shellu
  `<lazurio-environment environment="<id>" lang>` (LazurioPlatform F39, dodatek
  z 2026-10-12): stejným jménem, znakem a řádkem „pro koho“ jako přepínač jeho
  aplikací, ze stavu shellu této stránky. Id je host pohledu mezi `browser.` a
  `.lazurio.io` (`viewEnvironmentId`, například `vm-01.acme` nebo `jana`).
  Vlastní pravidlo pojmenování fork nemá. Dokud shell stránky ten Environment
  nezná, a na Platformě bez prvku, ukáže prvek jen „Prohlížeč jiného
  Environmentu“. Jazyk volí overlay jako
  pohled sám, podle jazyka prohlížeče (`cs`). Rám posílá
  `referrerPolicy="origin"`, podle kterého pohled jiného Environmentu dovolí
  zarámování T3 nebo Launchpadu (změna LazurioPlatform). Když pohled do 4 s od
  načtení rámu (15 s, když se nenačte) neohlásí svou záložku, typicky bez
  sezení v bráně toho Environmentu, ukáže panel „Přihlaste se do prohlížeče
  tohoto Environmentu“ s otevřením pohledu v nové záložce a Reload: přihlašovací
  stránka Lazuria se v rámu nevykreslí. Pohled otevře v nové záložce i menu záložky.
- **Rámy zůstávají připojené.** Dokud pravý panel ukazuje vlákno, má každá jeho
  záložka prohlížeče Environmentu svůj rám připojený, i když je vpředu jiná
  záložka nebo jiný povrch (diff, terminál, soubory), kvůli okamžitému
  přepínání. Záložky drží vlákno, ne rámy. Skryté rámy jsou neviditelné a
  `inert`, ale drží velikost panelu (`visibility`, ne `display: none`): pohled
  nastavuje vzdálenému oknu velikost své plochy a rám bez layoutu by okno
  zmenšil na 200×150, i okno agenta. Zavřením panelu nebo přechodem do jiného
  vlákna se rámy odpojí. Cena: dokud je panel otevřený, drží každá skrytá
  záložka živý přenos; snímky chodí, jen když se stránka překreslí. Nová karta
  je připojená, jen když je vpředu.
- **Rám.** Pohled je v `<iframe>` s
  `allow="clipboard-read; clipboard-write; fullscreen"` a
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"`.
  `allow-same-origin` nechá pohled v jeho vlastním originu, proto se pohled na
  originu T3 odmítne. Záložka, kterou pohled otevře sám (jeho „Otevřít
  samostatně“), je díky `allow-popups-to-escape-sandbox` obyčejná záložka
  prohlížeče, ne sandboxovaná, jako z rámu Nové karty Platformy
  (`newTabFrameSandbox`).
- **Bez hlavičky, s menu záložky** (schváleno 2026-10-13). Nad pohledem není
  hlavička ani řádek o sdílené záložce: jedinou lištou je lišta pohledu, kterou
  servíruje Platforma Environmentu (čip Environmentu, zpět, vpřed, obnovit,
  adresa; od jejího příštího vydání i Kvalita obrazu a v rámu „Otevřít
  samostatně“). Menu záložky v pásu (pravé tlačítko) má u záložky prohlížeče
  Environmentu kromě Nové karty před upstream položkami Close, Close others,
  Close to the right a Close all ještě „Open in new tab“ (pohled té záložky
  v nové záložce prohlížeče, `noopener`) a „Reload“ (nový rám jejího pohledu,
  i když záložka není vpředu); bez adresy pohledu jsou nedostupné. Jsou
  anglicky jako ostatní položky toho upstream menu; plochy, které overlay
  vlastní, mluví jazykem prohlížeče. Přihlašovací stránka brány se po vypršení
  přihlášení v rámu nevykreslí: ven vede „Open in new tab“ z menu záložky.
- **Archivace a smazání.** Archivace i smazání vlákna smaže jeho soubor
  držitele (i nečitelný) a démona sezení agent-browser vlákna požádá o
  ukončení na jeho vlastním socketu `<socket dir>/t3-<id>.sock`
  (`__agent_browser_internal_shutdown`, které posílá i CLI agent-browseru před
  restartem démona). Žádnému procesu nepošle signál podle pid, takže zastaralý
  `.pid`, jehož číslo má teď jiný proces nebo démon jiného sezení, nic
  nezastaví (LazurioPlatform#348). Když na socketu nikdo neposlouchá, démon
  neběží. Démon připojeného prohlížeče se odpojí, žádnou záložku nezavře a
  smaže svůj `.pid`, takže vazba pro hub přestane počítat. Příkaz
  `agent-browser close` se nevolá, protože by démona nejdřív spustil.
  T3 nikdy nezavírá záložku sám: záložka, kterou drží Apps nebo jiné
  vlákno nebo ji někdo sleduje, žije dál, jiná skončí po 8 s milosti hubu.
  Obnovení z archivu nic nevrátí. Podržení a archivace jdou jednou frontou
  zápisů a podržení se těsně před zápisem znovu ujistí, že vlákno žije a není
  archivované, takže archivovanému vláknu soubor nikdy nevrátí. Při startu (po
  připravenosti příkazů, aby projekce dohnala log) server smaže soubory a
  zastaví démony vláken, která už nežijí, třeba archivovaných za výpadku nebo
  za lazurio.7; jména mimo `t3-` nikdy nemění. Hodinu nečinnosti démonů
  nastavuje Platforma (`idleTimeout` v `~/.agent-browser/config.json`,
  LazurioPlatform#326), ne T3.
- **Co se nemění.** Desktop s `desktopBridge.preview` se nemění (žádný proud
  záložek, Browser je desktopový náhled), mobilní aplikace také ne; záložky
  vlákna jim server drží dál, jen je neukazují. Na úzké obrazovce je
  pohled ve stejném sheetu pravého panelu. Klávesová zkratka `preview.toggle` a
  odkazy otevírané v náhledu zůstávají jen desktopové.

Upstream soubory overlay mění jen ve švech: `rightPanelStore.ts` (druh
povrchu, jeden člen povrchu, Nová karta jako jeho singleton, druh v
`openProactive` a jedna obecná akce `lazurio`), `RightPanelTabs.tsx` (jedno
volání háčku, „+“ a prázdný stav za podmínkou Nové karty, řádek prázdného stavu
na konceptu, název, ikona, tooltip a menu záložky), `ChatView.tsx` (jedno volání háčku
s příznakem konceptu a obal, který drží rámy vedle
povrchu v popředí), `ProviderService.ts` (jedno volání), `server.ts` (jedna
vrstva overlaye vedle MCP serveru), `PreviewAutomationBroker.ts` (preferovaný
host a jeho přednost i před dřívějším přiřazením desktopu, jeho 60 s pro `open`
a vysvětlení jeho chyb), `McpHttpServer.ts` a `toolkits/preview/tools.ts` (ARIA
strom s refy pro agenta; `view` a `message` ve výsledku `preview_open`) a v
balení `apps/server/package.json` a `scripts/lib/cli-external-packages.ts`
(`playwright-core`). `ActivityPayloadProjection.ts` je zase upstream. K tomu
backport upstream 410793042 (přetahování záložek) v `RightPanelTabs.tsx`,
`rightPanelStore.ts`, `rightPanelStore.test.ts`, `ChatView.tsx` a
`routes/_chat.pull-requests.tsx`, který při přestavbě na 0.0.46 odpadne. Zbytek
je ve složkách `apps/web/src/lazurio/` a `apps/server/src/lazurio/`. Řádky časové
osy chatu poznává overlay podle atributu `data-timeline-root`, kterým je značí
upstream `MessagesTimeline.tsx`; ten se nemění. Čtení adresy pohledu
(`browserView.ts`) mají server i web každý ve vlastní kopii: sdílení přes
`packages/shared` by vyžadovalo záznam v jeho mapě exportů a tu upstream
přepisuje každých pár dní. Jméno sezení zná jen server; web ho dostává ve snímku
(`strip`). Kontraktní test hlídá švy, to, že obě kopie čtení adresy jsou stejná
funkce, seznam i podržení jen z vlastního originu, zprávy jen z vlastního rámu,
to, že se adresa záložky tohoto Environmentu nikam neukládá, cestu overlaye s
upstream rozsahy a proudem bez komprese, to, že `ActivityPayloadProjection.ts`
je upstream, a to, že hostitel nepřidává kontext, skript, binding ani user
agent. CI spouští testy všeho, co overlay mění, tedy i obou jeho složek; testy
proti skutečnému Chromiu běží jen s `LAZURIO_TEST_DEVTOOLS_ENDPOINT`
(jednorázový headless Chrome s vlastním profilem, nikdy prohlížeč, ve kterém
někdo pracuje).
