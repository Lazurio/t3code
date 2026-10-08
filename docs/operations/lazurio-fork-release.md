# Lazurio T3 Code: vydávání

Runbook pro vlastníka vydávání T3 Code v Lazuriu (Steward, dnes Pablo,
`agentrozjedemeai`). Vydání připravíš, otestuješ a spustíš sám; Organization
Admin (Matěj, `immakermatty`) ho jen schválí v GitHub environmentu.

`Lazurio/t3code` distribuuje vanilla upstream T3 Code server a web klient pro
Lazurio Mašiny. T3 vždy běží v kořeni vlastního hostname
(`https://t3code.<vm>.<org>.lazurio.io/`) za TLS reverse proxy. Oficiální
desktop a mobilní aplikace se připojují jako neupravení upstream klienti.
Vzhled a branding webového klienta zůstávají upstream; do jeho UI zasahuje jen
slot pro shell Lazuria (viz [Lazurio shell](#lazurio-shell)) a prohlížeč
Environmentu v pravém panelu (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)).

## Kanál aktualizací

GitHub Releases tohoto repozitáře jsou kanál, ze kterého se T3 Code na všech
Lazurio Mašinách instaluje a aktualizuje. Každé vydání obsahuje:

| Asset                            | K čemu                                                  |
| -------------------------------- | ------------------------------------------------------- |
| `t3-<verze>-linux-x64.tar.gz`    | headless Linux Mašiny                                   |
| `t3-<verze>-darwin-arm64.tar.gz` | Mac Mašiny (přes web verzi T3 Code)                     |
| `SHA256SUMS`                     | `sha256sum` přes finální bajty archivů, upstream formát |
| `release-evidence.json`          | zdrojový commit, upstream báze, checksumy, OCI digest   |

Archivy mají přesně upstream layout (`t3`, `client/`, `resource-monitor/`,
`node_modules/`), protože je staví upstream skripty. Launcher boot service je
stahuje z `<base>/v<verze>/SHA256SUMS` a `<base>/v<verze>/t3-<verze>-<platforma>.tar.gz`.
Mašina míří na náš kanál jedinou proměnnou `T3CODE_RELEASE_REPOSITORY=Lazurio/t3code`
v drop-inu služby: podle ní server čte index vydání, ukazuje banner a stahuje
z `https://github.com/Lazurio/t3code/releases/download`. `T3CODE_RELEASE_BASE_URL`
je jen pro zrcadlo a Machines ho nenastavují.

Publikace nikoho automaticky nepřepne. Mašina přejde na novou verzi, až
uživatel klikne na Update, nebo až někdo spustí `t3 update`.

Kanál vydání se odvozuje z verze stejně jako upstream (`cliReleaseChannelOf`):

| Kanál     | Verze                      | Kdo ji dostane                                                                                                                                                      |
| --------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stable`  | `X.Y.Z-lazurio.N`          | Všechny Mašiny pod launcherem: server ji ohlásí jako `availableServerUpdate` a webová T3 ukáže tlačítko Update.                                                     |
| `preview` | `X.Y.Z-preview.YYYYMMDD.N` | Jen Mašina, kde ji někdo výslovně nainstaluje `t3 update <verze>` s potvrzením v terminálu. Preview se nikdy nenabízí a server na preview aktualizace nekontroluje. |

Preview je canary: nejdřív ho nainstaluješ na vybrané Mašiny, a až obstojí,
vydáš stable ze stejného commitu. Nightly nevydáváme. Příznak GitHub
„pre-release“ sám nic neskrývá (index přeskakuje jen drafty); rozhoduje tvar
verze. Workflow přesto vydá preview jako pre-release a nikdy jako latest, aby
ho člověk na stránce vydání nespletl se stable.

Na macOS je binárka podepsaná ad hoc, stejně jako upstream bez `CSC_LINK`.
Archiv stažený launcherem nemá atribut karantény, takže ho Gatekeeper
neblokuje. Archiv stažený ručně prohlížečem je potřeba odkaranténovat
(`xattr -dr com.apple.quarantine <adresář>`).

### Verze

Stable verze je `X.Y.Z-lazurio.N`, tag `vX.Y.Z-lazurio.N`. `X.Y.Z` je
upstream stable tag, na kterém `main` stojí. `N` začíná na 1 a roste s každým
vydáním nad stejnou upstream bází. Nová upstream báze začíná znovu od `.1`.
Verze `X.Y.Z-lazurio.0` nikdy nevychází, používá ji jen CI.

Preview verze je `X.Y.Z-preview.YYYYMMDD.N` (upstream tvar), tag
`vX.Y.Z-preview.YYYYMMDD.N`. `X.Y.Z` je opět upstream báze `main`, datum je
den vydání (UTC) a `N` začíná v každém dni na 1.

Workflow odmítne verzi, která není vyšší než všechna publikovaná vydání
**stejného kanálu**. Upstream `newestCliReleaseVersion` bere první vydání
kanálu v indexu podle data publikace; overlay sice vybírá nejvyšší verzi, ale
pravidlo drží obě varianty v souladu. Preview a stable spolu nesoupeří, takže
`0.0.44-lazurio.1` jde vydat i po `0.0.44-preview.20260930.1`.

SemVer řadí `X.Y.Z-lazurio.N` pod `X.Y.Z-preview.…` (`lazurio` < `preview`)
a obojí pod vanilla `X.Y.Z`. Z preview na stable proto vede jen výslovný
návrat `t3 update --channel stable --allow-downgrade`; tlačítko ho nenabídne.

Pozor na SemVer: `0.0.42-lazurio.1` je nižší než `0.0.42`. Mašina, která dnes
běží na nativním buildu Machines hlášeném jako `0.0.42`, proto první přechod na
kanál neudělá tlačítkem. Poprvé ji převeď přes pin v Machines nebo
`t3 update 0.0.42-lazurio.1 --allow-downgrade`. Další vydání už tlačítko
nabídne normálně.

## Overlay

`main` je přesný upstream stable tag a nad ním jen tyto commity:

| Commit                                                                         | Proč ho Lazurio potřebuje                                                                                                                                                                                                                                                                                                                                       | v0.0.45                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `hosted: configurable client session TTL`                                      | `T3CODE_CLIENT_SESSION_TTL` (Machines nastavuje `365d`).                                                                                                                                                                                                                                                                                                        | retain: upstream má pevných 30 dní                                                                                                       |
| `hosted: serve behind an explicit HTTPS external origin`                       | `T3CODE_EXTERNAL_ORIGIN`: server na loopbacku za proxy je dosažitelný zvenku, používá Secure cookie `__Host-t3_session` a mutace a WebSocket upgrady autentizované cookie přijímá jen z tohoto originu.                                                                                                                                                         | retain: upstream ekvivalent nemá                                                                                                         |
| `hosted: explicit environment label`                                           | `T3CODE_ENVIRONMENT_LABEL` pojmenuje kontejnerový Workspace (například `Acme / Management`).                                                                                                                                                                                                                                                                    | retain: upstream čte jen `PRETTY_HOSTNAME` a hostname, Machines nastavují proměnnou                                                      |
| `feat: in-app update from the configured release channel`                      | `T3CODE_RELEASE_REPOSITORY` a server-advertised `availableServerUpdate`: Mašina nabízí aktualizaci na nejvyšší vydání z nastaveného repozitáře a instaluje ho tlačítkem Update. Navrženo upstreamu.                                                                                                                                                             | retain: upstream má pevné `pingdotgg/t3code` a bere první vydání kanálu                                                                  |
| `release: Lazurio distribution`                                                | Tento dokument, `Dockerfile.lazurio`, `.dockerignore`, kontraktní test a workflow `lazurio-fork-ci.yml`, `lazurio-cli-archives.yml` a `lazurio-release.yml`.                                                                                                                                                                                                    | retain                                                                                                                                   |
| `lazurio: unsent prompt draft by link from the shell`                          | „+ Nový modul“ otevře Chat se zadáním v poli zprávy nového vlákna, neodeslaným ([Zadání z Launchpadu](#zadání-z-launchpadu)).                                                                                                                                                                                                                                   | retain: upstream nemá vstup pro koncept zprávy zvenku                                                                                    |
| `feat(web): Lazurio shell slot`                                                | Slot pro shell Lazuria ve webovém klientovi: načtení `/.lazurio/shell.js`, rail vedle aplikace, hlavička sloupce nahoře v sidebaru a Buddy (viz [Lazurio shell](#lazurio-shell)). Mimo Lazurio se nic nevykreslí.                                                                                                                                               | retain: upstream ekvivalent nemá                                                                                                         |
| `feat(server): each thread's provider processes get its agent-browser session` | Každý proces poskytovatele, který T3 spustí pro vlákno, dostane `AGENT_BROWSER_SESSION=t3-<id vlákna>`: agenti vlákna pracují ve vlastním okně prohlížeče Environmentu (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)).                                                                                                                                 | retain: rozhodnutí 0191 / plán DEV-6646; upstream ekvivalent nemá                                                                        |
| `feat(web): the right panel's Browser shows the Environment browser`           | Webový klient nemá vlastní prohlížeč. Bez desktopového náhledu ukáže Browser v pravém panelu pohled prohlížeče Environmentu, pokud ho Environment nabízí, a sám se otevře, když agent vlákna začne s prohlížečem pracovat (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)).                                                                              | retain: rozhodnutí 0191 / plán DEV-6646; webové UI nemá prohlížeč, tohle je zdokumentovaný minimální zásah do UI                         |
| `feat(server): T3's browser tools drive the Environment browser`               | Nástroje prohlížeče T3 (`preview_open`, `preview_snapshot`, …) ovládají prohlížeč Environmentu i ve webovém T3 (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)). Spolu s ním porty z upstream 611132c1: preferovaný host v brokeru, vysvětlení chyb preferovaného hostitele, ARIA strom pro agenta, `playwright-core` vedle CLI bundlu a engine stránky. | retain: rozhodnutí 0191 / plán DEV-6646; na v0.0.46 porty odpadnou a upstream serverový prohlížeč se nasměruje na prohlížeč Environmentu |

Nenastavené proměnné zachovají upstream chování. Commit odstraň, jakmile
upstream nabídne ekvivalent. Klienty, sdílené balíčky a wire kontrakty
(`apps/web`, `apps/mobile`, `apps/desktop`, `packages/`) overlay mění jen v
přesných souborech z allowlistu `allowed_upstream_changes` v
`lazurio-fork-ci.yml`. Každý záznam je vědomé rozhodnutí se zdůvodněním;
jakoukoli jinou změnu pod těmito cestami CI odmítne. Verze se razítkují jen při buildu
upstream skriptem `scripts/update-release-package-versions.ts`, do Gitu se
necommitují.

### Lazurio shell

**Rozhodnuto 2026-10-03 (rozhodnutí o shellu Lazuria); slot je v overlayi od
issue #33.** V Lazuriu je T3 Code aplikace **Chat** v přepínači Chat · Apps ·
Automate. Overlay do webového klienta přidává jen slot pro shell Lazuria: rail
vlevo, hlavičku sloupce (výběr Environmentu, ozubené kolo Nastavení a přepínač
Chat · Apps · Automate) nahoře ve vlastním sidebaru T3 a plovoucí bublinu
Buddyho. Shell jsou Web Components se Shadow DOM (`<lazurio-rail>`,
`<lazurio-column-head>`, `<lazurio-buddy>`), takže CSS T3 a Lazuria se navzájem
neovlivní. Definuje je `/.lazurio/shell.js`, který servíruje Launchpad daného
Environmentu na stejném originu za bránou Environmentu; data má v
`/.lazurio/shell.json` (LazurioPlatform rozhodnutí F36). Fork data Lazuria
nezná a sám nic nenačítá, takže nový rail, nový výběr ani nová data
nepotřebují vydání forku. Fork se smí spolehnout jen na rozhraní v1 z
LazurioPlatform `src/shell/interface.ts`.

Slot jsou dva upstream soubory, každý jako vlastní řádek v
`allowed_upstream_changes`:

- `apps/web/index.html`: modulový skript `/.lazurio/shell.js` s atributem
  `vite-ignore` (Vite značku nechá být a nic nebunduje), `<lazurio-rail>` před
  `#root` a `<lazurio-buddy>` za ním. Dál
  `#root { box-sizing: border-box; padding-left: var(--lazurio-rail-width, 0px); }`:
  odsazení, ne posun, protože `#root` má v upstreamu `width: 100%` pod
  `body` s `overflow: hidden` a `margin-left` by pravý okraj uřízl. Sidebar T3
  a jeho přepínač jsou ale `position: fixed` vůči oknu a samotné odsazení by je
  nechalo pod railem. Proto se při definovaném railu stane obal sidebaru
  (`[data-slot="sidebar-wrapper"]`) jejich containing blockem
  (`contain: layout paint`). Bez shellu pravidlo neplatí.
- `apps/web/src/components/AppSidebarLayout.tsx`:
  `<lazurio-column-head active="chat">` jako první prvek sidebaru, nad horním
  řádkem upstreamu s logem T3 Code, který zůstává se všemi ovládacími prvky
  (rozhodnutí 0179 bod 6: vzhled a branding upstreamu zůstávají). Jedno místo
  platí pro sidebar vláken, legacy sidebar i Nastavení. Přepínač sidebaru je
  `position: fixed` u horního okraje, takže se při otevřeném sidebaru na
  desktopu posune dolů o výšku hlavičky sloupce, s horním řádkem sidebaru.

Kontraktní test hlídá obojí, takže přestavba na nový upstream tag, která slot
ztratí, v CI selže. Přepínač i rail vedou obyčejnými odkazy na jiné originy
Environmentu (`launchpad.…`, `mausbot.…`), takže router T3 se nemění.

**Barvy shellu (rozhodnutí 0187, 2026-10-04).** Rail, hlavička sloupce a
seznam Environmentů berou barvy aplikace, ve které sedí. `index.html` proto
nastaví dvanáct barevných rolí shellu (`--lazurio-surface`, `--lazurio-ink`,
… `--lazurio-focus`) z vlastních tokenů sidebaru T3: plocha je `--sidebar`,
text, hairline a text seznamu jsou `--contrast-*` varianty, které T3 sám
kreslí (respektují nastavení kontrastu ve Vzhledu), seznam je `--popover` a
fokus `--ring`. Role jsou jen odkazy na tokeny, takže shell sleduje každý
motiv T3, světlý i tmavý, i jeho přepnutí za běhu. Vlastní výběr motivů má
zatím každá aplikace; sjednocení motivů napříč aplikacemi je samostatná
pozdější práce.

Mezi railem a sidebarem T3 nesmí být vidět čára. Proto:

- Role jsou deklarované na `:root` i na `[data-app-sidebar]`, tedy tam, kde
  T3 přepočítává paletu svého sidebaru, a `<lazurio-rail>` nese
  `data-app-sidebar`. Ve výchozím tmavém motivu má sidebar T3 vlastní paletu
  (`#000`), kdežto `--sidebar` dokumentu je o odstín světlejší; bez toho by
  rail vedle sidebaru tvořil hranu.
- Rail nosí zrnitost `--surface-grain`, kterou T3 dává svým plochám. Bez ní
  se rail od sidebaru liší o 1–3 z 255 úrovní jasu a hrana je vidět.
- Kontejner sidebaru T3 má okraj jen vpravo, mezi sidebarem a hlavní plochou,
  a ten zůstává. Levá hrana sidebaru ani `#root` okraj nemají.

Atribut `data-app-sidebar` je v upstreamu jen CSS scope palety; žádný skript
ho nevyhledává. Kdyby to upstream začal dělat, našel by jako první rail.
Kontraktní test proto hlídá mapování rolí, tokeny v `index.css` i to, že
atribut v `apps/web/src` používá jen `AppSidebarLayout.tsx`. Přestavba, která
cokoli z toho poruší, v CI selže a vyžaduje nové rozhodnutí.

Vzhled a branding zůstávají upstream až do stabilních vydání upstreamu: T3
Code nepřebarvujeme ani nepřejmenováváme a dál o něm mluvíme jako o T3 Code.
Mimo Lazurio se nic nevykreslí: bez `/.lazurio/shell.js` (samostatný server,
vývoj upstreamu) zůstanou elementy nedefinované, šířka railu je 0, hlavička
sloupce má výšku 0 a klient se chová jako upstream. Server T3 na neznámou
cestu vrátí `index.html`, takže prohlížeč jen zaloguje neúspěšné načtení
skriptu. Oficiální desktop a mobilní aplikace jsou upstream
a shell nemají.

### Zadání z Launchpadu

**Implementováno (Lazurio/t3code#35).** „+ Nový modul“ v Apps otevře Chat
téhož Environmentu s připraveným zadáním v poli zprávy nového vlákna. Zadání
se nikdy neodešle samo; odešle ho až člověk.

- Launchpad otevře Chat přes párování a za token přidá do fragmentu
  `lazurio-prompt=<id>&lazurio-org=<GitHub login Organizace>`, bez párování
  na holý origin. Odkaz nikdy nenese text. Fragment se neposílá na server ani
  do logu a T3 bez overlaye ho ignoruje.
- `main.tsx` při startu odkaz z adresy odebere (`captureLazurioPromptLink`),
  dřív než ho přečte router nebo párování; token zůstane.
- Až je primární environment načtený, `<LazurioPromptDraft />` v layoutu
  `_chat` stáhne text z vlastního originu:
  `GET /.lazurio/prompts/<id>?org=<login>` (brána Environmentu ho za stejným
  přihlášením předá Launchpadu), `credentials: "same-origin"`,
  `redirect: "error"`. Přijme jen JSON `lazurio.prompt.v1` se stejným `id`,
  neprázdným `text` do 16 KiB a absolutním `cwd`.
- Otevře nové vlákno v projektu primárního environmentu s kořenem `cwd`.
  Když takový projekt není, přidá složku jako projekt, jako to dělá „Add
  project“, ale bez zakládání složky. Text vloží do pole zprávy, nic
  neodešle.
- Neznámé `id`, neúspěšný nebo přesměrovaný fetch, jiný tvar odpovědi nebo
  cizí origin nevloží nic. Člověk uvidí jen chybový toast „Could not open the
  prepared prompt“.
- Kdo zadání dostane, rozhoduje Launchpad. Dnes jediné zadání `new-module`
  dostane jen Environment, jehož GitHub identita je Owner Organizace. Komukoli
  jinému odpoví stejným 404.

Launchpad podává zadání odkazem jen tam, kde to T3 na Environmentu umí: zeptá
se `t3 --version` a odkaz použije od prvního vydání s tímto overlayem
(`0.0.45-lazurio.2`, preview od `0.0.45-preview.20261004.1`). Jinde zadání
zkopíruje do schránky jako dřív. **Při vydání ověř, že první vydání s tímto
commitem má právě tato čísla.** Jinak je oprav v Lazurio/LazurioPlatform
(`chatPromptsSince` v `src/launchpad/chat.ts`).

Overlay se dotýká jen dvou řádků upstream souborů: zachycení v `main.tsx`
a `<LazurioPromptDraft />` v `routes/_chat.tsx`. Zbytek je ve složce
`apps/web/src/lazurio/`. Všech pět souborů je v allowlistu. Kontraktní test
hlídá, že zachycení proběhne před vytvořením routeru, že layout komponentu
vykreslí, že text přichází jen z vlastního originu bez přesměrování a že
overlay nemá cestu, jak zprávu odeslat. CI spouští testy overlaye
(`vp test run src/lazurio`).

### Prohlížeč Environmentu

**Rozhodnutí 0191 (plán DEV-6646, Lazurio/t3code#40).** Na Remote
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
  nahrávat host neumí: odpoví chybou, která řekne, co místo toho. `preview_open`
  odpoví `visible: true` a vlákno si zapamatuje, že záložku ukázalo, pokud
  nežádá práci na pozadí (`open: false`, nebo zastaralé `show: false`; `open` má
  přednost jako v desktopové aplikaci). Další `preview_status`, `preview_open` a
  `preview_navigate` vlákna pak odpovídají `visible: true`, dokud je jeho
  aktuální záložka otevřená; rozhoduje poslední `preview_open`. Webové T3 totiž
  při práci agenta s prohlížečem otevře pravý panel samo (viz níže). Obrazovku
  člověka host nevidí: zavřený panel i klient bez panelu se počítají jako
  ukázané. Engine je
  upstream `ServerBrowserPage.ts` (611132c1) nad Playwrightem připojeným přes
  CDP. Prohlížeč přitom zůstává prohlížečem Environmentu: Playwright nemění
  výchozí kontext (`noDefaults`), host nepřidává kontext, skript, binding ani
  user agent, dialog stránky zůstane otevřený pro toho, kdo v ní pracuje, a
  odpojení prohlížeč ani okna nezavře. Samotné připojení zapne domény CDP (Page,
  Runtime, Network, Log) ve všech stránkách prohlížeče, od první operace do
  zastavení serveru. Verze 0.0.45 je průzkumná; upstream 0.0.46 má vlastní
  serverový prohlížeč s izolovanými kontexty.
- **Web: Browser v pravém panelu.** Bez desktopového náhledu
  (`window.desktopBridge.preview`) a jen pro vlákna Environmentu, který stránku
  servíruje, se pravý panel při otevření zeptá na vlastním originu
  `GET /.lazurio/browser.json?session=<jméno>` (`credentials: "same-origin"`,
  `redirect: "error"`, `cache: "no-store"`, timeout 10 s). Odpověď 200
  `{"available": true, "view": "<https URL>", "session": "<jméno>" | null}`
  Browser povolí. Cokoli jiného (`available: false`, 404 staršího Launchpadu,
  400, chyba sítě, odpověď mimo JSON včetně `index.html` T3, pohled mimo
  `https:` nebo na originu T3, jiné sezení) nechá Browser vypnutý s upstream
  textem.
- **Povrch.** Otevření přidá povrch `environment-browser`, vlastní záložku
  vlákna. Druh `preview` to být nemůže, protože `reconcileBrowserSurfaces` maže
  náhledy bez živé záložky serveru. Na vlastní záložku vlákna se povrch ptá při
  každém otevření i při Reload, protože ji zná jen Environment. Její URL žije
  jen ve stavu komponenty, nikdy v localStorage ani v nastavení; uložený popis
  povrchu je jen `{id, kind}`.
- **Panel se otevře sám.** Když agent vlákna, které má člověk otevřené, začne
  pracovat s prohlížečem, pravý panel se otevře na vlastní záložce vlákna, tedy
  na povrchu, který člověk volí jako Browser. Overlay to čte z aktivit vlákna
  (`browserUse.ts`): volání `preview_open`, `preview_navigate`, `preview_click`,
  `preview_type`, `preview_press`, `preview_scroll`, `preview_snapshot`,
  `preview_evaluate` nebo `preview_wait_for` (ne `preview_status`, velikost ani
  nahrávání), nebo příkaz, který spustí `agent-browser` s příkazem nad stránkou
  (ne instalaci, nápovědu, sezení, `read` ani `close`) nebo
  `lazurio browser window`. Příkaz se čte jako řádka shellu, i v uvozovkách, za
  `bash -lc`, `env`, `sudo`, `timeout` nebo `npx` a v `$(…)`; argument, citovaný
  text, here-dokument ani komentář, které `agent-browser` jen zmiňují, se
  nepočítají. Panel se otevře, jen když Environment prohlížeč nabízí (týž dotaz
  na `/.lazurio/browser.json` jako u Browser), a nic nedělá, když už prohlížeč
  Environmentu ukazuje. Počítají se jen aktivity, které přijdou, když je vlákno
  otevřené a synchronizované, a každá novější než vše, co panel o vlákně viděl:
  historie při otevření vlákna, po obnovení stránky, dohnané události ani
  starší stránka historie panel neotevřou. Jedno volání nástroje ho otevře
  nejvýš jednou (podle `toolCallId`). Když člověk panel zavře nebo přepne na jiný
  povrch, další volání agenta ho otevře znovu; volba, kterou člověk udělá,
  zatímco se panel ptá Environmentu, má přednost (automatická změna přes
  `openProactive`). Na úzké obrazovce, kde je panel sheet přes chat, se sám
  neotevře: zakryl by chat a vzal fokus poli zprávy.
- **Odkaz do panelu.** Prostý klik levým tlačítkem na odkaz v chatu na jednu
  vzdálenou záložku tohoto Environmentu, přesně `https://<host>/t/<32 hex číslic>`
  na originu pohledu, který Environment naposledy uvedl v odpovědi
  `/.lazurio/browser.json`, otevře záložku v pravém panelu jako povrch
  `environment-browser:<id>` místo nové záložky prohlížeče. Cmd, Ctrl, Shift,
  Alt a prostřední tlačítko otevřou odkaz jako dřív. Overlay poslouchá kliknutí
  na dokumentu ve fázi capture a bere jen odkazy v řádcích časové osy chatu
  (`[data-timeline-root]`); jen u nich volá `preventDefault`. Origin pohledu zná
  stránka až z první odpovědi Environmentu od načtení (otevřený panel nebo
  práce agenta s prohlížečem); do té doby odkaz otevře novou záložku prohlížeče.
- **Záložky ze stránky** (rozhodnutí 0191 bod 12). Pohled v rámu posílá rodiči
  `lazurio-browser:info` s adresou a titulkem své záložky a
  `lazurio-browser:new-tab` s adresou `/t/<id>` záložky, kterou stránka otevřela
  jako novou (odkaz s `target=_blank`). Panel bere jen zprávy, jejichž
  `event.source` je jeho vlastní rám a `event.origin` je origin pohledu v rámu.
  Nová záložka stránky otevře v panelu povrch `environment-browser:<id>` a
  přepne na něj; tutéž vzdálenou záložku panel neotevře dvakrát. Adresa musí
  být přesně `https://<host>/t/<32 hex číslic>` na originu rámu, bez
  přihlašovacích údajů, query a fragmentu. Token nenese, takže se povrch ukládá
  jako `{id, kind, view}` a přežije obnovení stránky; verze úložiště pravého
  panelu se nemění. Záložka panelu ukazuje místo „Browser“ titulek, který
  pohled hlásí (jinak host adresy stránky); titulky žijí jen v paměti sezení.
  Lišta pohledu s nabídkou nové záložky funguje dál. Novou záložku ze stránky ve
  skryté záložce panelu (typicky práci agenta) panel přidá na pozadí a zobrazený
  povrch nepřepne.
- **Rámy zůstávají připojené.** Dokud pravý panel ukazuje vlákno, má každá jeho
  záložka prohlížeče Environmentu svůj rám připojený, i když je vpředu jiná
  záložka nebo jiný povrch (diff, terminál, soubory). Skryté rámy jsou
  neviditelné a `inert`, ale drží velikost panelu (`visibility`, ne
  `display: none`): pohled nastavuje vzdálenému oknu velikost své plochy a rám
  bez layoutu by okno zmenšil na 200×150, i okno agenta. Přepínání záložek a
  povrchů tak sledující neodpojí a záložky ze stránky žijí dál. Zavřením panelu
  nebo přechodem do jiného vlákna se rámy odpojí. Služba pohledu záložku ze
  stránky zavře 30 s poté, co ji nikdo nesleduje (F39 bod 9), takže se může
  vrátit jako „Tahle záložka už neexistuje“; člověk pak odkaz otevře znovu ze
  záložky agenta. Zavření záložky panelu křížkem odpojí její rám a Environment
  vzdálenou záložku po 30 s zavře. Cena: dokud je panel otevřený, drží každá
  skrytá záložka ze stránky živý přenos; snímky chodí, jen když se stránka
  překreslí.
- **Rám.** Pohled je v `<iframe>` s
  `allow="clipboard-read; clipboard-write; fullscreen"` a
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"`.
  `allow-same-origin` nechá pohled v jeho vlastním originu, proto se pohled na
  originu T3 odmítne. Hlavička má Reload a „Open in new tab“ (`target=_blank`,
  `rel=noopener`) na tutéž URL: přihlašovací stránka brány se po vypršení
  přihlášení v rámu nevykreslí.
- **Co se nemění.** Desktop s `desktopBridge.preview` se nemění (žádný dotaz,
  Browser je desktopový náhled), mobilní aplikace také ne. Na úzké obrazovce je
  pohled ve stejném sheetu pravého panelu. Klávesová zkratka `preview.toggle` a
  odkazy otevírané v náhledu zůstávají jen desktopové.

Upstream soubory overlay mění jen ve švech: `rightPanelStore.ts` (druh
povrchu, akce `openEnvironmentBrowserTab` a povrch prohlížeče Environmentu v
`openProactive`), `RightPanelTabs.tsx` (název a ikona záložky, bez volby
desktopového profilu tam, kde desktopový náhled chybí), `ChatView.tsx`
(povolení Browser, rámy záložek vedle povrchu v popředí, titulky záložek a
jedno volání háčku, který otevírá panel při práci agenta s prohlížečem a z
odkazu v chatu), `ProviderService.ts` (jedno volání), `server.ts` (vrstva
hostitele nástrojů vedle MCP serveru), `PreviewAutomationBroker.ts`
(preferovaný host a jeho přednost i před dřívějším přiřazením desktopu, jeho
60 s pro `open` a vysvětlení jeho chyb),
`McpHttpServer.ts` a `toolkits/preview/tools.ts` (ARIA strom s refy pro agenta)
a v balení `apps/server/package.json` a `scripts/lib/cli-external-packages.ts`
(`playwright-core`). Zbytek je ve
složkách `apps/web/src/lazurio/` a `apps/server/src/lazurio/`. Řádky časové osy
chatu poznává overlay podle atributu `data-timeline-root`, kterým je značí
upstream `MessagesTimeline.tsx`; ten se nemění. Funkci pro jméno
sezení mají server i web každý ve vlastní kopii: sdílení přes `packages/shared`
by vyžadovalo záznam v jeho mapě exportů a tu upstream přepisuje každých pár
dní. Kontraktní test hlídá, že obě kopie jsou stejná funkce, švy, URL jen z
vlastního originu bez přesměrování, zprávy jen z vlastního rámu, to, že se URL
vlastní záložky vlákna nikam neukládá, švy hostitele nástrojů a to, že hostitel
nepřidává kontext, skript, binding ani user agent. Hlídá i švy panelu, který se
otevírá sám: jedno volání háčku v `ChatView.tsx`, automatické otevření přes
`openProactive`, kliknutí jen v řádcích `data-timeline-root` a `visible`
hostitele. CI spouští testy overlaye
serveru i webu (`vp test run src/lazurio`); testy proti skutečnému Chromiu
běží jen s `LAZURIO_TEST_DEVTOOLS_ENDPOINT` (jednorázový headless Chrome s
vlastním profilem, nikdy prohlížeč, ve kterém někdo pracuje).
`/.lazurio/browser.json` servíruje Launchpad Environmentu, takže změna pohledu
vydání forku nepotřebuje.

## Kdy vydávat

- **Nový upstream stable** (`pingdotgg/t3code` vydal `vX.Y.Z`): přestav
  overlay na nový tag (viz další sekce) a vydej `X.Y.Z-lazurio.1`.
- **Vlastní oprava nebo změna overlaye** na stejné bázi: po merge do `main`
  vydej další `-lazurio.N`.
- **Canary před stable:** z téže špičky `main` nejdřív vydej preview
  `X.Y.Z-preview.YYYYMMDD.N`, nainstaluj ho na canary Mašiny a teprve po
  jejich ověření vydej stable. Oprava během canary je nový commit na `main`
  a další preview `.N+1`.
- Nevydávej nightly a nevydávej z jiné branche než `main`.
- PR do `main` se mergují jen rebase, bez merge commitu. Release i CI odmítnou
  merge commit nad upstream tagem. Main ruleset 21717536 to vynucuje:
  povoluje jen `rebase` a vyžaduje lineární historii. Readback:
  `gh api repos/Lazurio/t3code/rulesets/21717536 --jq '[.rules[] | select(.type == "pull_request") | .parameters.allowed_merge_methods], [.rules[].type]'`
  vrátí `[["rebase"]]` a mezi typy `required_linear_history`.

**Brána před prvním vydáním.** První vydání spusť, až platí obojí:

- PR s in-app aktualizací z nastaveného kanálu (#19) je mergnutý do `main`.
  Bez něj Mašiny tlačítko Update z našeho kanálu nenabídnou.
- `lazurio-fork-ci.yml` na `main` obsahuje allowlist
  `allowed_upstream_changes`:
  `gh api 'repos/Lazurio/t3code/contents/.github/workflows/lazurio-fork-ci.yml?ref=main' --jq .content | base64 -d | grep -q allowed_upstream_changes`.

## Přestavba na nový upstream tag

`main` je rolling patch-stack. Starý `main` se neslučuje ani nepřehrává
hromadně. Přestavbu připravuješ ty (Steward): candidate branch, checky a
přesné SHA. Samotnou výměnu `main` provádí Organization Admin, tedy Matěj,
nebo jeho Task Agent na jeho explicitní pokyn. Používá k tomu existující bypass
`OrganizationAdmin` v main rulesetu 21717536. Ostatním force-push dál blokuje
pravidlo `non_fast_forward` a běžné PR a check ochrany platí pro všechny beze
změny.

1. Z přesného upstream stable tagu založ candidate branch. Každý commit
   overlaye přenes podle záměru (`git cherry-pick`, případně ručně) a overlay
   zmenši o všechno, co už upstream umí.
2. V `lazurio-fork-ci.yml` aktualizuj `UPSTREAM_TAG`, `UPSTREAM_SHA` a verzi
   `X.Y.Z-lazurio.0` u jobu `cli-archives`. Kontraktní test hlídá, že sedí
   k `UPSTREAM_TAG`.
3. Při každé přestavbě znovu projdi allowlist `allowed_upstream_changes`.
   Soubor, který overlay už nemění nebo jehož změnu převzal upstream, z něj
   odeber. Nový soubor přidej jen jako vědomé rozhodnutí se zdůvodněním.
4. Otevři PR a počkej na zelené `Lazurio Fork CI`. Pak předej Adminovi
   přesný starý `main` (`expected_old_main`) a přesný nový head
   (`candidate_head`) spolu s odkazem na zelený běh.
5. Než se `main` přepne, musí být současný `main` zachycený publikovaným
   **immutable** vydáním `v…-lazurio.N`. Jiný tag nestačí. Tag vydání míří
   buď přesně na starý `main`, nebo na jeho předka, od kterého se starý
   `main` liší jen v `docs/`. Takové commity nemění nic, co se vydává, a
   jejich obsah přejde do nového `main` s přestavěným overlayem; kvůli nim
   se samostatné vydání nedělá (rozhodnutí Admina 2026-10-02, DEV-6633).
   Ověř obojí a že vydání je immutable:

   ```bash
   git fetch origin main --tags
   expected_old_main="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
   capture=v0.0.44-lazurio.1   # poslední vydání
   capture_sha="$(gh api "repos/Lazurio/t3code/git/ref/tags/$capture" --jq .object.sha)"
   git merge-base --is-ancestor "$capture_sha" "$expected_old_main"
   git diff --quiet "$capture_sha" "$expected_old_main" -- . ':(exclude)docs/'
   test "$(gh api "repos/Lazurio/t3code/releases/tags/$capture" --jq .immutable)" = true
   ```

   Pokud starý `main` mění proti poslednímu vydání cokoli mimo `docs/`,
   vydej ho nejdřív. Docs commity starého `main` přenes do candidate. Admin
   pak ověří, že bypass existuje:

   ```bash
   gh api repos/Lazurio/t3code/rulesets/21717536 --jq '.bypass_actors'
   # očekáváno: [{"actor_id":null,"actor_type":"OrganizationAdmin","bypass_mode":"always"}]
   # (Maintainer vidí null kvůli svým právům; readback dělá Admin.)
   ```

   Potom Admin, nebo jeho Task Agent na explicitní pokyn vázaný na oba SHA,
   vymění `main`:

   ```bash
   git push --force-with-lease="refs/heads/main:$expected_old_main" \
     origin "$candidate_head:refs/heads/main"
   ```

   Neúspěšný lease znamená souběžnou změnu. Nikdy ho automaticky neopakuj.

6. Vydej `X.Y.Z-lazurio.1` z nového `main` postupem níže.

## Testování před vydáním

1. **CI.** `Lazurio Fork CI` na PR i na `main` musí být zelené. Běží v něm:
   - server a web testy, typecheck a kontraktní test;
   - build OCI image;
   - `CLI archives`: build a `smoke-cli-archive` obou archivů na nativních
     runnerech;
   - `Launcher install linux-x64`: archiv se servíruje přes HTTP v upstream
     layoutu a `t3 update` ho stáhne přes `T3CODE_RELEASE_BASE_URL`, ověří
     `SHA256SUMS`, rozbalí a zkontroluje přesnou verzi. Nainstalovaný runtime
     pak odpoví na `__service-preflight` stavem `ready` se stejnou verzí.
     Tyto dvě brány projde i skutečný Update. Restart samotné služby CI
     neověřuje, protože runner nemá uživatelský service manager.
2. **Lokální smoke** (volitelné; hodí se při ladění buildu). Spusť v čistém
   worktree na Linux x64 nebo Mac arm64 s `vp` a Rustem:

   ```bash
   VERSION=0.0.44-lazurio.0 KEY=linux-x64 RUST_TARGET=x86_64-unknown-linux-gnu  # Mac: darwin-arm64, aarch64-apple-darwin
   vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/scripts...
   node scripts/update-release-package-versions.ts "$VERSION"
   vp run --filter t3 build
   cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target "$RUST_TARGET"
   VP_NODE_VERSION=26.8.2 node apps/server/scripts/cli.ts build-exe --verbose
   mkdir -p "$HOME/.cache/t3-rm/$KEY" && cp "native/resource-monitor/target/$RUST_TARGET/release/t3-resource-monitor" "$HOME/.cache/t3-rm/$KEY/"
   node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$VERSION" \
     --resource-monitor-dir "$HOME/.cache/t3-rm" --output-dir release-cli   # Mac: --platform mac --arch arm64
   node scripts/smoke-cli-archive.ts --archive "release-cli/t3-$VERSION-$KEY.tar.gz" --expect-version "$VERSION"
   git checkout -- apps/server/package.json apps/web/package.json apps/desktop/package.json packages/contracts/package.json
   ```

3. **Canary přes preview.** Vydej preview a na canary Mašinách pod launcherem
   (nejdřív testovací VM klientské Organizace, potom osobní VM a další Mašiny) ho nainstaluj přes
   SSH s TTY. Lokální `t3 update` nejde přes launcherův trial ani zálohu
   databáze (ty má jen tlačítko Update, #22), proto nejdřív zálohuj databázi:

   ```bash
   # Konzistentní kopie za běhu (SQLite backup API)
   python3 -c 'import sqlite3,os,time; d=os.path.expanduser("~/.t3/backups/pre-"+time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())); os.makedirs(d,0o700); s=sqlite3.connect("file:"+os.path.expanduser("~/.t3/userdata/state.sqlite")+"?mode=ro",uri=True); t=sqlite3.connect(d+"/state.sqlite"); s.backup(t); print(d)'
   # Proměnná je jen v drop-inu služby; SSH shell ji nemá a bez ní by
   # `t3 update` hledal vydání v pingdotgg/t3code.
   export T3CODE_RELEASE_REPOSITORY=Lazurio/t3code
   ~/.local/bin/t3 update 0.0.44-preview.20260930.1   # potvrď preview; restart: viz níže
   ~/.local/bin/t3 --version
   ```

   **Když nová verze mění protokol launcheru** (`SERVICE_LAUNCHER_PROTOCOL`
   v `apps/server/src/cloud/serviceProtocol.ts`, např. 2 → 3 mezi v0.0.42
   a v0.0.44), odpověz na dotaz na restart **ne** a službu přepni novým CLI:
   `~/.local/bin/t3 service install`. Starý CLI by při restartu zapsal stav
   služby ve starém protokolu a nový launcher by ho odmítl („Service state is
   invalid or unsupported.“). Oprava takto shozené služby:
   `~/.local/bin/t3 service install` a `systemctl --user reset-failed
t3code.service && systemctl --user start t3code.service` (#25).

   Ověř přesnou verzi, `~/.t3/runtime/service-state.json` (protokol
   a `activeVersion`), přihlášení a pairing přes Launchpad Chat, terminál,
   agentní turn, starý i nový thread, upload a download, reconnect a restart
   služby se zachovanými daty. Ověř také, že Mašina na stable preview nenabízí
   (`/.well-known/t3/environment` → `availableServerUpdate`). První selhání
   zastaví rozšiřování.

4. **Stable a tlačítko Update.** Stable vydej ze stejného commitu až po
   zeleném canary a výslovném souhlasu Admina. Canary Mašiny vrať z preview
   (se stejnou proměnnou): `t3 update --channel stable --allow-downgrade`
   (bez `--allow-downgrade` je to odmítnuté, SemVer řadí `-lazurio.N` pod
   `-preview.…`). Mašiny na předchozím stable ukážou banner Update po příští
   kontrole kanálu (při startu a každých 6 hodin). Tlačítko projde trialem
   launcheru a zálohou databáze, **jen když má Mašina launcher se stejným
   protokolem, jaký nová verze vyžaduje**. Jinak preflight update bezpečně
   odmítne („This release requires a newer T3 Code service launcher“) a
   Mašinu je potřeba jednou převést lokálně (postup výše) nebo zvýšením pinu
   v Machines, které instalují přes `t3 service install`.

## Spuštění vydání

Vydání se spouští jen z `main` a jen z commitu, který je právě na jeho špičce:

```bash
VERSION=0.0.44-preview.20260930.1   # nebo stable 0.0.44-lazurio.1
SOURCE_SHA="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
UPSTREAM_TAG=v0.0.44
UPSTREAM_SHA="$(git ls-remote https://github.com/pingdotgg/t3code.git "refs/tags/$UPSTREAM_TAG" | cut -f1)"
# Upstream tagy jsou lightweight, SHA tagu je přímo commit (workflow to ověří).

gh workflow run lazurio-release.yml --repo Lazurio/t3code --ref main \
  -f version="$VERSION" \
  -f source_sha="$SOURCE_SHA" \
  -f upstream_tag="$UPSTREAM_TAG" \
  -f upstream_sha="$UPSTREAM_SHA"
gh run list --repo Lazurio/t3code --workflow lazurio-release.yml --limit 1
```

Workflow `Lazurio T3 Code Release` postupně:

1. **Verify source and version** ověří formát vstupů a to, že `source_sha` je
   špička `main`, stojí na přesném upstream tagu a nemá merge commity. Dál
   ověří, že tag ani vydání ještě neexistují a že verze je nejvyšší ve svém
   kanálu.
2. **CLI archives** postaví a otestuje oba archivy stejně jako CI.
3. **Publish release and image** čeká na schválení v environmentu
   `lazurio-t3code-release`. Po schválení:
   - před jakýmkoli zápisem znovu ověří, že `source_sha` je pořád špička
     `main`. Když se `main` mezitím posunul, skončí a nic nepublikuje; spusť
     vydání znovu s novou špičkou;
   - napíše `SHA256SUMS` a attestuje každý archiv zvlášť;
   - postaví, pushne a attestuje `ghcr.io/lazurio/t3code:<verze>`;
   - vytvoří tag `v<verze>` na `source_sha` tokenem release App (API odmítne
     existující tag);
   - publikuje GitHub Release: stable jako `latest`, preview jako pre-release,
     které `latest` nikdy není (workflow to po publikaci ověří).

   Existující tag, vydání ani image nikdy nepřepíše.

Tagy `v*-lazurio.*` a `v*-preview.*` chrání ruleset 24037218 „Protect
Lazurio channel tags“. Readback (Admin):
`gh api repos/Lazurio/t3code/rulesets/24037218 --jq '.conditions.ref_name.include'`
vrátí oba vzory.
Obejít ho smí jen GitHub App „Lazurio T3 Code Release“ (contents write,
metadata read), nainstalovaná jen na `Lazurio/t3code`. Její ID je proměnná
`LAZURIO_RELEASE_APP_ID` a privátní klíč secret
`LAZURIO_RELEASE_APP_PRIVATE_KEY`, obojí v environmentu
`lazurio-t3code-release`. Token si proto umí vyrobit až schválený publish job,
a to jen pro tento repozitář. Ruční tag vytvořit nejde, ani Stewardovi, ani
Adminovi, ani jinému workflow. Tak je to navržené. Když proměnná nebo secret
chybí, publish skončí dřív, než cokoli zapíše.

Platí invariant: **bypass typu `Integration` v rulesetu 24037218 má jen tahle
App a App je nainstalovaná jen na `t3code`.** Admin ho ověří při aplikaci
nastavení a po každé změně rulesetu nebo instalace (endpointy vidí jen Admin):

```bash
gh api repos/Lazurio/t3code/rulesets/24037218 --jq '.bypass_actors'
# očekáváno: [{"actor_id":<LAZURIO_RELEASE_APP_ID>,"actor_type":"Integration","bypass_mode":"always"}]
gh api orgs/Lazurio/installations \
  --jq '.installations[] | select(.app_id == <LAZURIO_RELEASE_APP_ID>) | {repository_selection, permissions}'
# očekáváno: repository_selection "selected", permissions {"contents":"write","metadata":"read"}
```

Seznam repozitářů instalace přes API neukáže token uživatele, jen token samotné
App. Admin ho proto čte v Organization settings → GitHub Apps → Lazurio T3
Code Release → Configure → Repository access: „Only select repositories“ a
jediný repozitář `t3code`. App na další repozitáře nepřidávej a do bypassu
rulesetu nepřidávej jiného aktéra.

## Schválení

Když jsou první dva kroky zelené, požádej Matěje o schválení a pošli mu odkaz na
běh. Matěj ho schválí v GitHubu (běh → Review deployments →
`lazurio-t3code-release` → Approve). Jediný povinný schvalovatel environmentu je
Matěj, takže bez jeho schválení vydání nevyjde. Environment má
`prevent_self_review`: vydání proto spouštíš ty, ne Matěj, protože vlastní běh by
schválit nemohl. Pokud se vydání rozmyslíš, Matěj ho odmítne (Reject) a nic se
nepublikuje.

## Ověření publikovaného vydání

```bash
VERSION=0.0.44-preview.20260930.1
mkdir -p "/tmp/t3-$VERSION" && cd "/tmp/t3-$VERSION"
gh release download "v$VERSION" --repo Lazurio/t3code
sha256sum --check SHA256SUMS            # macOS: shasum -a 256 --check SHA256SUMS
gh attestation verify "t3-$VERSION-linux-x64.tar.gz" --repo Lazurio/t3code
gh attestation verify "t3-$VERSION-darwin-arm64.tar.gz" --repo Lazurio/t3code
gh attestation verify "oci://ghcr.io/lazurio/t3code:$VERSION" --repo Lazurio/t3code
gh release view "v$VERSION" --repo Lazurio/t3code --json tagName,isPrerelease
gh api repos/Lazurio/t3code/releases/latest --jq .tag_name   # preview tu nikdy není
```

Pak proveď Update na canary Mašině (viz Testování).

## Desktop a mobil proti serveru z forku

Oficiální desktop a mobilní aplikace jsou vanilla upstream a o našem kanálu
nevědí:

- **Desktop** porovnává s verzí serveru jen `X.Y.Z`. Desktop `0.0.44` proti
  serveru `0.0.44-lazurio.1` (nebo preview `0.0.44-preview.…`) nic nenabízí.
  Proti serveru se starším `X.Y.Z` (`0.0.42-lazurio.1`) nabídne „Update to
  0.0.44“; server pak hledá `v0.0.44` v `Lazurio/t3code`, kde není, a skončí
  hláškou, že verze v kanálu není publikovaná. Server se nezmění. Totéž nastane,
  když se desktop sám aktualizuje na novější upstream dřív, než vydáme refresh.
- **Mobil** („Check for updates“) čte index `pingdotgg/t3code` a nabídne
  nejnovější upstream verzi kanálu serveru. Server ji v našem kanálu nenajde
  a skončí stejnou hláškou.

Matějův test 2026-09-30 (DEV-6633): desktop 0.0.44 proti serveru `0.0.44-preview.…`
nic nenabídl. Podrobnosti a stav v #26.

Pořadí pro operátory proto je: nejdřív Update ve webové T3 v Environmentu
(tlačítko nabízí jen vydání našeho kanálu), potom aktualizace desktopu.
Nabídku z desktopu nebo mobilu na vanilla verzi ignoruj.

## Rollback

Tlačítkem se na nižší verzi vrátit nedá. Rollback je vždy nové, vyšší vydání:
oprav chybu (nebo revertni commit) na `main` a vydej další `-lazurio.N`,
během canary další preview.

Nouzové cesty, když Mašina nenaběhne a na opravu se nedá čekat:

- na Mašině `t3 update <předchozí verze> --allow-downgrade`. Pokud mezitím
  proběhly nové migrace databáze (starší server nemá down migrace) nebo se
  mění protokol launcheru, nesmí starší server naběhnout dřív, než je
  databáze obnovená a stav služby zapsaný jeho CLI:

  ```bash
  export T3CODE_RELEASE_REPOSITORY=Lazurio/t3code
  ~/.local/bin/t3 update <předchozí verze> --allow-downgrade   # restart: ne
  systemctl --user stop t3code.service
  cp ~/.t3/backups/<záloha>/state.sqlite ~/.t3/userdata/state.sqlite
  rm -f ~/.t3/userdata/state.sqlite-wal ~/.t3/userdata/state.sqlite-shm
  ~/.local/bin/t3 service install   # CLI předchozí verze zapíše svůj protokol a službu spustí
  ```

  Data vzniklá po záloze se tím ztratí. Tahle cesta zatím nebyla živě vyzkoušená;

- canary Mašinu z preview vrátit `t3 update --channel stable --allow-downgrade`.

Pin T3 v Machines je minimum: Mašinu s vyšší verzí nevrátí.

## Co nedělat

- Publikované vydání, jeho assety ani tag nikdy nemaž a nepřepisuj. Chybné
  vydání nahradí vyšší verze.
- Nepublikuj vydání ručně (`gh release create`). Tag `v*-lazurio.*` ani
  `v*-preview.*` ručně vytvořit nejde; kanál plní jen workflow.
- Nepoužívej release App mimo workflow a její privátní klíč nikam nekopíruj.
- Nespoléhej na příznak pre-release: servery ho neskryjí. Canary drží jen
  preview tvar verze.
- Nepushuj na `main` s force mimo postup „Přestavba na nový upstream tag“.
- Nespouštěj upstream workflow (`release.yml` a další) a nezapínej je.

## Hranice automatizace

Upstream workflow soubory zůstávají ve stromu, aby refresh zůstal bez diffu, ale
v nastavení Actions tohoto repozitáře jsou **vypnuté**. Potřebují Blacksmith
runnery a upstream secrets, takže odsud publikovat nemohou. Zapnuté by jen
visely ve frontě nebo padaly a `release.yml` by reagoval na tagy `v*`. Když
refresh přinese nový upstream workflow, vypni ho také:

```bash
gh workflow list --repo Lazurio/t3code --all --json id,path,state \
  | jq -r '.[] | select(.path | test("lazurio-") | not) | select(.state == "active") | .id' \
  | xargs -n1 gh workflow disable --repo Lazurio/t3code
```

Aktivní zůstávají jen `lazurio-fork-ci.yml` (read-only, povinný check
`Server and web compatibility`), `lazurio-cli-archives.yml` (volaný z obou
ostatních) a ručně spouštěný `lazurio-release.yml`.

## Historie

Do září 2026 vycházely jen OCI image pod tagy `lazurio-vX.Y.Z-rN`, bez CLI
archivů. Tyto tagy a vydání zůstávají jako neměnný archiv. Launcher je
ignoruje, protože tagy nezačínají na `v`. Nové verze je nepoužívají.
