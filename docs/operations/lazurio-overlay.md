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
právě jednu vzdálenou záložku (rozhodnutí F39 LazurioPlatform). Upstream od
v0.1.0 dává webovému klientovi vlastní serverový prohlížeč (#15328), headless
chrome-headless-shell s izolovanými kontexty. Na Environmentu Lazuria je ale
jediným prohlížečem webového T3 prohlížeč Environmentu (rozhodnutí Admina
k přestavbě na v0.1.0, Lazurio/t3code#70), a tak overlay dělá tohle:

- **Server: sezení vlákna.** Procesy agentů, které T3 spouští pro jedno vlákno, a
  terminály vlákna dostanou `AGENT_BROWSER_SESSION=t3-<id vlákna>`. Jméno smí mít
  jen `[A-Za-z0-9_-]` a nejvýš 64 znaků (gramatika agent-browser a limit jeho
  dashboardu). Běžné id vlákna (UUID) se do jména vejde beze změny. Id s jinými
  znaky nebo delší (například importované vlákno `import:<instance>:<sezení>`)
  dostane místo nich `-`, zkrátí se a na konec dostane hash celého id, takže dvě
  vlákna nikdy nesdílejí sezení ani okno. Jméno nesou tři švy. Každý proces agenta
  jednoho vlákna startuje přes `AgentScope` serveru (upstream #17662); overlay
  ho obalí dekorátorem (`decorateAgentScope`, jeden řádek v `server.ts`), který
  takovému spuštění předřadí `/usr/bin/env AGENT_BROWSER_SESSION=<jméno>`. Tak
  sezení dostanou Claude Code jako nativní binárka, Pi, Muse a agenti ACP.
  Codex spouští jeden app-server pro všechna vlákna instance, takže jeho proces
  žádné vlákno nejmenuje. Jméno proto nese konfigurace každého vlákna Codexu
  (`shell_environment_policy.set.AGENT_BROWSER_SESSION` v `thread/start`,
  `thread/resume` a `thread/fork`, jeden řádek v `CodexAdapterV2.ts`) a Codex
  ho nastaví příkazům, které agent vlákna spouští; samotný app-server a jeho MCP
  servery ho nemají. Terminál vlákna startuje přes `AgentScope` bez vlákna, jen
  se jménem `terminal`, protože upstream podle vlákna vede evidenci procesů jeho
  agentů (`oomKilled`, `clear`). Jméno proto dostane v prostředí, se kterým
  správce terminálů spouští shell vlákna (`setTerminalSession`, jeden řádek
  v `terminal/Manager.ts`, Lazurio/t3code#73), a stránka, kterou v terminálu
  otevře `BROWSER` nebo `xdg-open` (na Remote Environmentu `lazurio browser open`),
  přibude do záložek vlákna jako stránka jeho agenta. Terminál, který už běží,
  ho dostane až po svém restartu. Sezení nedostanou servery OpenCode, Cursor
  (běží v procesu serveru), Grok na Linuxu (vlastní cgroup lease), Claude Code
  spuštěný jako skript a Windows. Proměnná jen pojmenovává sezení, nic
  nepovoluje a platí i při vypnutém přístupu agentů k prohlížeči T3.
- **Server: serverový prohlížeč upstreamu.** S `T3CODE_LAZURIO_FOLDER` ho
  server nestaví: místo upstream `ServerBrowser` dostane vypnutou službu bez
  záložek (`lazurio/serverBrowser.ts`, brána v `server.ts`). Prohlížeč upstreamu
  se tak u brokera náhledu neregistruje, neběží jeho úklid nečinných záložek ani
  kanál desktopu a chrome-headless-shell se pro prohlížení nestáhne ani
  nespustí. Deskriptor
  Environmentu pak `capabilities.serverBrowser` neuvádí (`ServerEnvironment.ts`),
  a proto web, desktop ani mobil serverové záložky nenabízejí. Brána, deskriptor
  i hostitel níž se ptají jednoho predikátu (`lazurio/lazurioEnvironment.ts`),
  takže oba hostitelé nikdy neběží současně. Vykreslení HTML (`html_preview`)
  zůstává upstreamu: nenačítá weby a lidem nic neukazuje. Tím odpadá
  Lazurio/t3code#43: nástroje prohlížeče T3 nepracují v headless prohlížeči bez
  přihlášení, ale v prohlížeči Environmentu.
- **Server: nástroje prohlížeče T3.** Nástroje `preview_open`,
  `preview_snapshot`, `preview_click` a další ovládají prohlížeč Environmentu,
  takže agent ve webovém T3 pracuje ve stejném okně jako `agent-browser` a člověk
  v pohledu. Hostitel uvnitř serveru T3 se u brokera náhledu registruje pod
  klientským id serverového prohlížeče upstreamu
  (`SERVER_BROWSER_AUTOMATION_CLIENT_ID`), jako preferovaný a se všemi
  serverovými operacemi. Desktop se od v0.1.0 k brokeru nepřipojuje, takže je
  hostitel na Environmentu Lazuria jediný, a s tímto id dostane agent
  vysvětlení selhání od hostitele jako upstream `reason`. Registruje se jen na
  Environmentu Lazuria (`T3CODE_LAZURIO_FOLDER`), který prohlížeč deklaruje:
  `~/.local/bin/lazurio browser link --json` skončí 0 s `{"kind":"browser-link"}`.
  Jinak (exit 10, chybějící binárka, cokoli jiného) se neregistruje a ptá se
  znovu každou minutu; bez `T3CODE_LAZURIO_FOLDER` se neptá vůbec. Záložka je
  id cíle DevTools prohlížeče. `preview_open` bez
  záložky znovu použije aktuální záložku, dokud je otevřená (kontrakt nástroje);
  vlákno bez ní dostane vlastní okno z
  `lazurio browser window --session t3-<id vlákna>`, tedy okno, ke kterému je
  navázané sezení agent-browser, a restartovaný server ho najde znovu;
  `reuseExistingTab: false` otevře další okno ve výchozím kontextu a `tabId`
  z odkazu pohledu `…/t/<id>` nebo od jiného agenta záložku předá. V jedné
  záložce běží jedna operace po druhé a člověk v ní smí pracovat současně. Na
  `open` odpoví hostitel nejpozději do 60 s, i když broker upstreamu dává 660 s,
  takže zaseknuté `lazurio browser window` nedrží požadavek 11 minut.
  `preview_resize`, `preview_set_appearance` a odpověď na dialog stránky by
  změnily, co člověk vidí, a nahrávat host neumí: odpoví chybou, která řekne,
  co místo toho. `upload` umí jen s lokátorem pole souboru (výběr souboru, který
  stránka otevře sama, zůstává člověku) a `close` záložku pro vlákno pustí jako
  × člověka a nechá ji otevřenou. Každou záložku, kterou
  `preview_open` otevře nebo převezme, zapíše host do záložek vlákna (viz níže),
  se žádostí ji ukázat, pokud nežádá práci na pozadí (`open: false`, nebo
  zastaralé `show: false`; `open` má přednost jako v desktopové aplikaci).
  `preview_open` pak odpoví `visible: true` a další `preview_status`,
  `preview_open` a `preview_navigate` vlákna odpovídají `visible: true`, dokud je
  jeho aktuální záložka otevřená; rozhoduje poslední `preview_open`. Webové T3
  na takovou žádost otevře pravý panel samo. Obrazovku člověka host nevidí:
  zavřený panel i klient bez panelu se počítají jako ukázané. Stránky ovládá
  upstream engine `preview/ServerBrowserPage.ts` (snímek s refy, klik, psaní,
  hover, výběr, tažení, soubory, klávesy, scroll, evaluate a čekání) nad
  Playwrightem připojeným přes CDP; overlay má jen navigaci a diagnostiku
  stránky (`environmentBrowserPage.ts`). Stránka připojená přes CDP nemá
  viewport Playwrightu a upstream by snímek měřil na výchozích 1280×800, proto
  `ServerBrowserPage.ts` nese malou opravu: bez viewportu změří okno
  (`innerWidth`, `innerHeight`, `devicePixelRatio`). Je k nabídnutí upstreamu,
  týká se i jeho záložek vykreslených desktopem. Prohlížeč přitom zůstává
  prohlížečem Environmentu: Playwright nemění výchozí kontext (`noDefaults`),
  host ani engine nepřidávají kontext, skript, binding ani user agent, dialog
  stránky zůstane otevřený pro toho, kdo v ní pracuje, a odpojení prohlížeč ani
  okna nezavře. Samotné připojení zapne domény CDP (Page, Runtime, Network, Log)
  ve všech stránkách prohlížeče, od první operace do zastavení serveru.
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
  cesty T3 (cookie, bearer nebo DPoP; požadavek s cookie z cizího originu
  odmítne pravidlo upstreamu #18509, EventSource bez Origin projde) a rozsahy
  jsou upstream rozsahy `preview.list`, `preview.open` a `preview.close`
  (`requiredScopeForRpcMethod`). Na v0.1.0 to je `orchestration:read` pro
  snímek a proud a `preview:operate` pro podržení a puštění (#9789), takže
  prohlížeč spárovaný na 0.0.45 záložky čte, ale do nového spárování je nedrží
  ani nepouští (403). Proud má
  `cache-control: no-cache, no-transform` a `x-accel-buffering: no`, takže ho
  komprese ani proxy nezdrží. Snímek nese u každé záložky `alsoHeldBy` (jiné
  pásy, které ji drží), `agent` (pracuje v ní agent: navázané sezení s živým
  démonem) a `revealRequest` (agent ji chce ukázat). Revize snímku roste s každou
  změnou pásu, i když ho žádné zařízení neodebírá, a stejná revize je stejný
  snímek; `epoch` je běh serveru, v novém začínají revize znovu.
- **Bez služby.** Bez absolutního `XDG_RUNTIME_DIR`, bez `T3CODE_LAZURIO_FOLDER`
  nebo dokud Environment prohlížeč nedeklaruje (`lazurio browser link --json`
  s `link`, stejná deklarace jako u hostitele nástrojů), je služba vypnutá: odpovídá
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
- **Panel se otevře sám jen na žádost serveru.** Základem je první snímek po
  načtení stránky, po restartu serveru a po návratu na vlákno, které člověk
  opustil; každá novější `revealRequest` otevře inline panel na své záložce
  jako automatická změna (`openProactive`, volba člověka mezitím má přednost).
  Panel se tedy otevře na `preview_open` (pokud nežádá `open: false`) a na nové
  okno agenta, ne na každé kliknutí agenta. Na úzké obrazovce, kde je panel
  sheet přes chat, se sám neotevře.
  - Zda člověk vlákno opustil, rozhodne trasa routeru ve chvíli, kdy se pohled
    vlákna zavře (`routeShowsThread`). Ukazuje-li trasa dál totéž vlákno
    (vlastní trasu vlákna, nebo trasu konceptu, ze kterého vzniká), šlo jen o
    nové připojení: ChatView se připojil znovu, koncept se stal vláknem, nebo se
    znovu načetl shell. Zařízení si pak pamatuje, co vidělo, a `revealRequest`,
    která přišla bez otevřeného proudu, panel otevře.
  - Po Nastavení nebo jiném vlákně je první snímek opět základ: stránka, kterou
    agent ukázal mezitím, panel neotevře.
- **Nová karta.** Kde shell Environmentu definuje `<lazurio-new-tab>`, server
  záložky vlákna drží a vlákno je Environmentu stránky, otevře „+“ místo upstream
  nabídky záložku Nová karta (`environment-browser:new-tab:<uuid>`) a prázdný
  panel místo upstream seznamu ukáže Novou kartu. „+“ je jako v upstreamu vidět
  při každém otevřeném panelu, i prázdném vedle Nové karty, a Mod+T místo
  upstream nabídky otevře další Novou kartu, jednu na stisk. Element rámuje stránku
  Launchpadu `/new-tab` (adresa, Přehled, nástroje) s atributy `strip` a `tools`
  a řekne, čím se karta stala: stránka nebo záložka prohlížeče (adresa na originu
  pohledu vlákna) se z karty stane na jejím místě a vlákno ji podrží, záložka,
  kterou pás už má, přijde dopředu; nástroj spustí upstream akci „+“ a povrch,
  který otevře, zaujme místo Nové karty. Nástroje jsou dostupné upstream akce „+“
  bez Browser, který adresní řádek nahrazuje, s jejich písmeny. Písmena fungují,
  když je Nová karta vidět a fokus je v dokumentu T3; v rámu je předává stránka.
  Bez elementu (starší Platforma) zůstává upstream nabídka, Mod+T i prázdný stav
  a Browser je ve webu nedostupný, protože server serverový prohlížeč
  neinzeruje.
- **Rozepsané vlákno** (Lazurio/t3code#53, varianta, kterou Admin zvolil
  2026-10-12). Koncept ještě není vlákno serveru: proud záložek by odpověděl
  404, který EventSource znovu nezkouší, a koncept si po první zprávě nechá
  stejný ref vlákna. Proto koncept proud neotevře a jeho prázdný panel zůstane
  upstream, jen místo „Only available in the desktop app.“ řekne pod seznamem
  i jako důvod u řádku Browser „Prohlížeč Prostředí bude k dispozici po
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
  poslední záložky zavře panel jako upstream. Do upstream paměti zavřených
  záložek (#15207) se tyto povrchy, Nová karta ani záložka jiného Environmentu
  nezapisují: Mod+Shift+T je přeskočí a cestou zpět zůstává Vrátit. Novější
  záměr se záložkou (×, Vrátit, odkaz) zruší opakování staršího POST i účinek
  jeho odpovědi.
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
  Prostředí“. Jazyk volí overlay jako
  pohled sám, podle jazyka prohlížeče (`cs`). Rám posílá
  `referrerPolicy="origin"`, podle kterého pohled jiného Environmentu dovolí
  zarámování T3 nebo Launchpadu (změna LazurioPlatform). Když pohled do 4 s od
  načtení rámu (15 s, když se nenačte) neohlásí svou záložku, typicky bez
  sezení v bráně toho Environmentu, ukáže panel „Přihlaste se do prohlížeče
  tohoto Prostředí“ s otevřením pohledu v nové záložce a Reload: přihlašovací
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
  připravenosti příkazů, tedy i po importu vláken V1) server smaže soubory a
  zastaví démony vláken, která už nežijí, třeba archivovaných za výpadku nebo
  za lazurio.7; jména mimo `t3-` nikdy nemění. Hodinu nečinnosti démonů
  nastavuje Platforma (`idleTimeout` v `~/.agent-browser/config.json`,
  LazurioPlatform#326), ne T3. Adaptér orchestrace `threadLifecycle.ts` čte od
  v0.1.0 `OrchestratorV2`: doménové události (`streamDomainEvents`, po chybě se
  k proudu za 1 s přihlásí znovu) a stav vlákna (`getThreadShell`; archivované
  ani smazané vlákno nežije). Upstream při smazání zavírá jen svá sezení náhledu
  (`preview.cleanup`) a při archivaci nic, soubory držitelů a démony
  agent-browser proto obsluhuje jen overlay. Vlákna importovaná z V1 si
  nechávají id, takže soubory držitelů z 0.0.45 platí dál.
- **Co se nemění.** Desktop s `desktopBridge.preview` se nemění: žádný proud
  záložek, Browser je jeho vlastní prohlížeč. Mobilní aplikace a app.t3.codes
  pro Environment Lazuria žádný prohlížeč nemají, protože server serverový
  prohlížeč neinzeruje. Záložky vlákna jim server drží dál, jen je neukazují.
  Na úzké obrazovce je pohled ve stejném sheetu pravého panelu. Mod+Shift+T
  záložky prohlížeče Environmentu přeskočí (viz ×). Mod+Shift+J
  (`preview.toggle`) a odkazy otevírané v náhledu zůstávají jen desktopové; web
  na Mod+Shift+J ukáže upstream hlášku.

Upstream soubory overlay mění jen ve švech: `rightPanelStore.ts` (druh
povrchu, jeden člen povrchu, Nová karta jako jeho singleton, druh v
`openProactive`, jedna obecná akce `lazurio` a přeskočení těchto povrchů
v paměti zavřených záložek), `RightPanelTabs.tsx` (jedno volání háčku, „+“
a prázdný stav za podmínkou Nové karty, jeden řádek pro Mod+T, řádek prázdného
stavu na konceptu, název, ikona, tooltip a menu záložky), `ChatView.tsx` (jedno
volání háčku s příznakem konceptu a obal, který drží rámy vedle povrchu
v popředí), `server.ts` (dekorátor `AgentScope`, brána serverového prohlížeče
upstreamu a jedna vrstva overlaye mezi cestami), `CodexAdapterV2.ts` a jeho
test (jedno rozšíření konfigurace vlákna Codexu), `terminal/Manager.ts` (sezení
v prostředí terminálu vlákna), `ServerEnvironment.ts`
(deskriptor bez `serverBrowser` na Environmentu Lazuria),
`toolkits/preview/tools.ts` (`view` a `message` ve výsledku `preview_open`)
a `preview/ServerBrowserPage.ts` s testem (velikost snímku stránky bez
viewportu). Zbytek je ve složkách `apps/web/src/lazurio/`
a `apps/server/src/lazurio/`. Řádky časové
osy chatu poznává overlay podle atributu `data-timeline-root`, kterým je značí
upstream `MessagesTimeline.tsx`; kvůli prohlížeči se nemění, overlay v něm jen
skrývá „Copy prompt link“ ([odkazy na zadání upstreamu](#odkazy-na-zadání-upstreamu)).
Čtení adresy pohledu
(`browserView.ts`) mají server i web každý ve vlastní kopii: sdílení přes
`packages/shared` by vyžadovalo záznam v jeho mapě exportů a tu upstream
přepisuje každých pár dní. Jméno sezení zná jen server; web ho dostává ve snímku
(`strip`). Kontraktní test hlídá švy, to, že obě kopie čtení adresy jsou stejná
funkce, seznam i podržení jen z vlastního originu, zprávy jen z vlastního rámu,
to, že se adresa záložky tohoto Environmentu nikam neukládá, cestu overlaye s
upstream rozsahy a proudem bez komprese, jeden predikát Environmentu Lazuria
v bráně, deskriptoru i hostiteli, klientské id a 60 s hostitele a to, že
hostitel ani upstream engine nepřidávají kontext, skript, binding ani user
agent. CI spouští testy všeho, co overlay mění, tedy i obou jeho složek; testy
overlaye proti skutečnému Chromiu běží jen s `LAZURIO_TEST_DEVTOOLS_ENDPOINT`
(jednorázový headless Chrome s vlastním profilem, nikdy prohlížeč, ve kterém
někdo pracuje). Upstream `ServerBrowserPage.test.ts` spouští vlastní
chrome-headless-shell, který si CI instaluje.

## Odkazy na zadání upstreamu

**Varianta, kterou Organization Admin schválil pro `0.1.0-lazurio.4`
(Lazurio/t3code#77): skrýt.** Upstream od v0.1.0 sdílí zadání odkazem (#18454).
„Copy prompt link“ u každé odeslané zprávy a v paletě příkazů (tam i „Copy
prompt link with repo and model“) zkopíruje odkaz na hostovanou aplikaci
upstreamu `https://app.t3.codes/new?prompt=…` s textem zadání v adrese. Na
spravovaném Environmentu (`T3CODE_LAZURIO_FOLDER`) takový odkaz vlákno neotevře:
nová vlákna začínají jen v projektu Lazurio a Scratch server nenabízí. Web proto
tyto položky nenabízí tam, kde mizí „Add project“: když zná aspoň jeden
Environment a každý z nich je spravovaný (`everyEnvironmentManaged`). Vlastní
odkaz overlaye na připravené zadání (řádek 6), který text v adrese nenese, se
nemění.

- **Švy.** `MessagesTimeline.tsx`: import, jedno volání háčku
  `usePromptLinksOffered` v řádku odeslané zprávy a podmínka tlačítka. Háček čte
  jednu odvozenou hodnotu pro celý chat (`apps/web/src/lazurio/managedPromptLinks.ts`),
  takže se zpráva znovu vykreslí jen při změně odpovědi, ne s každou změnou
  konfigurace serveru. `CommandPalette.tsx`: jedna podmínka ve vstupu obou
  položek (`promptLinkInput`). Kontraktní test hlídá obojí a to, že odkaz ke
  sdílení web staví jen na těchto dvou místech.
- **Odkaz, který přijde.** Stránku odkazu `/new` (`NewThreadLinkView.tsx`)
  overlay nemění. Na spravovaném Environmentu skončí odkaz bez `repo` hláškou
  „None of your machines can start a thread without a project right now.“, pokud
  Scratch nenabízí jiný Environment. Odkaz s `repo`, které odpovídá projektu
  z historie, otevře neodeslaný koncept se zadáním v projektu Lazurio, kam nová
  vlákna přesměrovává `useHandleNewThread.ts`. Bez takového projektu stránka
  nabídne Clone, který stráž složky odmítne („In this Environment, the Lazurio
  project is the Lazurio Folder itself.“), a „Use without project“ dopadne
  jako odkaz bez `repo`.
- **Co se nemění.** Desktopová a mobilní aplikace jsou upstreamu a položky
  nabízejí dál.

## Párování prohlížeče

**Rozhodnutí Admina 2026-10-17: Environment páruje svůj prohlížeč sám.**
Nahrazuje pravidlo z 2026-09-21 (LazurioPlatform DEV-6616), že přímá návštěva
ukáže párovací stránku T3 a fork zůstává beze změny. Do té doby se spároval jen
prohlížeč, který přišel přes Chat z Launchpadu (jednorázový token na 60 s
a `/pair#token=…`); záložka, přepínač shellu, Dashboard i Chat jiného
Environmentu skončily na párovací stránce.

- **Jak se prohlížeč spáruje.** Stránka bez platného sezení T3 se při načtení
  zeptá vlastního originu: `GET /.lazurio/chat/pairing`
  s `credentials: "same-origin"`, `redirect: "error"` a `cache: "no-store"`.
  Brána Lazuria ho z originu T3 po své admisi (přihlášení účtem Lazuria) předá
  Launchpadu Environmentu. Ten vydá jednorázový údaj příkazem
  `t3 lazurio pairing` a odpoví přesně
  `{"kind": "chat-pairing", "credential": "<údaj>", "expiresAt": "<čas>"}`
  (`expiresAt` je volitelné, údaj `[A-Za-z0-9_-]{8,128}`, jiné klíče ne).
  Stránka ho vymění jako každý jiný bootstrap údaj (`bootstrapServerAuth`), bez
  přesměrování a bez nového načtení, takže člověk token neuvidí a hluboký odkaz
  zůstane. Cokoli jiného (`index.html` T3 mimo Lazurio nebo se starší
  Platformou, jiný stav, přesměrování, chyba sítě, žádná odpověď do 5 s) nespáruje
  nic a stránka pokračuje jako upstream na párovací stránku.
- **Kdy se ptá.** Údaj z odkazu (`/pair#token=…` i `#token=…`) a údaj desktopové
  aplikace mají přednost: Environmentu se stránka zeptá jen bez obou. Desktopová
  aplikace se neptá nikdy (má vlastní bootstrap údaj), stránka přes holé HTTP
  také ne (brána Lazuria servíruje T3 jen přes HTTPS) a stránka s platným
  sezením jen tehdy, když je staré (níže).
- **Rozsahy operátora.** `t3 lazurio pairing` vydá upstream jednorázový grant
  stejnou cestou jako `t3 auth pairing create` (`createPairingLink`) se
  standardními klientskými rozsahy a s `access:read` a `access:write`
  (`OPERATOR_PAIRING_SCOPES` z konstant `packages/contracts`). Settings →
  Connections proto ukáže Authorized clients a dovolí vytvořit párovací odkaz
  (níže). Nikdy `relay:write`: T3 Connect by byl veřejnou cestou kolem brány
  a tailnetu. Sezení nesmí delegovat rozsah, který samo nemá, takže `relay:write`
  nemá ani žádný odkaz z Connections. Týmové Environmenty dostanou totéž,
  veřejné sdílené Environmenty dál standardní rozsahy; to rozhoduje Launchpad,
  ne fork. Příkaz má volby `--base-dir`, `--ttl` a `--label` a vypíše JSON
  přesně jako `t3 auth pairing create --json` (`id`, `credential`, `label`,
  `scopes`, `expiresAt`), takže ho Launchpad čte stejně. `t3 lazurio capabilities`
  uvádí `"operatorPairing": true`; podle něj Launchpad pozná T3, které příkaz má.
- **Staré sezení se spáruje znovu.** Prohlížeč spárovaný na 0.0.45 má na v0.1.0
  jen staré rozsahy (`sessionHasLegacyPermissions`), a tak nemá terminál,
  soubory, Git, nastavení ani podržení záložek prohlížeče Environmentu. Takové
  sezení se při načtení zeptá také a údaj vymění; server ho nahradí, takže
  v Authorized clients nezůstane. Když Environment údaj nevydá nebo výměna
  selže, zůstane staré sezení jako dřív. Sezení, které `sessionHasLegacyPermissions`
  nepozná (třeba po dalším rozdělení rozsahů upstreamu), se samo znovu nespáruje.
- **Desktop a mobil.** Na Environmentu v tailnetu si člověk pro desktopovou
  a mobilní aplikaci T3 vytvoří párovací odkaz v Settings → Connections,
  s rozsahy nejvýš těmi, které má jeho sezení.
- **Šev.** Upstream `apps/web/src/environments/primary/auth.ts` nese dvě volání
  v `bootstrapServerAuth`: `pairAgainWithEnvironment` před upstream návratem
  `authenticated` pro přihlášený prohlížeč a `fetchEnvironmentPairingCredential`
  jako třetí zdroj údaje za odkazem a desktopovou aplikací. Kód je
  v `apps/web/src/lazurio/environmentPairing.ts` a `apps/server/src/lazurio/cli.ts`.
  Kontraktní test hlídá obě volání, dotaz jen z vlastního originu přes HTTPS bez
  přesměrování a mimo desktop, staré sezení, které neúspěch nechá, a rozsahy
  operátora bez `relay:write`. Odkaz `/pair#token=…` se nemění a uložený grant
  nahradí dál.
