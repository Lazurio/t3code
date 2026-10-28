# Lazurio T3 Code: vydávání

Runbook pro vlastníka vydávání T3 Code v Lazuriu (Steward). Vydání připravíte,
otestujete a spustíte sami; Organization Admin ho jen schválí v GitHub
environmentu.

`Lazurio/t3code` je distribuce **Lazurio T3 Code** (rozhodnutí 0200), upravená
distribuce T3 Code pro Environmenty Lazuria: server a web klient přesného
upstream stable vydání a nad nimi overlay Lazuria. Overlay chování T3 Code mění:
hostované nastavení, aktualizace z kanálu Lazuria, zadání z Launchpadu, slot pro
shell Lazuria, prohlížeč Environmentu, spravovaná složka Lazuria, jméno
v aplikaci, vzhled na Environmentu, přihlášení poskytovatelů přes Lazurio
a párování prohlížeče, které obstará Environment sám. Co přesně a ve kterých
souborech, říká [Overlay](#overlay); podrobnou specifikaci prohlížeče
Environmentu a párování drží [specifikace overlaye](./lazurio-overlay.md). T3 vždy běží
v kořeni vlastního hostname (`https://t3code.<vm>.<org>.lazurio.io/`) za TLS
reverse proxy. Oficiální desktop a mobilní aplikace se připojují jako
neupravení upstream klienti. Značka T3 Code zůstává. Do UI webového klienta
zasahuje slot pro shell Lazuria (viz [Lazurio shell](#lazurio-shell)),
prohlížeč Environmentu v pravém panelu, spravovaná složka Lazuria,
jméno „T3 Code (Lazurio)“ a na Environmentu světlý vzhled design systému
Lazuria (viz [Jméno a vzhled](#jméno-a-vzhled)).

## Licence

T3 Code je pod licencí MIT (`LICENSE`, copyright T3 Tools Inc.) a fork ji
zachovává. Licence má jít s každou kopií: image ji nese v
`/opt/lazurio-t3/LICENSE` a každý CLI archiv vedle binárky `t3`. CI obojí
porovná se souborem v repozitáři.

Funkce, které overlay zkopíroval z LazurioPlatform `src/browser/people/holds.ts`
ve stavu 49d54c9 do `apps/server/src/lazurio/holders.ts` (vyjmenovává je
hlavička toho souboru), jsou podle grantu Organization Admina z 2026-10-12 pod
licencí MIT (LazurioPlatform, rozhodnutí F50 bod 6). Ostatní soubory Platformy
zůstávají pod Elastic-2.0. Záznam platí, dokud kopie nenahradí soubory kontraktu
prohlížeče, které fork převezme z artefaktu Platformy (F50 bod 5).

Značkové soubory Lazuria pod licencí MIT nejsou (rozhodnutí Organization Admina
z 2026-10-22, plán DEV-6676): symbol Lazuria v `apps/web/src/lazurio/brand/`
a Mattyčus v `apps/web/public/assets/avatar.webp`. Podmínky jejich použití drží
`apps/web/src/lazurio/brand/README.md`; odkazují na ně `.github/README.md`
a licenční řádky na konci poznámek každého vydání. `LICENSE` upstreamu se
nemění.

## Kanál aktualizací

GitHub Releases tohoto repozitáře jsou kanál, ze kterého se T3 Code na všech
Lazurio Mašinách instaluje a aktualizuje. Každé vydání obsahuje:

| Asset                            | K čemu                                                  |
| -------------------------------- | ------------------------------------------------------- |
| `t3-<verze>-linux-x64.tar.gz`    | headless Linux Mašiny                                   |
| `t3-<verze>-darwin-arm64.tar.gz` | Mac Mašiny (přes web verzi T3 Code)                     |
| `SHA256SUMS`                     | `sha256sum` přes finální bajty archivů, upstream formát |
| `release-evidence.json`          | zdrojový commit, upstream báze, checksumy, OCI digest   |

Archivy mají upstream layout (`t3`, `client/`, `resource-monitor/`,
`node_modules/`), protože je staví upstream skripty; workflow k nim vedle
binárky přidá `LICENSE` T3 Code. Webový klient v archivech i v image nese
produkční ikony upstreamu (`assets/prod`), ne vývojové, které aplikuje build
serveru. Launcher boot service archivy stahuje z `<base>/v<verze>/SHA256SUMS` a
`<base>/v<verze>/t3-<verze>-<platforma>.tar.gz`. Od `0.1.0-lazurio.4` je náš
kanál výchozím repozitářem vydání distribuce (Lazurio/t3code#22): bez proměnné
`T3CODE_RELEASE_REPOSITORY` server čte index vydání, ukazuje banner a stahuje
z `https://github.com/Lazurio/t3code/releases/download`, a stejně tak
`t3 update`, `t3 service install` i instalační skripty. Proměnná výchozí
repozitář přepíše. Machines ji v drop-inu služby dál nastavují na
`Lazurio/t3code`, protože `t3` i server ve verzi `0.1.0-lazurio.3` a starší
bez ní hledají vydání v `pingdotgg/t3code`, a Update tlačítkem stahuje ještě
stará verze serveru. `T3CODE_RELEASE_BASE_URL` je jen pro zrcadlo a Machines ho
nenastavují.

Publikace nikoho automaticky nepřepne. Mašina přejde na novou verzi, až
uživatel klikne na Update, nebo až někdo spustí `t3 update`. Stránka, která byla
při Update tlačítkem otevřená, se sama znovu nenačte a do dalšího načtení v ní
běží starý klient (upstream chování, Lazurio/t3code#32). Po Update ji proto
načtěte znovu a řekněte to i lidem v oznámení vydání.

Kanál vydání se odvozuje z verze stejně jako upstream (`cliReleaseChannelOf`):

| Kanál     | Verze                      | Kdo ji dostane                                                                                                                                                      |
| --------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stable`  | `X.Y.Z-lazurio.N`          | Všechny Mašiny pod launcherem: server ji ohlásí jako `availableServerUpdate` a webová T3 ukáže tlačítko Update.                                                     |
| `preview` | `X.Y.Z-preview.YYYYMMDD.N` | Jen Mašina, kde ji někdo výslovně nainstaluje `t3 update <verze>` s potvrzením v terminálu. Preview se nikdy nenabízí a server na preview aktualizace nekontroluje. |

Preview je canary: nejdřív ho nainstalujete na vybrané Mašiny, a až obstojí,
vydáte stable ze stejného commitu. Nightly nevydáváme. Příznak GitHub
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
`0.1.1-lazurio.1` jde vydat i po `0.1.1-preview.20261021.1`.

SemVer řadí `X.Y.Z-lazurio.N` pod `X.Y.Z-preview.…` (`lazurio` < `preview`)
a obojí pod samotné upstream `X.Y.Z`. Z preview na stable proto vede jen výslovný
návrat `t3 update --channel stable --allow-downgrade`; tlačítko ho nenabídne.

Ze stejného důvodu je `0.1.1-lazurio.1` nižší než upstream `0.1.1`. Mašinu,
která běží na upstream buildu se stejným `X.Y.Z`, tlačítko na náš kanál
nepřevede. Poprvé ji převeďte pinem v Machines nebo
`t3 update 0.1.1-lazurio.<N> --allow-downgrade`; další vydání už tlačítko
nabídne normálně.

## Overlay

`main` je přesný upstream stable tag a nad ním jen commity overlaye. Tabulka je
cílový stack: jeden commit na řádek, jak ho přehraje příští přestavba (viz
[Přestavba candidate](#3-přestavba-candidate)). Dnešní commit každého řádku a
jeho soubory uvádí [Cílový stack](#cílový-stack). Sloupec „Upstream a
přestavba“ říká, co v souborech řádku změnila upstream v0.1.3 a co z řádku
zůstává. Rozhodnutí se zdůvodněním a schválením drží issue přestavby
Lazurio/t3code#136 (přestavby na v0.1.2 Lazurio/t3code#112, na v0.1.1
Lazurio/t3code#97, na v0.1.0 Lazurio/t3code#70).

| #   | Commit                                                                                          | Proč ho Lazurio potřebuje                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Upstream a přestavba                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `hosted: configurable client session TTL`                                                       | `T3CODE_CLIENT_SESSION_TTL` (Machines nastavuje `365d`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Upstream má dál pevných 30 dní (`DEFAULT_SESSION_TTL`) a socket zavře, když sezení vyprší (#17370). Effect 4.0.5 dál řetězí časovače delší než 24,8 dne, takže 365 dní funguje: zůstává. Test řádku stojí vedle přeživšího testu upstreamu v `SessionStore.test.ts`. Na v0.1.3 přidal upstream vedle vložení overlaye `privateNetworkOnly` (#24588); obojí zůstává a test TTL používá upstreamový `minimalWebFlags`. Lístky WebSocketu mají vlastní krátké TTL (#24554) a s `T3CODE_CLIENT_SESSION_TTL` se nepotkávají.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | `hosted: serve behind an explicit HTTPS external origin`                                        | `T3CODE_EXTERNAL_ORIGIN`: server na loopbacku za proxy je dosažitelný zvenku a používá Secure cookie `__Host-t3_session`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Upstream od v0.1.0 kontroluje Origin u každého požadavku s cookie sám (#18509), proto overlay vlastní kontrolu nemá. Proměnná, Secure `__Host-` cookie a politika loopbacku zůstávají, testy cookie jsou v `apps/server/src/lazurio/hostedSessionCookie.test.ts`. Na v0.1.3 poslouchá launcher bez hostu na `0.0.0.0` (#24588), takže `T3CODE_HOST=127.0.0.1` z Machines je nosné (bind ověřte na canary); `externalOrigin` stojí vedle nového `privateNetworkOnly`. Nabídnout upstreamu (bezpečnou cookie jsme nabídli neveřejně 2026-10-19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | `hosted: explicit environment label`                                                            | `T3CODE_ENVIRONMENT_LABEL` pojmenuje kontejnerový Workspace (například `Acme / Management`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Upstream čte jen `PRETTY_HOSTNAME` a hostname, Machines nastavují proměnnou: zůstává. Háček čte proměnnou přes `HostProcess.Environment` (#17641); test je v `apps/server/src/lazurio/environmentLabel.test.ts`, protože upstream svůj smazal (#22557). Na v0.1.3 je soubor beze změny.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | `feat: in-app update from the configured release channel`                                       | `T3CODE_RELEASE_REPOSITORY` a server-advertised `availableServerUpdate`: Mašina nabízí aktualizaci na nejvyšší vydání z nastaveného repozitáře a instaluje ho tlačítkem Update. Bez proměnné je to od `0.1.0-lazurio.4` `Lazurio/t3code`, i pro `t3 update` v shellu bez proměnné služby (Lazurio/t3code#22). Server pod launcherem po aktivaci přesměruje `~/.local/bin/t3` na svůj runtime, takže CLI běží ve stejné verzi jako server (Lazurio/t3code#30). Navrženo upstreamu.                                                                                                                                                                                                                                                                                                                                                                                                            | Upstream má dál pevné `pingdotgg/t3code` a protokol launcheru 3: zůstává celý. `t3 update` posílá indexu vydání `GH_TOKEN` nebo `GITHUB_TOKEN` (#19507); token čte `cloud/releaseIndex.ts`, takže ho posílá i kontrola serveru. Mazání starých runtime nechá runtime, na který míří `t3`. Výchozí repozitář `Lazurio/t3code` je jen distribuce, upstreamu se nenabízí. Přesměrování `t3` po aktivaci zůstává, upstream ho dělá jen v `t3 update` (Lazurio/t3code#30). Na v0.1.3 upstream zrušil oznámení „Server update available“ u composeru (#25401), proto vydání, které server nabízí, nabízí tlačítko aktualizace v sidebaru: `sidebar/updateEverything.logic.ts` z něj udělá cíl serveru (kontrola „už aktuální“ upstreamu porovnává jen jádro verze a `-lazurio.0` → `-lazurio.1` by přeskočila) a `sidebar/useUpdateEverything.ts` na něj nečeká na npm. Retry v composeru a řádek uloženého Environmentu dál nabízejí `targetVersion` (žádný zdroj webu nečte `.clientVersion`). Instalační skripty berou stable z `releases/latest` (#22907), ostatní kanály stránkují API a vše filtruje pravidlo řady runtime (`install-scripts.test.ts`). Nabídnout upstreamu (diskuse #21562).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | `release: Lazurio distribution`                                                                 | Tento runbook, [specifikace overlaye](./lazurio-overlay.md), skill [`lazurio-upstream-rebuild`](../../.agents/skills/lazurio-upstream-rebuild/SKILL.md), `Dockerfile.lazurio`, `.dockerignore`, kontraktní test a workflow `lazurio-fork-ci.yml`, `lazurio-cli-archives.yml`, `lazurio-release.yml` (včetně preview vydání pro canary, `X.Y.Z-preview.YYYYMMDD.N` jako GitHub pre-release) a `lazurio-upstream-watch.yml`, formulář issue, `.github/README.md` a bezpečnostní politika `.github/SECURITY.md`. Jméno distribuce nesou vydání, image, formulář a README (rozhodnutí 0200).                                                                                                                                                                                                                                                                                                     | Zůstává; v přestavbě jde poslední. Báze je `v0.1.3`/`d2c44031` a archivy CI `0.1.3-lazurio.0`. Node `26.12.1` a pnpm `12.14.0` se nezměnily (CI, vydání i obraz je berou přesně, což hlídá kontraktní test), Vite+ je 1.4.0 a CI ho nepinuje. Na v0.1.3 přibyla workflow `relay-preview.yml`, `relay-preview-cleanup.yml` a `stale-needs-more-info.yml`; po výměně `main` je vypněte ([Výměna `main`](#6-výměna-main)), změněná workflow upstreamu zůstávají vypnutá. Allowlist získal pět souborů (tlačítko aktualizace v sidebaru, obrazovku „failed to start“ s testem bundled dev a zkratky chatu, které upstream instaluje při startu aplikace) a o žádný nepřišel; pevná brána se nemění. Nová pravidla lintu (`no-low-value-comments`: komentář nejvýš na 4 řádky a bez holých `#NNN`; diagnostiky Effect jako chyby; `react-effect-budget` i pro `apps/web/src/lazurio`) upravila kód overlaye v commitech řádků a komentáře kontraktního testu tady; efekty overlaye mají zdůvodněné výjimky.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | `lazurio: unsent prompt draft by link from the shell`                                           | „+ Nový modul“ otevře Chat se zadáním v poli zprávy nového vlákna, neodeslaným ([Zadání z Launchpadu](#zadání-z-launchpadu)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Odkazy upstreamu `/new?prompt=` (#18454) nesou text v adrese a projekt vybírají podle `repo`; odkaz overlaye text nenese (D13) a zůstává vedle nich. Párování po přihlášení stránku znovu načte (#9785), proto odkaz přečká reload v `sessionStorage` (jen id a Organizace). Na v0.1.3 historii a router vytváří `startAppServices()` v `appInit.tsx`, proto `captureLazurioPromptLink()` stojí v `main.tsx` těsně před ním; `<LazurioPromptDraft />` je první potomek přepsaného `ChatRouteLayout`, takže zůstane i pod modálním Nastavením.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | `feat(web): Lazurio shell slot`                                                                 | Slot pro shell Lazuria ve webovém klientovi: načtení `/.lazurio/shell.js`, rail vedle aplikace, hlavička sloupce pod horním řádkem sidebaru a Buddy, jehož spouštěči nechá composer Chatu jeho roh (viz [Lazurio shell](#lazurio-shell)). Mimo Lazurio se nic nevykreslí.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Upstream ekvivalent nemá: zůstává. Od 2026-10-17 je hlavička sloupce pod horním řádkem T3 (schválený design levého sloupce), takže `AppSidebarLayout.tsx` a přepínač sidebaru jsou upstreamu; sbalený sidebar je `inert` (#18849) a hlavička sloupce s ním. Na v0.1.3 je Nastavení modální okno nad vláknem (#24847) bez vlastního sidebaru, takže hlavičku kreslí sidebar vláken a starý sidebar; `index.html` a `SidebarChrome.tsx` přešly beze změny. Rail pod modálním oknem ověřte na canary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | `feat(server): each thread's provider processes get its agent-browser session`                  | Procesy agentů, které T3 spouští pro jedno vlákno, dostanou `AGENT_BROWSER_SESSION=t3-<id vlákna>`, takže agenti vlákna pracují ve vlastním okně prohlížeče Environmentu. Codex, jehož app-server slouží všem vláknům instance, ji dostane v konfiguraci vlákna pro příkazy, které jeho agent spouští. Terminály vlákna ji mají v prostředí svého shellu, takže stránka otevřená z terminálu přibude do panelu vlákna (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)).                                                                                                                                                                                                                                                                                                                                                                                                               | Rozhodnutí 0191; upstream ekvivalent nemá. Procesy agentů upstream spouští přes `AgentScope` (#17662): šev je dekorátor `AgentScope` v `server.ts` (Claude Code jako nativní binárka, Pi, Muse, agenti ACP) a jeden řádek v `CodexAdapterV2.ts` (`shell_environment_policy.set`), pro terminály jeden v `terminal/Manager.ts` (Lazurio/t3code#73; běžící terminál až po restartu). App-server Codexu upstream označuje jako sdílený (`shared`, #18329): dekorátor sdílené procesy přeskakuje podle příznaku a spuštění vrací jako `{ ...launch, … }`, takže projde i pole, které upstream přidá. Claude startuje přes obal `/bin/sh` se strážcem skupiny (#23389) a prefix `/usr/bin/env AGENT_BROWSER_SESSION=…` je příkaz, který strážce spouští. Na v0.1.3 má `AgentScope` metodu `stop` a spuštění nese `unit` (#21299): dekorátor `stop` s jednotkou předá dál a test to hlídá; že okno a karty prohlížeče přežijí konec agenta, ověřte na canary. Nepokryto: OpenCode, Cursor, Grok na Linuxu, Claude Code spuštěný jako skript a Windows. Nabídnout upstreamu obecnou proměnnou vlákna.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 9   | `feat(web): the right panel shows the thread's Environment browser tabs`                        | Na Environmentu Lazuria je prohlížeč Environmentu jediným prohlížečem webového klienta. Pravý panel ukazuje záložky prohlížeče Environmentu, které vlákno drží, podle seznamu serveru, na každém zařízení stejné. Nad pohledem není hlavička, jedinou lištou je lišta pohledu; menu záložky přidá Open in new tab a Reload. × záložku pro vlákno pustí s možností Vrátit a panel se sám otevře, když agent záložku ukáže (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)).                                                                                                                                                                                                                                                                                                                                                                                                            | Rozhodnutí 0191, F47. Upstream má pravý panel v14, Mod+Shift+T (#15207) a serverový prohlížeč (#15328), který web ukazuje jen podle `capabilities.serverBrowser`. `openProactive` záložku, kterou pás už má, bez `activateExisting` neaktivuje (#13608), a obě odhalení overlaye ho proto předávají; záložka pásu je kompilovaná `RightPanelTab` (#20853) s tooltipem jako komponentou overlaye a titulky rámů jdou do `surfaceTitle` jako vstup háčku (pod React Compilerem titulek čtený z úložiště zamrzl na „Browser“). ChatView předává obsah panelu jednou jako children komponentě `ChatRightPanel` (#22700). Na v0.1.3 zůstává ChatView pod modálním Nastavením a Využitím namountovaný (#24847), takže záložky prohlížeče Environmentu otevření Nastavení přežijí; střetly se jen importy. Mod+Shift+T povrchy prohlížeče Environmentu přeskočí, cestou zpět zůstává Vrátit. Prohlížeč upstreamu skrývá server (řádek 10), web další šev nepotřebuje.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 10  | `feat(server): T3's browser tools drive the Environment browser`                                | Nástroje prohlížeče T3 (`preview_open`, `preview_snapshot`, …) ovládají prohlížeč Environmentu i ve webovém T3. Záložku, kterou otevřou nebo převezmou, přidají do záložek vlákna a pohled jiného Environmentu pošlou webu jako živou událost; `preview_open` vrátí i adresu pohledu záložky (`view`) pro člověka bez panelu (Lazurio/t3code#88). S `T3CODE_LAZURIO_FOLDER` server serverový prohlížeč upstreamu nestaví ani neinzeruje, takže prohlížeč Environmentu je jediný.                                                                                                                                                                                                                                                                                                                                                                                                             | Rozhodnutí 0191. Upstream má od v0.1.0 vlastní serverový prohlížeč (#15328) s preferovaným hostitelem, 660 s pro `open`, `reason`, ARIA stromem, `playwright-core` a enginem `ServerBrowserPage.ts`; desktop se k brokeru nepřipojuje. Hostitel overlaye se registruje pod id serverového prohlížeče, `open` omezí na 60 s, stránky ovládá engine upstreamu a o velikost snímku žádá `renderScale: "display"` (#19913); diagnostika vynechává obsah adres `data:` (#22156) a engine ve snímku maskuje hodnoty hesel (#20446). Na v0.1.3 upstream sloučil osm nástrojů prohlížeče do `preview_act` (#25423) a přidal `PreviewAgentActivity` (#25184): brána v `server.ts` staví serverový prohlížeč upstreamu s `Layer.merge(DesktopBrowserChannel.layer, PreviewAgentActivity.layer)`, takže mimo Environment Lazuria sdílí `ServerBrowser` a `RunExecutionService` jednu instanci aktivity (hlídá `serverBrowser.test.ts`). CDP testy overlaye (běží jen s `LAZURIO_TEST_DEVTOOLS_ENDPOINT`) jednou pusťte na canary Environmentu. Vykreslení HTML zůstává upstreamu. Řeší Lazurio/t3code#43.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 11  | `feat(server): a thread's Environment browser tabs live in its holder file`                     | Záložky vlákna žijí v jeho souboru držitele, který čte hub pohledu. Server je srovnává s hubovým seznamem živých záložek na hodinách bootu, podává je webu cestou `/api/lazurio/thread-tabs` se SSE a přidává do nich záložky z `preview_open` a z nové vazby sezení agent-browser vlákna.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | F47. Šev je řádek v `server.ts` (`layerMakeRoutes`, před `PreviewAutomationBroker.layer`). Podržení a puštění chtějí `preview:operate` (#9789), takže prohlížeč spárovaný na 0.0.45 je do nového spárování nesmí. Na v0.1.3 je šev beze změny; metody `ThreadTabs` jsou `Effect.fn` a komentáře zkrácené na nové pravidlo lintu (fráze, kterou pinuje kontraktní test, zůstala).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 12  | `feat(server): archiving or deleting a thread lets go of its tabs and stops its agent's daemon` | Archivace i smazání vlákna smaže jeho soubor držitele a zastaví démona agent-browser vlákna; při startu totéž pro vlákna, která už nežijí.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Rozhodnutí Admina 2026-10-11, F47. Adaptér `threadLifecycle.ts` čte `OrchestratorV2`, jehož API ani události vláken se nezměnily. Upstream při smazání zavírá jen svá sezení náhledu, při archivaci nic a démona agenta nezastaví: `AgentScope.stop` z #21299 zastaví agenta, ne archivované nebo smazané vlákno (Lazurio/t3code#86). Úklid při startu spoléhá na nestránkovaný `getShellSnapshot({ location: "active" })`, který v0.1.3 dál má; vlákna importovaná z V1 si nechávají id, takže soubory držitelů platí dál.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 13  | `feat(web): "+" and the empty panel open Nová karta`                                            | Kde shell Environmentu definuje `<lazurio-new-tab>`, otevře „+“ i Mod+T záložku Nová karta a prázdný panel ukáže Novou kartu s upstream akcemi „+“ jako nástroji.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | F47 bod 10. Upstream ukazuje „+“ při každém otevřeném panelu a Mod+T otevírá nabídku „+“ (#15686); kopie blokování písmen v Nové kartě převzala opravu upstreamu, která bere jen otevřený nebo zavírající se popup (#18132). Bod rozšíření „+“ upstream pořád nemá, proto dvě podmínky a jeden řádek pro Mod+T. Composer při psaní nechá spouštěči písmena, která ohlásí v `data-surface-launcher-keys` (#22898), a Nová karta je ohlašuje stejně (hlídá test v prohlížeči i kontraktní test). Na v0.1.3 se řádek přenesl čistě; nové Nastavení je dialog, takže písmena Nové karty pod ním nereagují. Mod+T a „+“ hlídají testy Nové karty ve složce overlaye. Odpadne, až bod rozšíření upstream nabídne (nabídnout upstreamu).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 15  | `feat(lazurio): provide a managed Folder project and native model reconciliation`               | S `T3CODE_LAZURIO_FOLDER` začíná Chat ve složce Lazuria daného Environmentu a `t3 lazurio` zapisuje doporučený model Platformy jako model projektu Lazurio (viz [Spravovaná složka Lazuria](#spravovaná-složka-lazuria)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | F51; upstream ekvivalent nemá. Stráže jsou dekorátory služeb tam, kde je skládá `orchestration-v2/runtimeLayer.ts`, převzetí složky jde přes `ProjectService.bootstrap` a Scratch skrývá server (i pro desktop a mobil). Doporučený model je přepis projektu Lazurio (rozhodnutí Admina 2026-10-17) a poslední zápis drží overlay ve vlastním souboru. Odkazy `/new?prompt=` na spravovaném Environmentu většinou nefungují, proto je web nenabízí (Lazurio/t3code#77); sidebar Environmenty k dispozici nemá (#20396), proto jeho „Add project“ čte týž atom jako „Copy prompt link“. Řádky odeslaných zpráv i zpráv automatizace jsou v `chat/TimelineUserMessageRow.tsx` (stráž je v obou) a test háčku VCS je v `lazurio/managedFolderVcs.test.ts`. Na v0.1.3 se střetly jen dva přidané bloky testů v `useHandleNewThread.test.ts` (zůstávají oba); dekorátory stráží jsou `Effect.fn` se jménem spanu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 16  | `feat(web): the in-app name T3 Code (Lazurio)`                                                  | Rozhodnutí 0200 bod 2: v aplikaci se T3 Code jmenuje „T3 Code (Lazurio)“, vedle wordmarku stojí štítek „Lazurio“ a náhledová vydání se nejmenují „Nightly“ (viz [Jméno a vzhled](#jméno-a-vzhled)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Upstream ekvivalent nemá, štítek fáze je konstanta buildu (`Beta`, #20032): zůstává. Manifest upstreamu má vlastní `name` a `short_name` „T3 Code“ (#19175), overlay mění jen hodnotu `name`; testy jména jsou v `apps/web/src/lazurio/branding.test.ts`. Na v0.1.3 přibyla obrazovka „T3 Code failed to start“ (`lib/bootError.ts`): nadpis a nápověda berou jméno z `branding.ts`, odkaz na issues upstreamu a `npx t3 triage` zůstávají (kandidát na samostatné issue) a test bundled dev upstreamu (`bundledDev.test.ts`) proto kopíruje i soubory brandingu. Při přestavbě ověřte, že upstream nezměnil tvar verze náhledů ani místo pilulky vedle wordmarku.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 17  | `feat(web): the design system's light look on a Lazurio Environment`                            | Rozhodnutí 0200 bod 4: ve standardním světlém vzhledu bere webový klient barvy, písmo a zaoblení design systému z tokenů `--lz-*`, které deklaruje shell Environmentu (LazurioPlatform F36). Jeden soubor `apps/web/src/lazurio/theme.css` a import v `main.tsx`; bez shellu se nepoužije nic (viz [Jméno a vzhled](#jméno-a-vzhled)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Motivy Environmentu upstreamu (`t3 theme set`) dají jen barvy, při každém načtení bliknou a resetují volbu člověka: zůstává. Kontraktní test hlídá, že mapované tokeny `index.css` deklaruje ve stejném scope. Na v0.1.3 je výchozí „New design“, mapované tokeny zůstávají a `main.tsx` importuje `theme.css` dál po `index.css`; tmavý režim (dva nemapované tokeny) ověřte na canary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 18  | `feat(lazurio): providers sign in through Lazurio, and the Launchpad turns them on`             | Rozhodnutí 0201 bod 4 (Lazurio/t3code#46): s `T3CODE_LAZURIO_FOLDER` se Codex a Claude přihlašují svými CLI ze stránky Začínáme Launchpadu (`T3CODE_LAZURIO_TOOLS_URL`). Web tam, kde nabízel vlastní „Continue with ChatGPT“, odkáže na Začínáme, server vlastní přihlášení Codexu v T3 odmítne pro každého klienta a `t3 lazurio providers` poskytovatele zapne a hned znovu načte (viz [Přihlášení přes Lazurio](#přihlášení-přes-lazurio)).                                                                                                                                                                                                                                                                                                                                                                                                                                              | Upstream ekvivalent nemá. Stráž je v `orchestration-v2/runtimeLayer.ts`, kde se `ProviderAuthService` skládá; po rozdělení rozsahů (#9786) chce cesta `orchestration:read` + `providers:manage` a per-projektové „vypnuto“ (#17879) nemění. Test `LazurioSignIn` běží v prohlížeči. Na v0.1.3 se v `CodexSetupSection.tsx` střetly jen sousední importy a služba přihlášení upstreamu se nezměnila; přepisy `start` a `importProfile` jsou `Effect.fn`. Při přestavbě ověřte, že upstream nepřidal další vstup do vlastního přihlášení Codexu mimo `ProviderAuthService.start` a `importProfile`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 19  | `feat(lazurio): the Environment pairs its own browser`                                          | Rozhodnutí Admina 2026-10-17 nahrazuje pravidlo z 2026-09-21, že přímá návštěva ukáže párovací stránku T3 a fork zůstává beze změny: Environment páruje svůj prohlížeč sám. Stránka bez platného sezení T3 si řekne vlastnímu originu o údaj (`GET /.lazurio/chat/pairing`), který Launchpad vydá příkazem `t3 lazurio pairing` s rozsahy operátora, a vymění ho, takže člověk token nevidí a hluboký odkaz zůstane. Sezení spárované na 0.0.45 se spáruje znovu (viz [Párování prohlížeče](#párování-prohlížeče)).                                                                                                                                                                                                                                                                                                                                                                          | Upstream ekvivalent nemá: zůstává. Šev jsou dvě volání v `bootstrapServerAuth` (`environments/primary/auth.ts`). Rozsahy operátora jsou standardní klientské bez `relay:write`, stejných 15 v pevném pořadí, a výstup `t3 lazurio pairing` se nemění; `cli.test.ts` je vypisuje doslova. Na v0.1.3 je lístek WebSocketu vázaný na cestu (#24554); rozsahy ani párování se nemění a nikdo se znovu nepáruje, Chat přes bránu ověřte na canary. Při přestavbě ověřte, že upstream nezměnil pořadí zdrojů bootstrap údaje (odkaz, desktop) ani `sessionHasLegacyPermissions`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 20  | `feat(server): t3 auth session issue sets an MCP client's runtime-mode ceiling`                 | Rozhodnutí 0210, dodatek 3: agent bez prohlížeče (Buddy přes SSH, skript) dostane MCP sezení se stropem režimu, jaký jinak dává jen schválení přihlášení MCP. `t3 auth session issue --subject mcp-client --runtime-mode-ceiling <režim>` ho vydá; bez přepínače má takové sezení strop Supervised a vlákno ve full-access mu změnu odmítne (`runtime_mode_escalation_denied`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Upstream ekvivalent nemá. Je to úzká volba konfigurace existující schopnosti (strop schvaluje přihlášení MCP), proto ho lze upstreamu nabídnout bez předchozí diskuse (etapa 9). Šev je nepovinný `runtimeModeCeiling` v `EnvironmentAuth.issueSession`, přepínač v `cli/auth.ts` a řádek výpisu v `cliAuthFormat.ts`; výchozí rozsahy `t3 auth session issue` jsou `AuthStandardClientScopes` a případ formátu je v `cli/auth.test.ts`. Na v0.1.3 upstream zkrátil jen komentář u `MCP_CLIENT_SUBJECT`; export, který řádky 24 a 27 importují, zůstává.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 21  | `feat(lazurio): agents work with T3 Code threads through t3 thread, request, queue and events`  | Rozhodnutí 0210, dodatek 3: Buddy, a s ním každý agent v Environmentu, pracuje s vlákny T3 jako jejich vlastník. Čte a shrnuje je, spouští, posílá zprávy, řídí a zastavuje je, odpovídá na jejich otázky, rozhoduje jejich žádosti o oprávnění a sleduje jejich změny (viz [Agenti a vlákna](#agenti-a-vlákna)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Upstream má vlastní `t3 thread` (`list`, `start`, `send`, `show`; #22732) a `t3` se dvěma skupinami stejného jména nespustí (ani server). `binCli.ts` proto bere skupinu upstreamu přes `lazurioThreadCommand`, která nechá příkazy řádku a přidá ostatní upstreamu (dnes `start` a `show`); na střetu jmen (`list`, `send`) slouží řádek, protože na jeho `send` stojí Delegace a návod. `send` ve výchozím stavu řadí do fronty jako upstream, bere `-` pro standardní vstup vedle `--message-file` a `--wait` přes exportovaný `waitForRun` a `runResultText` upstreamu (kód 2: vlákno čeká na odpověď). Sezení příkazů dál vydává `issueSession` se štítkem `t3 agent cli`, na kterém stojí jmenný prostor Delegace. Celý kód je v `apps/server/src/lazurio/agentCli*.ts`; švy jsou dva řádky v `binCli.ts`, export `runResultText` v `cli/thread.ts` a export `listItemFromShell` v `mcp/OrchestratorMcpService.ts`. Na v0.1.3 upstream sloučil 18 nástrojů MCP do akčních (#25423): `t3 queue` volá `t3_queue`, `t3 request respond` `t3_pending_request` a `t3 thread fork` `t3_thread_transfer`, vždy s `action`; rozhraní `t3` se nemění a `agentCli.test.ts` to ověřuje proti skutečným deklaracím. Snímek shellu chce prázdný `query` (#24648, #24723). Pomalému čtenáři upstream aktualizace seznamu vláken slučuje (#14859), takže `t3 events --follow` dojde vždy k poslednímu stavu každého vlákna. Nabídnout upstreamu. Při přestavbě ověřte, že nástroje MCP, které příkazy volají, mají stejná jména, akce a parametry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 22  | `feat(server): T3's Codex threads ask the user through request_user_input`                      | Rozhodnutí 0211: agent se člověka ptá nástrojem na otázky, ne jen textem ve zprávě. Codex nabízí `request_user_input` v režimu Default jen se zapnutou funkcí `default_mode_request_user_input`; T3 ji zapne app-serveru, který pro svá vlákna spouští, a do kontextu každého tahu dá pokyn ptát se jím, i když bez odpovědi nejde pokračovat (viz [Nástroj na otázky](#nástroj-na-otázky)). Uživatelův `~/.codex/config.toml` se nemění (rozhodnutí 0161).                                                                                                                                                                                                                                                                                                                                                                                                                                  | Upstream ekvivalent nemá a funkci sám nezapíná. Je to politika Lazuria nad funkcí Codexu ve vývoji (ve výchozím stavu vypnutá): pokyn Lazuria zůstává v overlayi a upstreamu se v etapě 9 nabídne jen mechanismus. Šev je přepínač `-c` v `CodexAdapterV2.ts` před argumenty spuštění a položka `lazurio_questions` na konci `buildCodexAdditionalContext`, pod limitem 4 000 bajtů; testy řádku jsou v `lazurio/questionTool.test.ts`. Na v0.1.3 T3 texty režimů neposílá (#24737) a Codex posílá svůj text Default, proto šev věty v textu Default odpadl a `lazurio_questions` výslovně říká, že přebíjí, co režim říká o ptaní; že se Codex ptá nástrojem, ověřte na canary tahem s Codexem. Při přestavbě ověřte v `codex features list`, že Codex funkci pořád zná; jakmile ji zapne ve výchozím stavu sám, přepínač odeberte, pokyn zůstává.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 23  | `feat(lazurio): Buddy's Hermes gets only the person's words and the page as a Czech block`      | Rozhodnutí 0210 (plán DEV-6676): Buddyho chat drží na Osobním Prostředí druhý server T3 s `T3CODE_LAZURIO_BUDDY=1`, jehož instance poskytovatele `buddy` pouští Hermes Agenta (`hermes acp`). Hermes ukládá každý prompt do Buddyho paměti jako slova člověka, proto mu T3 posílá jen text člověka, jeho přílohy a stránku, ze které se ptá, jako jeden označený český blok, nikdy své pokyny (`<t3_code_instructions>`, `<runtime_info>`, `<pull_request_linking>`), ani po Stop, při usměrnění a po restartu. Od dodatku HumanAndMachines/Lazurio#648 jí T3 nenastaví model, úsilí ani jinou volbu než rychlost Hermesu (`fast`): model a úsilí nastavuje Platforma v Hermesově nastavení ([Buddyho T3 Code](#buddyho-t3-code)).                                                                                                                                                           | Upstream ekvivalent nemá: zůstává. Adaptér ACP (`packages/provider-acp/src/server/adapter.ts`) se při stavbě instance ptá `AcpT3Instructions` (bez odpovědi dostane pokyny každá instance), `server.ts` odpoví pro Buddyho instanci tam, kde staví instance poskytovatelů, a `orchestration-v2/ProviderTurnStartService.ts` promítne pro ni kontext stránky jako blok místo obecného `<t3_context>`. Výběr modelu a voleb hlídá druhý přepínač, `AcpT3Selection`, na jediném místě, kde ho adaptér nastavuje (`configureSession`); `server.ts` odpovídá oběma přepínačům jedním obalem `withBuddyInstance` a test přepínače stojí vedle testů adaptéru v `AcpAdapterV2.test.ts`. Na v0.1.3 upstream počítá slash příkaz z textu, který přepíše flavor (`rewriteUserText`, #24605); přestavba vzala tento řádek a ponechala bránu pokynů. Oznámení ACP jsou nově položky `system_notice` (#25704) a Buddyho časová osa je neukazuje. Obecné přepínače pokynů a výběru T3 pro instanci ACP lze nabídnout upstreamu. Při přestavbě ověřte, že adaptér ACP skládá prompt dál na jediném místě (`resolvePromptParts`), výběr nastavuje dál jen `configureSession` při startu, načtení a změně výběru a že usměrnění tahu ACP je dál přerušení a nový tah přes `ProviderTurnStartService`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 24  | `feat(lazurio): agents send once per idempotency key, and Delegace finds Buddy's thread`        | Rozhodnutí 0210 (plán DEV-6676): Delegace budí Buddyho zprávou do jeho vlákna (`t3 thread send … --mode queue`) a po pádu ji pošle znovu. `--idempotency-key` ji pošle jednou na klíč, vlákno a odesílatele i napříč příkazy a restarty a `t3 lazurio buddy thread --json` řekne, které vlákno je Buddyho, a napoprvé ho založí (viz [Agenti a vlákna](#agenti-a-vlákna) a [Buddyho T3 Code](#buddyho-t3-code)). Probuzení od Delegace se ve vlákně neukáže, uživatel vidí jen Buddyho odpověď; zařídí to stopa „Buddy za …“ (řádek 27), ne tento řádek.                                                                                                                                                                                                                                                                                                                                     | Upstream ekvivalent nemá: zůstává. Klíč je upstream `clientRequestId` nástroje `t3_thread_send`, jenže ten platí v jmenném prostoru klienta MCP, tedy jeho sezení, a každý agentní příkaz má sezení vlastní. Šev je dekorátor `McpClientAuthenticator` v `server.ts`: sezení agentních příkazů (štítek `t3 agent cli`) sdílejí jeden prostor, příkaz předá otisk klíče s vláknem a odesílatelem, potvrzenky příkazů T3 ho provedou jednou a cesta overlaye `send-state` řekne, co z odeslání zbylo. Ostatní klienti MCP mají prostor upstreamu. Buddyho vlákno najde nebo založí cesta overlaye `POST /api/lazurio/buddy/thread`. Klíč se vyhodnotí před odesláním a `--wait` čeká jen na běh tohoto odeslání nebo přehrané potvrzenky; odmítnutí, střet ani opakování, které odpoví „delivered“, nečekají. Na v0.1.3 je `stableCommandId` beze změny, nové pole `link` výsledku `t3_thread_send` (#24784) schéma ignoruje a dekorátor `authenticate` je `Effect.fn` jako upstreamový `McpOAuth` (#25099). Při přestavbě ověřte, že upstream dál odvozuje id příkazu z `requestNamespace` a klíče a že potvrzenka příkazu přehraje jeho události.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 25  | `feat(lazurio): Buddy's T3 Code is Buddy's one conversation, framed by the bubble`              | Rozhodnutí 0210 (plán DEV-6676): Buddyho T3 Code je jediný rozhovor. Web místo aplikace T3 ukáže Buddyho povrch: hlavičku s Mattyčusem, dny rozhovoru a čáru nad prvním dnem, bez seznamu vláken, nového vlákna, větvení a návratu; další zpráva tah usměrní, frontu člověk volí výslovně. V bublině mluví s hostitelem protokolem `lazurio.buddy.*` v1 a nosí vzhled jeho stránky. Server totéž drží pro každého klienta a v Buddyho projektu nedělá checkpointy (viz [Buddyho T3 Code](#buddyho-t3-code)).                                                                                                                                                                                                                                                                                                                                                                                 | Upstream ekvivalent nemá: zůstává. Kód je v `apps/*/src/lazurio/` (`buddySurface*`, `BuddySurface.tsx`). Švy jsou dekorátory tam, kde se služby skládají (stráž příkazů v `orchestration-v2/runtimeLayer.ts`, `CheckpointStore` v `server.ts`), fáze startu v `serverRuntimeStartup.ts` před obnovou, klíč `lazurioBuddy` v konfiguraci klienta (`ws.ts`, `packages/contracts/src/server.ts`) a ve webu `routes/__root.tsx` (povrch místo sidebaru a palety), `routes/_chat.index.tsx` (`/` otevře Buddyho vlákno), `routes/_chat.tsx`, `ChatView.tsx` a `MessagesTimeline.tsx` (dny a skok na den). Pole `buddySurface` je ve sdíleném stavu řádků (`chat/timelineRowContext.ts`) a tlačítko větvení skrývá `chat/TimelineAssistantRows.tsx`. Na v0.1.3 upstream instaluje zkratky trasy chatu jednou při startu aplikace (#25366), proto Buddyho podmínka stojí v jejich `when` (`shortcuts/chatRouteCommands.ts`, `isBuddySurfaceNow`), a skok na den bere `navigateTimeline` časové osy (#25463). Sdílení vlákna s hostem (#24104) stráž příkazů odmítá (`thread.guest-share.open`, `.redeem` a `thread.guest-message.submit`) a root na Buddyho povrchu nekreslí `GuestShareDialogHost`, protože Personalspace se nesdílí (rozhodnutí 0091). Nastavení a Využití jsou modální okna nad vláknem (#24847); jestli na ně Buddyho povrch dosáhne, ověřte na canary. Při přestavbě ověřte, že usměrnění dál volí `followUpBehavior`, že `throughEntryId` historie dál přijímá id zprávy a že upstream nepřidal další cestu k větvení, návratu nebo sdílení mimo příkazy orchestrace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 26  | `feat(lazurio): the page Buddy is asked from travels as a chip the person can remove`           | Rozhodnutí 0210 (plán DEV-6676): Buddyho povrch ukáže nad composerem poslední platný kontext stránky hostitele jako čip, který člověk může odebrat. Dokud tam je, nese zpráva, kterou člověk napíše, stránku jako záznam `lazurio-page` s odkazem v textu a Hermes ji dostane jako český blok řádku 23. Odeslaná zpráva ukáže stejný čip (viz [Buddyho T3 Code](#buddyho-t3-code)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Upstream ekvivalent nemá: zůstává. Kód je v `apps/web/src/lazurio/` (`buddySurfacePage.ts`, `BuddySurfacePageChip.tsx`). Záznam je obecný `UnknownContextRecord` kontraktů, takže se kontrakt nemění. Odeslání je v `chat/useComposerSend.ts`: odkaz v textu a záznam přibývají tam, záznam stránky dostane háček od ChatView jako vstup (odebrání čipu žije ve stavu jediného `useBuddyPage`) a snímek pro obnovu po neúspěšném odeslání stránku nedrží. Záložní čip odeslané zprávy je v registru `chat/UserMessageContextChips.tsx`, v composeru v `composerContextPresentation.tsx`. Na v0.1.3 se řádek přenesl beze změny; odeslání zpětné vazby ke schválení (#23657) posílá jen slova člověka bez stránky. Při přestavbě ověřte, že `messageTextForSend` dál drží jen slova člověka, která neúspěšné odeslání vrací do composeru, a že neznámé druhy dál končí v záložním vykreslení registrů.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 27  | `feat(lazurio): a thread shows when Buddy or Delegace sent a message or decided a request`      | Rozhodnutí 0210, večerní dodatek, bod 5 (úkol task-2026-10-20-330): co Buddy napíše nebo schválí ve vlákně, nese viditelnou značku „Buddy za <jméno uživatele>“, a probuzení od Delegace v Buddyho vlastním vlákně se neukáže (rozhodnuto 2026-10-22). Agentní příkaz, jehož prostředí jmenuje, za koho jedná (`T3CODE_ACTING_SENDER`), vydá sezení s podepsaným tvrzením; server podle něj zapíše zprávy a rozhodnutí žádostí, které sezení poslalo, a web je ve vlákně označí, nebo probuzení skryje (viz [Kdo jednal: Buddy a Delegace](#kdo-jednal-buddy-a-delegace)).                                                                                                                                                                                                                                                                                                                   | Upstream ekvivalent nemá: zprávu od agenta zvenku vlákna složí do řádku se jménem vlákna odesílatele, jinak „Agent“ (#23135), a u rozhodnutí žádosti autora nezná. Jde o pojem Lazuria (Buddy jednající za člověka), proto zůstává v overlayi; upstreamu by šlo nabídnout jen obecné tvrzení sezení. Šev: tvrzení `act` vedle `rtc` v `SessionStore.ts`, `actingSender` v `EnvironmentAuth.ts` (vydání a ověřené sezení), přenos do vyvolání klienta MCP (`McpOAuth.ts`, `McpInvocationContext.ts`), jedno volání v `ws.ts`, jedno obalení orchestrátoru v `runtimeLayer.ts` a ve webu řádky vlákna v `MessagesTimeline.tsx`, popisek složené zprávy agenta v `chat/TimelineUserMessageRow.tsx` a značka u rozhodnuté žádosti v `chat/TimelineWorkEntryRow.tsx`. Záznam leží v souborech v T3 home, databáze zůstává upstreamu. Na v0.1.3 upstream počítá štítek složené zprávy jednou jako `senderLabel` (#24104), který čte i nadpis pro čtečky (#23780); overlay obaluje jen viditelný štítek. `McpOAuth.authenticate` je `Effect.fn` (#25099) a klient v něm dostane jeden řádek s `actingSender`. Atribuce hosta upstreamu (#24104) je záznam kontextu zprávy a nevyznačuje, kdo za koho jednal. Při přestavbě ověřte, že upstream nezměnil tvar tvrzení tokenu sezení ani to, že dispatch klienta MCP a plochy uživatele běží ve vlákně požadavku, a že zprávu agenta dál nese řádek druhu `message`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 28  | `feat(lazurio): Buddy's chat reads like a chat with a friend`                                   | Rozhodnutí 0210, dodatek z 2026-10-22, bod 1, a dodatek HumanAndMachines/Lazurio#648: Buddyho chat ukazuje jen to, co Buddy napíše, a dokud Buddy pracuje, i na práci, která běží po tahu, jeden tichý řádek „Buddy na tom pracuje…“. Práci T3 (nástroje, příkazy, uvažování, „Worked for“, úkoly tahu, práci na pozadí) neukazuje, chybu řekne lidskými slovy. Composer nenabízí model, úsilí uvažování, přístup ani režim, jen přepínač Normální / Rychlý, když ho Hermes nabízí, a vlákno běží vždy ve full-access. Pole zprávy říká „Napište Buddymu…“ a fronta drží jen zprávy člověka. Klávesy terminálu, pravého panelu a voleb, které composer nenabízí, nechá prohlížeči (#109). Terminál ani pravý panel T3 neukáže, ať vlákno drží cokoli, a odkaz v rozhovoru otevře v nové záložce prohlížeče. Viz [Buddyho T3 Code](#buddyho-t3-code).                                         | Upstream ekvivalent nemá: zůstává. Kód je v `apps/web/src/lazurio/` (`buddySurfaceTimeline.ts`, `buddySurfaceControls.ts`, `BuddySurface.tsx`). Švy: `MessagesTimeline.tsx` (řádky, které nechá řádek 27, projdou `buddySurfaceRows`, řádek nejdřív zkusí `buddyRowContent`, prop `buddyBackgroundWork`, řádky bez `onRunShellCommand`), `ChatComposer.tsx` (zástupný text z `useBuddyComposer` a pás pod odpočívajícím composerem, jen když Buddyho composer nějaký ovládací prvek má), `ComposerControlsBar.tsx` (`BuddyComposerControls` místo všech ovládacích prvků T3), `ChatBannerLane.tsx` (`BuddyThreadErrorBanner`), `ChatView.tsx` (`useBuddyChatShortcuts`, režim běhu přes `buddyRuntimeMode`, položky práce na konci časové osy maskované v těle komponenty, počet ve frontě přes `useBuddyQueuedRunCount`, terminál přes `buddyTerminalUiState` a bez `ChatTerminalDrawers`, pravý panel přes `buddyRightPanelState` a bez záložek vlákna z `useLazurioThreadTabs`), `QueuedRunsControl.tsx` (`useBuddyQueuedRuns`) a `__root.tsx`; full-access Buddyho vlákna drží na serveru stráž příkazů a cesta vlákna řádku 25. Stav terminálu a panelu se čte uvnitř selektorů úložišť (Lazurio/t3code#134), což hlídá `chatViewPanelPresence.test.ts`. Na v0.1.3 upstream přesunul práci tahu a frontu na konec časové osy a seznam úkolů smazal (#25401): ChatView maskuje `childInputNow`, `goalNow` a `backgroundWorkNow` inline podmínkami (žádná obyčejná funkce kolem výsledku háčku, Lazurio/t3code#135), `buddyBackgroundWork` je to, zda `backgroundWorkNow` existuje, počet ve frontě nepočítá frontové probuzení Delegace, které `getUserQueuedThreadRuns` upstreamu nechává, a šev seznamu úkolů odpadl. T3 už motiv neaplikuje z efektu `useTheme` (#25007, #25461), proto náhrada vzhledu hostitele v bublině následuje každou aplikaci uloženého motivu (`subscribeRenderedAppearance`). Při přestavbě ověřte, že časová osa dál vzniká z řádků `deriveMessagesTimelineRows`, že nepovedený tah nese položka `error` se stavem `failed` bez rodiče, že všechny ovládací prvky composeru dál kreslí jediná `ComposerControlsBar`, že volby poskytovatele dál zapisuje `setProviderModelOptions` a že práci na pozadí, cíl a otázku podvlákna dál dodává `useThreadLifecycle` jako položky pro `ThreadNow`. Ověřte i, že terminál dál kreslí jen `ChatTerminalDrawers`, pravý panel jen `ChatRightPanel` podle stavu, který ChatView čte, a že webové odkazy chatu dál nesou `target="_blank"` a jejich handlery v T3 naslouchají pod oknem, kde je Buddyho povrch předběhne. |
| 30  | `fix(server): a steer waits behind a turn that waits on the person`                             | Lazurio/t3code#119 a Lazurio/t3code#139, rozhodnutí 0211: agent se člověka ptá nástrojem na otázky. Usměrnění (steer) do tahu, který čeká na odpověď na otázku nebo na schválení, zruší čekající callback poskytovatele: Claude usměrňuje s `priority: "now"`, čekající `AskUserQuestion` skončí jako „User cancelled tool execution.“ a schválení jako `cancel`. Člověk otázku nikdy neviděl. Od v0.1.3 je usměrnění výchozí další zprávou (pingdotgg/t3code#24718) a Admin 2026-10-28 rozhodl, že platí pro každého agenta, bota i Buddyho. Dokud vlákno má čekající žádost, jde proto každé usměrnění do fronty za tah: výslovné usměrnění z composeru, `auto` i `steer` zprávy z jiného vlákna (`t3_thread_send`, `t3 thread send`) a zpráva z fronty povýšená na usměrnění, kterou fronta místo toho postaví na začátek. Otázka zůstane a zpráva běží po odpovědi; `restart` se nemění. | Upstream se chová stejně; oprava `sendToThread` je nabídnutá upstreamu (pingdotgg/t3code#21158, na v0.1.3 pořád otevřené). Šev je jedna stráž v `CommandPolicy.resolveMessageDispatchIntent`: dokud projekce vlákna má čekající žádost (`waitsOnPendingRequest`, stejný test jako orchestrátor u snooze), změní `steer_active` na `queue_after_active`, ať usměrnění žádá záměr doručení (`auto`, `steer`), nebo režim dispatch (`sendToThread`, starší klienti). Orchestrátor čte u `message.dispatch` vlákno vždy i s `runtimeRequests`, volající je nenačítají. Povýšení na usměrnění (`dispatchQueuedMessagePromoteToSteer` v `Orchestrator.ts`) použije týž predikát a zprávu postaví na začátek fronty stejně jako povýšený `/goal`. Podmínka Lazurio/t3code#119 v `sendToThread` je pryč a `ThreadManagementService.ts` je zase upstreamu; jeho test rozhoduje režim přes stráž. Až upstream ekvivalent převezme, řádek odeberte.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 31  | `fix(server): a commit, push or pull request finishes when its connection closes`               | Lazurio/t3code#125: brány Prostředí budou otevřené spojení ukončovat pět minut po otevření, aby odebraný člen nezůstal připojený (sledováno v repozitáři Machines). Effect RPC při zavření socketu přeruší všechny fibery klienta, takže git akce (commit, push, pull request), která běžela ve fiberu streamu, se zastavila uprostřed. Teď běží odpojeně od socketu a doběhne. Klient výpadek hlásí jako ztracené spojení, ne jako selhanou akci; výsledek ukáže stav gitu a odkaz na pull request, které se po obnovení spojení znovu načtou.                                                                                                                                                                                                                                                                                                                                              | Upstream se chová stejně; aktualizace serveru má tentýž vzor od upstream #18980 (`updateProgressStream`). Šev: handler `gitRunStackedAction` v `ws.ts` spouští práci přes `git/detachedProgressStream.ts` a `consumeVcsActionProgress` mapuje `RpcClientError` mimo `RpcClientDefect` na `VcsActionConnectionLostError`. Na v0.1.3 je handler v `ws.ts` jen posunutý a dál běží ve fiberu streamu. Oprava se nabídne upstreamu podle jeho CONTRIBUTING; až ji upstream převezme, řádek odeberte.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 32  | `fix(web): a saved follow-up 'queue' becomes 'steer' once on the v0.1.3 line`                   | Lazurio/t3code#140, rozhodnutí Admina z 2026-10-28: na řadě v0.1.3 přejdou všichni jednou na usměrnění. Do v0.1.2 bylo výchozí `queue` a webový klient ho uložil s celým objektem nastavení, takže ho má uložené většina lidí, kteří ho nikdy nevolili. První čtení nastavení na řadě v0.1.3 změní uložené `followUpBehavior: "queue"` bez značky na `steer` a uloží ho se značkou `lazurioFollowUpSteer: true`. Značku nese každý další zápis, takže `queue`, které člověk zvolí potom, zůstane. Nový klient má výchozí `steer`. Bez stráže řádku 30 by přechod rušil čekající otázky.                                                                                                                                                                                                                                                                                                      | Upstream nic takového nedělá: jeho výchozí `steer` (pingdotgg/t3code#24718) uložené `queue` nemění. Šev je jediné čtení a zápis nastavení webu v `clientPersistenceStorage.ts` (klíč `t3code:client-settings:v1`); migrace a schéma úložiště se značkou jsou v `apps/web/src/lazurio/followUpSteerMigration.ts`, `ClientSettings` ani kontrakty se nemění. Vlastní řádek, ne řádek 30: je to jednorázové rozhodnutí distribuce v klientovi, které upstreamu nenabízíme a které má vlastní podmínku odebrání, a nastavení klienta žádný jiný řádek nevlastní. Desktop a mobil jsou oficiální aplikace, které fork nestaví: desktop drží nastavení ve vlastním souboru přes `desktopBridge`, mobil ve svých preferencích, proto migrace platí jen pro web z forku. Řádek odeberte, až Admin potvrdí, že klienti z doby před v0.1.3 nezbyli.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Řádek 14 (`feat(web): reorder right panel tabs by dragging (#17730)`, backport
upstream 410793042) přestavba na v0.1.0 odebrala: upstream ho má i se stejným
testem a povrchy overlaye se přetahují jako ostatní. Řádek 29 (`fix(deps): pin
all patched package versions (#23798)`, backport upstream `22840ab943`)
odebrala přestavba na v0.1.3: upstream ho obsahuje, a `pnpm-workspace.yaml`
i `pnpm-lock.yaml` jsou proto upstreamu beze změny. Ostatní řádky si čísla
nechávají.

Hostované proměnné a spravovaná složka platí, jen když jsou nastavené, a shell,
prohlížeč Environmentu, Nová karta, vzhled design systému a párování
Environmentem se ukážou, jen když je Environment nabízí. Proměnná
`T3CODE_LAZURIO_FOLDER` přitom označuje Environment Lazuria: s ní server nestaví
serverový prohlížeč upstreamu a nástroje prohlížeče T3 ovládají prohlížeč
Environmentu, jakmile ho Environment deklaruje. Bez ohledu na to platí šest
věcí: server pod launcherem kontroluje vydání svého kanálu a on i `t3 update`
je bez `T3CODE_RELEASE_REPOSITORY` berou z `Lazurio/t3code` (kontrolu vypne
`T3CODE_UPDATE_CHECK_ENABLED=false`), procesy agentů vlákna, jeho terminály a
příkazy agenta Codexu dostávají `AGENT_BROWSER_SESSION`, které nic nepovoluje
(kterých procesů se to týká, říká řádek 8), stránka bez sezení T3 na HTTPS se
nejdřív zeptá svého originu na `/.lazurio/chat/pairing` (mimo Lazurio dostane
`index.html` T3 a pokračuje na párovací stránku, řádek 19), vlákna Codexu mají
nástroj na otázky i v režimu Default a pokyn ptát se jím (řádek 22), web se u
zprávy od agenta zvenku vlákna a u rozhodnuté žádosti zeptá serveru, kdo jednal,
a probuzení od Delegace neukáže (řádek 27), a build distribuce se v aplikaci jmenuje „T3 Code (Lazurio)“. Řádek odeberte, jakmile
upstream nabídne ekvivalent.
Upstream soubory pod `apps/`, `packages/` a `scripts/` overlay mění jen
v přesných souborech z allowlistu `allowed_upstream_changes` v
`lazurio-fork-ci.yml`. Allowlist je seskupený podle funkce, které soubor patří.
Soubory, které mění víc funkcí, má v jedné skupině společných švů: konfiguraci
serveru (`apps/server/src/cli/config.ts`, `config.ts`), `server.ts`
(přesměrování `t3` po aktivaci, sezení agent-browser, brána prohlížeče upstreamu,
vrstva cest overlaye, Buddyho instance bez pokynů, modelu a úsilí T3 a jeden jmenný
prostor požadavků agentních příkazů), `environment/ServerEnvironment.ts` (nabídka aktualizace
a deskriptor bez `serverBrowser`), `orchestration-v2/Adapters/CodexAdapterV2.ts`
a jeho test (sezení agent-browser v konfiguraci vlákna Codexu a funkce nástroje
na otázky na app-serveru), `orchestration-v2/runtimeLayer.ts` (stráže
spravované složky a přihlášení a záznam toho, kdo jednal, jako dekorátory služeb
upstreamu), `auth/SessionStore.ts` (TTL a cookie hostované konfigurace a
tvrzení `act` v tokenu sezení), `auth/EnvironmentAuth.ts` (strop režimu klienta
MCP a tvrzení `actingSender` při vydání a ověření sezení), `ws.ts` (konfigurace
spravované složky pro klienty a dispatch jako sezení, které ho poslalo) a ve webu
`index.html`, `main.tsx`, `ChatView.tsx`, `RightPanelTabs.tsx`,
`rightPanelStore.ts`, `sidebar/SidebarChrome.tsx`, `chat/MessagesTimeline.tsx` (dny Buddyho
rozhovoru a řádky, které nechá záznam toho, kdo jednal, a Buddyho chat) a
`chat/TimelineUserMessageRow.tsx` („Copy prompt link“ a popisek toho, kdo jednal, u složené
zprávy agenta). Každý záznam je vědomé rozhodnutí se zdůvodněním;
jakoukoli jinou změnu pod těmito cestami CI odmítne. Vlastní složky overlaye
`apps/*/src/lazurio/`, které upstream nemá, projdou celé. Overlay mění i wire
kontrakty, ve dvou souborech `packages/contracts` (`environment.ts` a
`server.ts`) a jen o volitelná pole. Verze se razítkují jen při buildu upstream
skriptem `scripts/update-release-package-versions.ts`, do Gitu se necommitují.

### Cílový stack

Příští přestavba přehraje overlay jako jeden commit na řádek tabulky, s jeho
předmětem a v jeho pořadí, jen řádek 5 jde poslední. U každého řádku je jeho
commit z přestavby na v0.1.3 a soubory, které mění; řádek, který přibude až po
přestavbě, řekne, kde jeho commit na `main` je.

- Soubory distribuce (`.dockerignore`, `Dockerfile.lazurio`,
  `.github/workflows/lazurio-*.yml`, `.github/ISSUE_TEMPLATE/1-lazurio-t3-code.yml`,
  `.github/README.md`, `.github/SECURITY.md`, `docs/operations/lazurio-*.md`,
  `.agents/skills/lazurio-upstream-rebuild/` a
  `scripts/lazurio-release-contract.test.mjs`) patří celé řádku 5. Jejich konečný
  stav (allowlist, švy v kontraktním testu, tento runbook) popisuje všechny
  řádky, proto řádek 5 jde poslední.
- Commit, který mění jen soubory distribuce, patří řádku 5. Commit, který mění i
  jiné soubory, patří řádku těch souborů a jeho změny souborů distribuce
  přejdou do řádku 5. Pozdější commity se řadí stejně, podle souborů.
- Soubor označený \* mění víc řádků. Každý řádek si vezme své změny; kde je
  oddělit nejde, vezme soubor celý první řádek, který ho mění. CI musí projít
  jen hlava candidate branch.

Commity v pořadí na `main`:

- **1.** `b8c742cb19`. `apps/server/src/auth/SessionStore.ts`\* a jeho test,
  `apps/server/src/cli/config.ts`\* a `config.test.ts`\*,
  `apps/server/src/config.ts`\*.
- **2.** `01aee3d3a2`. `apps/server/src/auth/`: `EnvironmentAuthPolicy.ts` a jeho
  test, `SessionStore.ts`\*, `http.ts`, `utils.ts`; `apps/server/src/cli/config.ts`\*
  a `config.test.ts`\*, `apps/server/src/config.ts`\*;
  `apps/server/src/lazurio/hostedSessionCookie.test.ts`.
- **3.** `d7e669aa2e`. `apps/server/src/environment/ServerEnvironmentLabel.ts`;
  test `apps/server/src/lazurio/environmentLabel.test.ts` (upstream ten svůj smazal).
- **4.** `5c8a271235`. Server: `cli/update.ts` a jeho test, `cloud/bootService.ts`,
  `cloud/pinnedRuntime.ts`, `cloud/releaseIndex.ts` a `cloud/selfUpdate.ts`
  (poslední tři s testy), `environment/ServerEnvironment.ts`\* a jeho test,
  `server.ts`\* (přesměrování `t3` po aktivaci); `apps/server/src/lazurio/`:
  `launcherLink.ts` a jeho test. Web: `components/chat/useSystemComposerBanners.tsx`
  (oznámení v composeru), `components/chat/useAutoBalanceUpdateBanner.tsx`,
  `components/settings/ConnectionsSettings.tsx` a `SavedEnvironmentRows.tsx`,
  `components/sidebar/updateEverything.logic.ts` a `useUpdateEverything.ts`
  (tlačítko aktualizace v sidebaru, od v0.1.3), `versionSkew.ts` a jeho test,
  `lazurio/serverUpdateOffer.test.ts`. `packages/contracts/src/environment.ts`,
  `packages/shared/src/cliRelease.ts` a jeho test, `scripts/install.sh`, `scripts/install.ps1`,
  `scripts/install-scripts.test.ts`, `docs/user/updating.md`,
  `docs/user/background-service.md`.
- **6.** `183fcb0b96`. `apps/web/src/main.tsx`\*, `apps/web/src/routes/_chat.tsx`\*,
  `apps/web/src/lazurio/`: `LazurioPromptDraft.tsx`, `promptDraft.ts` a jeho
  test.
- **7.** `1c5647a7ea`. `apps/web/index.html`\*,
  `apps/web/src/components/sidebar/SidebarChrome.tsx`\* (hlavička sloupce pod
  horním řádkem sidebaru). Místo pro Buddyho spouštěč (F60, dodatek z 2026-10-25) nese na v0.1.3
  commit řádku 28: `apps/web/index.html`\*.
- **8.** `f11f3d9cc8`. `apps/server/src/server.ts`\* (dekorátor `AgentScope`),
  `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`\* a jeho test\*,
  `apps/server/src/terminal/Manager.ts` (prostředí terminálu vlákna),
  `apps/server/src/lazurio/agentBrowserSession.ts` a jeho test.
- **9.** `abdc05170a`. `apps/web/src/components/ChatView.tsx`\* (volání háčku,
  obal rámů), `RightPanelTabs.tsx`\* (název s titulky rámů jako vstupem, ikona,
  tooltip v `RightPanelTab`, menu záložky, volání háčku, řádek konceptu),
  `apps/web/src/rightPanelStore.ts`\* (druh povrchu, jeho člen, `openProactive`,
  akce `lazurio`, přeskočení v paměti zavřených záložek); `apps/web/src/lazurio/`:
  `LazurioEnvironmentBrowser.tsx`\* a jeho test v prohlížeči, `environmentBrowser.ts`
  a jeho test, `browserView.ts`, `threadTabs.ts` a jeho testy (`threadTabs.test.ts`,
  `threadTabs.browser.test.ts`).
- **10.** `062434e25f`. `apps/server/src/server.ts`\* (brána serverového
  prohlížeče upstreamu), `apps/server/src/environment/ServerEnvironment.ts`\*
  (deskriptor bez `serverBrowser`), `apps/server/src/mcp/toolkits/preview/tools.ts`;
  `apps/server/src/lazurio/`: `serverBrowser.ts`, `environmentBrowser.ts`,
  `environmentBrowserConnection.ts` a `environmentBrowserPage.ts`, každý
  s testem, `lazurioEnvironment.ts`, `browserView.ts`. Test, že brána sdílí
  aktivitu tahu agenta (`serverBrowser.test.ts`), je na v0.1.3 samostatný commit
  `1bcbeb2d6c` za řádkem 31.
- **11.** `247c407c8e`. `apps/server/src/server.ts`\* (vrstva cest overlaye),
  `apps/server/src/lazurio/`: `holders.ts` a jeho test, `overlay.ts`\*,
  `threadTabs.ts` a jeho test, `threadTabsRoute.ts` a jeho test, `routeAuth.ts`.
- **12.** `23e536d6cb`. `apps/server/src/lazurio/threadLifecycle.ts` a jeho test.
- **13.** `10bd2897be`. `apps/web/src/components/RightPanelTabs.tsx`\* („+“,
  prázdný stav a Mod+T), `apps/web/src/rightPanelStore.ts`\* (Nová karta jako
  singleton druhu); `apps/web/src/lazurio/`: `LazurioNewTab.tsx` a jeho testy
  (`LazurioNewTab.test.ts`, `LazurioNewTab.browser.test.tsx` a
  `LazurioNewTab.withoutElement.browser.test.tsx`), `LazurioEnvironmentBrowser.tsx`\*.
- **15.** `bf0c8d1dac`. Server: `binCli.ts`\*, `cli/config.ts`\*, `config.ts`\*,
  `orchestration-v2/runtimeLayer.ts`\* (stráže), `serverRuntimeStartup.ts`\*,
  `serverSettings.ts`, `vcs/VcsProvisioningService.ts`, `ws.ts`\*;
  `apps/server/src/lazurio/`: `cli.ts`\* a jeho test\*, `managedFolder.ts`,
  `managedFolderConfig.ts`, `managedFolderGuards.ts`, `managedFolderStartup.ts`,
  `modelRecommendation.ts` a `modelRecommendationRoute.ts`, každý s testem,
  `managedFolderVcs.test.ts` (háček VCS), `managedFolder.testkit.ts`, `overlay.ts`\*. Háček `updateSettingsWith` ve
  `serverSettings.ts` je obecný: používá ho i řádek 18. Web:
  `components/CommandPalette.tsx`, `components/GitActionsControl.tsx`,
  `components/Sidebar.tsx`, `components/chat/DraftHeroHeadline.tsx`,
  `components/onboarding/FirstRunGate.tsx`,
  `components/sidebar/SidebarThreadHeader.tsx`, `hooks/useHandleNewThread.ts`
  a jeho test, `routes/welcome.tsx`, `components/chat/TimelineUserMessageRow.tsx`\*
  („Copy prompt link“ u zpráv i automatizací); `apps/web/src/lazurio/`: `managedFirstRun.ts`,
  `managedFolder.ts` a jeho test, `managedPromptLinks.ts` (jeden atom pro „Add
  project“ i „Copy prompt link“). `packages/contracts/src/server.ts`\*.
- **16.** `993a2f0aa9`. `apps/web/src/`: `branding.ts` a `branding.logic.ts`,
  `components/sidebar/SidebarChrome.tsx`\* (štítek u wordmarku),
  `lazurio/branding.test.ts`, `lazurio/LazurioBadge.tsx` a `lazurio/brand/` (dvě SVG symbolu
  z design systému a jejich `README.md`\* s licencí značkových souborů);
  `apps/web/index.html`\* (titulek a splash), `apps/web/public/manifest.webmanifest`
  (hodnota `name`), `lib/bootError.ts` (obrazovka „failed to start“, od v0.1.3)
  a `bundledDev.test.ts` (kopie souborů brandingu).
- **17.** `e10ea484b7`. `apps/web/src/main.tsx`\* (import),
  `apps/web/src/lazurio/theme.css`.
- **18.** `da2925ed98`. Server: `orchestration-v2/runtimeLayer.ts`\* (stráž nad
  `ProviderAuthService`); `apps/server/src/lazurio/`: `providerRefresh.ts`,
  `providerRefreshRoute.ts` a `providerSignIn.ts`, každý s testem, `cli.ts`\* a
  jeho test\*, `overlay.ts`\*. Web: `components/settings/CodexSetupSection.tsx`,
  `components/settings/AddProviderInstanceDialog.tsx`; `apps/web/src/lazurio/`:
  `LazurioSignIn.tsx` a jeho test v prohlížeči, `providerSignIn.ts` a jeho test.
- **19.** `69da07a76a`. Server:
  `apps/server/src/lazurio/cli.ts`\* a jeho test\* (`t3 lazurio pairing`
  a `operatorPairing` v `capabilities`). Web:
  `apps/web/src/environments/primary/auth.ts`; `apps/web/src/lazurio/`:
  `environmentPairing.ts` a jeho test.
- **20.** `41f94a0fe3`. Server: `auth/EnvironmentAuth.ts`\* (nepovinný strop
  v `issueSession`, export `MCP_CLIENT_SUBJECT`), `cli/auth.ts` a nový `cli/auth.test.ts`
  (i s případem formátu), `cliAuthFormat.ts`.
- **21.** `c78df034bf`. Server: `binCli.ts`\* (příkazy a jedna skupina `thread`
  s upstreamovou), `cli/thread.ts` (export `runResultText`),
  `mcp/OrchestratorMcpService.ts` (export `listItemFromShell`); `apps/server/src/lazurio/`:
  `agentCli.ts`\*, `agentCliConnection.ts`\* a `agentCliViews.ts`, testy `agentCli.test.ts`\* a
  `agentCliViews.test.ts`, `cli.ts`\* a jeho test\* (`agentCli` v `capabilities`). Uživatelský
  návod `docs/user/agent-cli.md` a odkazy na něj v `README.md`, `docs/README.md` a
  `docs/user/outside-agents.md`.
- **22.** `1a4eed3bb8`. Server: `orchestration-v2/Adapters/CodexAdapterV2.ts`\*
  a jeho test\* (funkce Codexu při spuštění app-serveru, otázka režimu Default),
  `provider/CodexDeveloperInstructions.ts` (položka kontextu tahu, text režimu
  Default); `apps/server/src/lazurio/`: `questionTool.ts` a jeho test.
- **23.** `a4dc355168` (rozhodnutí 0210, plán DEV-6676). Server: `orchestration-v2/ProviderTurnStartService.ts`
  (kontext stránky pro Buddyho instanci), `server.ts`\* (Buddyho instance bez pokynů T3);
  `packages/provider-acp/src/server/adapter.ts` (`AcpT3Instructions`); `apps/server/src/lazurio/`:
  `buddySurface.ts`\*, `buddyPrompt.ts` a jeho testy (`buddyPrompt.test.ts`,
  `buddyPrompt.orchestrator.test.ts`\*). Dodatek HumanAndMachines/Lazurio#648 nese na v0.1.3 commit řádku 28
  (příští přestavba ho vrátí sem): `adapter.ts` (`AcpT3Selection`),
  `server.ts`\* (`withBuddyInstance`), `orchestration-v2/Adapters/AcpAdapterV2.test.ts` (test
  přepínače), `buddyPrompt.ts` a jeho testy, `buddySurface.testkit.ts`\*.
- **24.** `6e1609cad2` (rozhodnutí 0210, plán DEV-6676). Server: `server.ts`\* (jmenný prostor požadavků
  agentních příkazů); `apps/server/src/lazurio/`: `agentCliRequests.ts`\*, `agentCli.ts`\*
  (`--idempotency-key`) a jeho test\*, `agentCliConnection.ts`\* (`postRoute`),
  `agentCliSendState.ts`, `buddySurfaceThread.ts`\* a jeho test\*, `buddySurfaceThreadRoute.ts`\*,
  `buddySurfaceCli.ts`\*, `buddySurface.testkit.ts`\*, `overlay.ts`\*, `cli.ts`\* a jeho test\*
  (`buddy` a nové klíče v `capabilities`). Uživatelský návod `docs/user/agent-cli.md`.
- **25.** `6353374b45` (rozhodnutí 0210, plán DEV-6676). Server: `orchestration-v2/runtimeLayer.ts`\* (stráž
  příkazů), `server.ts`\* (bez checkpointů v Buddyho projektu), `serverRuntimeStartup.ts`\*
  (výchozí nastavení), `ws.ts`\* (`lazurioBuddy`); `apps/server/src/lazurio/`: `buddySurface.ts`\*,
  `buddySurfaceStartup.ts`, `buddySurfaceDays.ts` a `buddySurfaceGuards.ts`, každý s testem,
  `buddySurfaceThread.ts`\* a jeho test\*, `buddySurfaceThreadRoute.ts`\*,
  `buddySurface.testkit.ts`\*, `buddyPrompt.orchestrator.test.ts`\*, `overlay.ts`\*.
  `packages/contracts/src/server.ts`\*. Web: `routes/__root.tsx`\*, `routes/_chat.index.tsx`,
  `routes/_chat.tsx`\*, `components/ChatView.tsx`\*, `components/chat/MessagesTimeline.tsx`\*
  (dny a skok na den), `shortcuts/chatRouteCommands.ts` (podmínka zkratek trasy chatu, od
  v0.1.3), stráž sdílení s hostem v `buddySurfaceGuards.ts`, `components/chat/timelineRowContext.ts` (Buddyho povrch ve stavu řádků),
  `components/chat/TimelineAssistantRows.tsx` (bez větvení), `public/assets/avatar.webp`; `apps/web/src/lazurio/`: `BuddySurface.tsx`, `useBuddyFrame.ts`,
  `buddySurfaceFrame.ts` a `buddySurfaceProtocol.ts`, každý s testem, `brand/README.md`\*,
  `BuddySurface.tsx`\* (adresa jiného vlákna Buddyho Environmentu vede na Buddyho vlákno)
  a jeho test v prohlížeči `buddySurfaceRoute.browser.test.tsx`. Vzhled hostitele (požadavek z 2026-10-25) nese na v0.1.3 commit řádku 28
  (příští přestavba ho vrátí sem): `BuddySurface.tsx`\* (`BuddySurfaceLayout`) a
  `buddySurfaceTheme.browser.test.tsx`.
- **26.** `a5316c8430` (rozhodnutí 0210, plán DEV-6676). Web: `components/ChatView.tsx`\*
  (záznam stránky pro odeslání a čip), `components/chat/useComposerSend.ts` (odkaz v textu
  a záznam při odeslání), `components/composerContextPresentation.tsx` a
  `components/chat/UserMessageContextChips.tsx` (čip odkazu); `apps/web/src/lazurio/`: `buddySurfacePage.ts` a jeho test, `BuddySurfacePageChip.tsx`,
  `BuddySurface.tsx`\* (`useBuddyPage`).
- **27.** `cd94a7a096` (rozhodnutí 0210, večerní dodatek, bod 5; plán DEV-6676). Server:
  `auth/SessionStore.ts`\* (tvrzení `act`), `auth/EnvironmentAuth.ts`\*
  (`actingSender`), `auth/McpOAuth.ts`, `mcp/McpInvocationContext.ts`,
  `ws.ts`\* (`actingAs`), `orchestration-v2/runtimeLayer.ts`\* (`recordSteps`);
  `apps/server/src/lazurio/`: `actingSender.ts`, `actingSenders.ts` a
  `actingSendersRoute.ts`, testy `actingSender.test.ts`, `actingSenders.test.ts` a
  `actingSendersReplay.test.ts`, `agentCliConnection.ts`\* a `agentCli.test.ts`\*,
  `actingSenderVisibility.ts` (kopie webové, co člověk ve vlákně vidí), `buddySurfaceDays.ts`\*
  a jeho test\* (dny bez budíčku Delegace),
  `cli.ts`\* a jeho test\* (`actingSender` v `capabilities`), `overlay.ts`\* a Delegace místo
  budíčku v `agentCliRequests.ts`\*, `buddySurfaceCli.ts`\*, `buddySurfaceThread.ts`\* a
  `buddySurfaceThreadRoute.ts`\*. Web: `components/chat/MessagesTimeline.tsx`\* (řádky vlákna),
  `components/chat/TimelineUserMessageRow.tsx`\* (popisek složené zprávy agenta),
  `components/chat/TimelineWorkEntryRow.tsx` (značka u rozhodnuté žádosti);
  `apps/web/src/lazurio/`: `actingSender.ts` a jeho test, `actingSenderVisibility.ts`,
  `LazurioActingSender.tsx`.
  Uživatelský návod `docs/user/agent-cli.md`.
- **28.** `d9e17cf764` (rozhodnutí 0210, dodatek z 2026-10-22, bod 1; plán DEV-6676). Web:
  `components/chat/MessagesTimeline.tsx`\* (řádky, jejich vykreslení a `buddyBackgroundWork`),
  `components/chat/ChatComposer.tsx` (zástupný text), `components/chat/ComposerControlsBar.tsx`
  (modely čipu možností a bloky), `components/chat/ChatBannerLane.tsx` (banner chyby),
  `components/chat/QueuedRunsControl.tsx` (fronta člověka), `components/ChatView.tsx`\* (zkratky,
  maskování práce na konci časové osy, počet ve frontě a `buddyBackgroundWork`), `routes/__root.tsx`\*
  (`ReopenClosedViewShortcut`); `apps/web/src/lazurio/`: `buddySurfaceTimeline.ts` a jeho test
  v prohlížeči, `buddySurfaceControls.ts` a jeho testy (`buddySurfaceControls.test.ts`,
  `buddySurfaceControls.browser.test.tsx`), `buddySurfaceQueue.browser.test.tsx`,
  `BuddySurface.tsx`\*. Dodatek HumanAndMachines/Lazurio#648 (přepínač Normální / Rychlý):
  `ComposerControlsBar.tsx` (Buddyho ovládací prvky místo
  lišty T3), `ChatComposer.tsx`, `ChatView.tsx`\* (`buddyRuntimeMode`) a v `apps/web/src/lazurio/`
  `buddySurfaceControls.ts` s testy a `BuddySurface.tsx`\*; na serveru stráž full-access
  v `buddySurfaceGuards.ts`\* a návrat na full-access v `buddySurfaceThread.ts`\*, oba s testem.
  Povrch bez terminálu a pravého panelu (týž dodatek): `ChatView.tsx`\* (terminál a pravý panel vlákna jako zavřené, bez
  `ChatTerminalDrawers` a bez záložek vlákna z prohlížeče Environmentu),
  `components/chat/MessagesTimeline.tsx`\* (řádky bez `onRunShellCommand`) a v
  `apps/web/src/lazurio/` `BuddySurface.tsx`\* (také odkazy do nové záložky),
  `buddySurfaceControls.ts` a testy `buddySurfaceTerminal.browser.test.tsx`,
  `buddySurfaceRightPanel.browser.test.tsx` a `buddySurfaceTimeline.browser.test.tsx`.
  Na v0.1.3 nese commit řádku 28 i dodatek HumanAndMachines/Lazurio#648 řádku 23
  (`AcpT3Selection`), vzhled hostitele řádku 25, místo pro spouštěč řádku 7
  (`apps/web/index.html`\*), opravu selektorů Lazurio/t3code#134 a jeho test
  `apps/web/src/lazurio/chatViewPanelPresence.test.ts`.
- **29.** Odebraný přestavbou na v0.1.3: upstream backport #23798 obsahuje.
- **30.** `22a06bceec` (Lazurio/t3code#119). Server: `orchestration-v2/ThreadManagementService.ts` a jeho test;
  uživatelský návod `docs/user/agent-cli.md`. Stráž Lazurio/t3code#139 nese na `main` commit
  `fix(server): a steer waits behind a turn that waits on the person` za řádkem 31 (příští přestavba
  ho vrátí sem a řádek ponese jeho předmět): `orchestration-v2/CommandPolicy.ts` a jeho test,
  `orchestration-v2/Orchestrator.ts` (povýšení na usměrnění), `SteeringCompletion.integration.test.ts`,
  test `ThreadManagementService.test.ts` a uživatelské návody `docs/user/composer.md` a
  `docs/user/agent-cli.md`; `ThreadManagementService.ts` vrací do stavu upstreamu.
- **31.** `4ab099c7e4` (Lazurio/t3code#125). Server: `ws.ts` (handler `gitRunStackedAction`),
  `git/detachedProgressStream.ts` a jeho test; klient: `packages/client-runtime/src/state/vcsAction.ts`
  a jeho test.
- **32.** Na `main` commit `fix(web): a saved follow-up 'queue' becomes 'steer' once on the v0.1.3 line`
  za commitem stráže řádku 30 (Lazurio/t3code#140). Web: `clientPersistenceStorage.ts` a jeho test;
  `apps/web/src/lazurio/followUpSteerMigration.ts`.
- **5.** Tento commit, poslední. Soubory distribuce.

### Lazurio shell

**Rozhodnuto 2026-10-03 (rozhodnutí o shellu Lazuria); slot je v overlayi od
issue #33.** V Lazuriu je T3 Code aplikace **Chat** v přepínači Chat · Apps ·
Automate. Overlay do webového klienta přidává jen slot pro shell Lazuria: rail
vlevo, hlavičku sloupce (výběr Environmentu, ozubené kolo Nastavení a přepínač
Chat · Apps · Automate) ve vlastním sidebaru T3 pod jeho horním řádkem a
plovoucí bublinu Buddyho. Shell jsou Web Components se Shadow DOM (`<lazurio-rail>`,
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
  `vite-ignore` (Vite značku nechá být a nic nebunduje), `<lazurio-rail app="chat">` před
  `#root` a `<lazurio-buddy>` za ním. Podle `app` zůstává klik na Organizaci
  v railu v Chatu (rozhodnutí 0185 bod 1). Dál
  `#root { box-sizing: border-box; padding-left: var(--lazurio-rail-width, 0px); }`:
  odsazení, ne posun, protože `#root` má v upstreamu `width: 100%` pod
  `body` s `overflow: hidden` a `margin-left` by pravý okraj uřízl. Sidebar T3
  a jeho přepínač jsou ale `position: fixed` vůči oknu a samotné odsazení by je
  nechalo pod railem. Proto se při definovaném railu stane obal sidebaru
  (`[data-slot="sidebar-wrapper"]`) jejich containing blockem
  (`contain: layout paint`). Bez shellu pravidlo neplatí.
  Buddyho spouštěč stojí 22 px od pravého a dolního okraje okna a po dobu, kdy ho shell kreslí,
  nastaví na dokumentu `--lazurio-buddy-clearance`, šířku jeho rohu od pravého okraje
  (LazurioPlatform F60, dodatek z 2026-10-25). Composer Chatu (`[data-chat-composer-stack]`)
  nechá tlačítko odeslání mimo ten roh: kde by vycentrovaný composer přišel k pravému okraji blíž,
  posune se doleva a pak zúží, právě o kolik je třeba. Odsazení konce pruhu composeru
  (`.chat-composer-lane` v `index.css`, 0,75rem, od 640 px 3rem) pravidlo opakuje, proto ho
  kontraktní test drží ve shodě. Bez vlastnosti zůstane composer, kde ho T3 kreslí; Buddyho povrch
  spouštěč nemá.
- `apps/web/src/components/sidebar/SidebarChrome.tsx`:
  `<lazurio-column-head active="chat">` hned pod horním řádkem upstreamu.
  Nahoře zůstává řádek s přepínačem sidebaru, wordmarkem T3 Code a štítkem
  „Lazurio“, pod ním výběr Environmentu, ozubené kolo a přepínač aplikací
  (schválený design levého sloupce z 2026-10-17, prototyp
  HumanAndMachine-ai/prototypes-lazurio#56 a #61; rozhodnutí 0200 bod 1:
  značka T3 Code zůstává, viz [Jméno a vzhled](#jméno-a-vzhled)). Řádek
  upstreamu se jmenuje `SidebarChromeTitlebar` a exportovaný
  `SidebarChromeHeader` je tenký obal, který za něj přidá hlavičku sloupce.
  Horní řádek kreslí sidebar vláken, legacy sidebar i Nastavení, takže hlavičku
  mají všechny tři. Přepínač sidebaru (`position: fixed`) zůstává v horním
  rohu jako v upstreamu, při otevřeném i skrytém sidebaru, a
  `AppSidebarLayout.tsx` se nemění.

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
motiv T3, světlý i tmavý, i jeho přepnutí za běhu, a na Environmentu i světlý
vzhled design systému, který tokeny T3 mapuje. Vlastní výběr motivů má
zatím každá aplikace; sjednocení motivů napříč aplikacemi je samostatná
pozdější práce.

Mezi railem a sidebarem T3 je od 2026-10-17 tenká čára (rozhodnutí
Organization Admina ke schválenému designu levého sloupce mění rozhodnutí 0187
bod 2). Kreslí ji rail barvou role `--lazurio-line`, kterou `index.html` bere
z `--contrast-sidebar-border` T3, takže sleduje světlý, tmavý i každý jiný
motiv; fork pro čáru nic nepřidává. Plocha railu a sidebaru má zůstat stejná,
aby čára byla jediným rozhraním. Proto:

- Role jsou deklarované na `:root` i na `[data-app-sidebar]`, tedy tam, kde
  T3 přepočítává paletu svého sidebaru, a `<lazurio-rail>` nese
  `data-app-sidebar`. Ve výchozím tmavém motivu má sidebar T3 vlastní paletu
  (`#000`), kdežto `--sidebar` dokumentu je o odstín světlejší; bez toho by
  rail vedle sidebaru tvořil hranu.
- Rail nosí zrnitost `--surface-grain`, kterou T3 dává svým plochám. Bez ní
  se rail od sidebaru liší o 1–3 z 255 úrovní jasu a hrana je vidět. Vzhled
  design systému zrnitost nemá, ani na railu, ani na sidebaru.
- Kontejner sidebaru T3 má okraj jen vpravo, mezi sidebarem a hlavní plochou,
  a ten zůstává. Levá hrana sidebaru ani `#root` okraj nemají.

Atribut `data-app-sidebar` je v upstreamu jen CSS scope palety; žádný skript
ho nevyhledává. Kdyby to upstream začal dělat, našel by jako první rail.
Kontraktní test proto hlídá mapování rolí, tokeny v `index.css` i to, že
atribut v `apps/web/src` používá jen `AppSidebarLayout.tsx`. Přestavba, která
cokoli z toho poruší, v CI selže a vyžaduje nové rozhodnutí.

Značka T3 Code zůstává a o Chatu dál mluvíme jako o T3 Code; jméno a vzhled na
Environmentu popisuje [Jméno a vzhled](#jméno-a-vzhled). Mimo Lazurio se nic
nevykreslí: bez `/.lazurio/shell.js` (samostatný server, vývoj upstreamu)
zůstanou elementy nedefinované, šířka railu je 0, hlavička sloupce má výšku 0
a klient se chová jako upstream. Server T3 na neznámou cestu vrátí
`index.html`, takže prohlížeč jen zaloguje neúspěšné načtení skriptu. Oficiální
desktop a mobilní aplikace jsou upstream a shell nemají.

### Jméno a vzhled

**Rozhodnutí 0200 (2026-10-13, plán DEV-6646).** Chat je distribuce Lazurio T3
Code, upravená distribuce T3 Code. Značka T3 Code zůstává: wordmark, ikony,
jméno produktu a texty, které říkají „T3 Code“, jsou upstreamu. „T3 Code“
používáme jako přesný popis toho, z čeho distribuce vychází, nikdy jako značku
Lazuria; wordmark ani ikony nepřebarvujeme ani nepřekreslujeme.

- **Distribuce.** Vydání se jmenují `Lazurio T3 Code v<verze>`, stable
  i preview. Poznámky začínají „Lazurio T3 Code, a modified distribution of T3
  Code vX.Y.Z“, mluví o Environmentech a končí řádkem se zdrojovým commitem
  a licencí. Image nese OCI štítky `title`, `description`, `licenses` (MIT),
  `url` a `vendor`, stejné ve workflow vydání i v `Dockerfile.lazurio`. Issues
  mají vlastní formulář `1-lazurio-t3-code.yml`, první v nabídce; formuláře
  upstreamu a jejich konfigurace zůstávají. Bezpečnostní hlášení formulář
  posílá na soukromé hlášení zranitelností, které musí být v nastavení
  repozitáře zapnuté (zapnuté 13. 10. 2026). GitHub ukazuje `.github/README.md`
  místo kořenového `README.md`, které zůstává upstreamu. `.github/SECURITY.md`
  je jediný soubor upstreamu mimo `apps/`, `packages/` a `scripts/`, který
  distribuce mění: nahoře posílá problémy distribuce soukromě sem a pod
  nadpisem „Upstream T3 Code“ drží text upstreamu beze změny. Při přestavbě
  převezměte nový text upstreamu do té sekce.
- **Jméno v aplikaci (řádek 16).** Build distribuce má štítek fáze `Lazurio`
  místo upstream `Beta`, takže se jmenuje „T3 Code (Lazurio)“: v titulku
  záložky, na stránkách párování, 404 a chyby, v hlášení chyby, ve splashi
  a ve web manifestu (`short_name` je „T3 Code“). Štítek „Lazurio“ stojí
  i vedle wordmarku v sidebaru, v místě, které upstream dává pilulce Dev
  a Nightly, a to v každém režimu identifikace. Od 2026-10-17 (schválený
  design levého sloupce) má štítek před slovem symbol Lazuria
  (`apps/web/src/lazurio/LazurioBadge.tsx`): celý schválený asset design
  systému v nejmenší povolené velikosti 16 px, na tmavém vzhledu tmavá
  verze; proto je štítek vyšší (20 px) než malá pilulka T3. Soubory symbolu
  jsou v `apps/web/src/lazurio/brand/` beze změny. Vývojový build zůstává
  „T3 Code (Dev)“. Náhled `X.Y.Z-preview.YYYYMMDD.N` je canary příštího
  stable, ne nightly: jmenuje se stejně a nemá noční artwork upstreamu.
- **Vzhled (řádek 17).** Shell Environmentu (`/.lazurio/shell.js`,
  LazurioPlatform F36, dodatek z 2026-10-13) deklaruje tokeny design systému
  `--lz-*` na kořeni dokumentu a označí ho `data-lazurio-theme="light"`.
  `apps/web/src/lazurio/theme.css` je mapuje na vlastní tokeny T3 jen ve
  standardním vzhledu: obě jeho pravidla platí pod
  `:root[data-lazurio-theme="light"]:not([data-theme-id]):is(:not(.dark), [data-lazurio-theme-dark])`,
  jedno na kořeni a jedno ve scope palety sidebaru (`[data-app-sidebar]`), kam
  patří i rail. Bílé plochy a papírový sidebar, inkoustový text, černá tlačítka,
  šedý výběr o stupeň tmavší, vlasové linky, neutrální fokus, signální barvy,
  jedna modrá pro odkazy a oznámení o aktualizaci, písmo Inter Tight a Geist
  Mono, `--control-radius` 6 px a bez zrnitosti. Aktivní záložka přepínače
  (`--sidebar-row-active`, bílá) se liší od jeho dráhy
  (`--sidebar-control-surface`, gray-100).
- **Téma Prostředí (rozhodnutí 0208, 2026-10-18).** Barvy tokenů `--lz-*` jsou
  téma Prostředí, které se vybírá v Apps → Nastavení: výchozí Lazurio (výše)
  nebo vestavěné téma T3 (Grove, Ocean, Ember, Iris) promítnuté Platformou na
  tytéž slíbené názvy. Fork nezná hodnoty, jen názvy, takže jiné téma přijde
  s vydáním Platformy, ne forku. Má-li téma tmavou variantu, shell nastaví i
  tmavé hodnoty týchž názvů pod `.dark` a kořen označí
  `data-lazurio-theme-dark`; pravidla pak platí i v tmavém režimu T3. Téma
  Lazurio je jen světlé, takže v tmavém režimu zůstává tmavá paleta T3.
  Shell deklaruje tokeny design systému na každém svém prvku (`:host`) a ty
  platí i na samotném prvku. Rail patří do scope palety sidebaru, takže by tam
  četl hodnoty design systému místo tématu a zůstal by papírem Lazuria vedle
  sidebaru v jiném tématu, ve světlém i tmavém režimu (Ring 0, 2026-10-19).
  Třetí pravidlo `theme.css` proto railu dědí z dokumentu všechny barvy, které
  téma nastavuje (`shellThemeColors` LazurioPlatform), a kontraktní test to
  hlídá. První
  karta Vzhledu („T3 Code“) tak na Environmentu znamená téma Prostředí a jiný
  motiv, který si člověk vybere, je jeho osobní výjimka v tom prohlížeči.
  Upstream `t3 theme set` se na Environmentu nepoužívá.
- **Co zůstává T3.** Soubor píše jen surové tokeny T3, nikdy `--contrast-*`,
  `--app-theme-*` ani `--lazurio-*`, a žádnou barvu přímo. Nastavení kontrastu
  proto dál funguje, motiv, který si člověk vybere, editor motivů a tmavý
  režim zůstávají paletami T3, písmo zvolené ve Vzhledu vyhraje a barevné
  role shellu se přizpůsobí samy. Stíny, sklo, širší škála zaoblení, velikosti
  písma, ikony a jantarové zvýraznění hledání ve vlákně zůstávají T3.
- **Bez shellu** (samostatný server, vývoj upstreamu, Environment se starší
  Platformou) neplatí nic z toho: T3 vypadá jako upstream, jen se jmenuje
  „T3 Code (Lazurio)“. Hodnoty tokenů patří design systému a mění se vydáním
  Platformy, bez vydání forku. Fork se spoléhá jen na jména, která rozhraní v1
  shellu slibuje; kontraktní test drží 23 jmen, která mapování čte.
- **Pořadí vydání.** Platforma s tokeny jde na Environmenty dřív než vydání
  forku, které je používá (rozhodnutí 0200).

Kontraktní test hlídá import hned za `index.css`, bránu obou pravidel i její
hodnotu, jen surové tokeny, které `index.css` deklaruje ve stejném scope, jen
slíbená jména `--lz-*`, žádnou barvu přímo, písmo, zaoblení a zrnitost
a oddělené tokeny přepínače. Test barevných rolí shellu se nemění.

### Zadání z Launchpadu

**Implementováno (Lazurio/t3code#35).** „+ Nový modul“ v Apps otevře Chat
téhož Environmentu s připraveným zadáním v poli zprávy nového vlákna. Zadání
se nikdy neodešle samo; odešle ho až člověk.

- Launchpad otevře Chat přes párování a za token přidá do fragmentu
  `lazurio-prompt=<id>&lazurio-org=<GitHub login Organizace>`, bez párování
  na holý origin. Odkaz nikdy nenese text. Fragment se neposílá na server ani
  do logu a T3 bez overlaye ho ignoruje.
- `main.tsx` při startu odkaz z adresy odebere (`captureLazurioPromptLink`),
  dřív než ho přečte router nebo párování; token zůstane. Párování od v0.1.0 po
  přihlášení stránku znovu načte (upstream #9785), proto si karta odkaz podrží
  v `sessionStorage`: jen `id` a Organizaci, nikdy text, pod jedním klíčem,
  nejvýš 2 minuty a na jedno převzetí.
- Až je primární environment načtený, `<LazurioPromptDraft />` v layoutu
  `_chat` stáhne text z vlastního originu:
  `GET /.lazurio/prompts/<id>?org=<login>` (brána Environmentu ho za stejným
  přihlášením předá Launchpadu), `credentials: "same-origin"`,
  `redirect: "error"`. Přijme jen JSON `lazurio.prompt.v1` se stejným `id`,
  neprázdným `text` do 16 KiB a absolutním `cwd`.
- Otevře nové vlákno v projektu primárního environmentu s kořenem `cwd`.
  Když takový projekt není, přidá složku jako projekt, jako to dělá „Add
  project“, ale bez zakládání složky. Ve spravovaném Environmentu
  (`T3CODE_LAZURIO_FOLDER`) otevře vlákno vždy v projektu Lazurio a nic
  nepřidává: nová vlákna tam začínají ve složce Lazuria a jiný projekt server
  odmítne. `cwd` zadání Organizace leží uvnitř složky a text Organizaci
  jmenuje. Text vloží do pole zprávy, nic neodešle.
- Neznámé `id`, neúspěšný nebo přesměrovaný fetch, jiný tvar odpovědi nebo
  cizí origin nevloží nic. Člověk uvidí jen chybový toast „Připravené zadání
  se nepodařilo otevřít“, v prohlížeči bez češtiny „Could not open the
  prepared prompt“.
- Kdo zadání dostane, rozhoduje Launchpad. Dnes jediné zadání `new-module`
  dostane jen Environment, jehož GitHub identita je Owner Organizace. Komukoli
  jinému odpoví stejným 404.

Launchpad podává zadání odkazem jen tam, kde to T3 na Environmentu umí: zeptá
se `t3 --version` a odkaz použije od prvního vydání s tímto overlayem
(`0.0.45-lazurio.2`, preview od `0.0.45-preview.20261004.1`). Jinde zadání
zkopíruje do schránky jako dřív.

Overlay se dotýká jen dvou řádků upstream souborů: zachycení v `main.tsx`
a `<LazurioPromptDraft />` v `routes/_chat.tsx`. Oba soubory jsou v
allowlistu, zbytek je ve složce `apps/web/src/lazurio/`. Kontraktní test
hlídá, že zachycení proběhne před vytvořením routeru, že layout komponentu
vykreslí, že text přichází jen z vlastního originu bez přesměrování a že
overlay nemá cestu, jak zprávu odeslat. CI spouští testy overlaye s ostatními
testy toho, co overlay mění.

### Prohlížeč Environmentu

**Rozhodnutí 0191 (plán DEV-6646, Lazurio/t3code#40); záložky vlákna a Nová
karta podle LazurioPlatform F47, krok 4 (úkol 501).** Na Remote Environmentu
běží jeden sdílený Chromium. Upstream od v0.1.0 dává webovému klientovi vlastní
serverový prohlížeč (#15328), na Environmentu Lazuria
(`T3CODE_LAZURIO_FOLDER`) ho ale server nestaví ani neinzeruje a jediným
prohlížečem webového T3 je prohlížeč Environmentu. Overlay proto dává agentům
každého vlákna vlastní okno tohoto prohlížeče (sezení agent-browser vlákna),
nástrojům prohlížeče T3 prohlížeč Environmentu a pravému panelu záložky, které
vlákno drží, každou jako pohled jedné vzdálené záložky. Celou specifikaci, švy
v upstream souborech a to, co z nich hlídá kontraktní test, drží [specifikace
overlaye](./lazurio-overlay.md#prohlížeč-environmentu).

**Historie (F47).** Záložky vlákna a Nová karta přišly v `0.0.45-lazurio.8`;
vydání LazurioPlatform s kroky 1–3 F47 proto šlo na Environmenty s prohlížečem
dřív než toto stable. Na starší Platformě zůstane upstream „+“ a Browser je ve
webu nedostupný.

### Spravovaná složka Lazuria

**LazurioPlatform F51: spravovaný Chat začíná ve složce, doporučený model
vlastní Platforma.** `T3CODE_LAZURIO_FOLDER` určí kanonickou existující složku
Lazuria jako výchozí kontext Chatu. Server při startu, ještě před připraveností,
převezme nebo založí její nativní projekt (`ProjectService.bootstrap`, jméno
Lazurio). Ostatní projekty a konverzace zůstávají jako historie; nová vlákna
začínají v kořeni složky. Hlídají to stráže, dekorátory služeb upstreamu tam,
kde je skládá `orchestration-v2/runtimeLayer.ts` (projekty, příkazy
orchestrace, otevření sezení agenta), takže platí pro každého klienta i MCP.
Scratch (vlákna bez projektu) server na spravovaném Environmentu skrývá, i pro
desktop a mobil. Nejde o sandbox souborového systému.
Spravovaný Environment nemá vlastní uvítání ani průvodce nastavením upstreamu
(rozhodnutí Admina 2026-10-17). První spuštění počká, až živý server ukáže
projekt složky, a pak otevře aplikaci rovnou do nového chatu ve složce;
`/welcome` vede na úvod aplikace. Připojení agenta, GitHubu a obsahu hlídá
upozornění shellu „Dokončit nastavení“, ne T3.

Machines ověří `t3 lazurio capabilities` (kontrakt verze 1) a po zřízení složky
spustí `lazurio chat defaults --apply` Platformy. Doporučení vlastní Platforma.
T3 ho zapíše jako přepis modelu projektu Lazurio
(`projectSettingsOverrides[<projekt složky>].defaultModelSelection`, upstream
„Projects can override it“), ne jako výchozí model T3 (rozhodnutí Admina
2026-10-17). Přepis zapíše jen tehdy, když projekt žádný nemá nebo má ten, který
tam overlay zapsal naposledy; model, který si pro projekt vybral člověk,
zůstává. Co overlay zapsal naposledy a pro který projekt, drží ve vlastním
souboru `~/.t3/userdata/lazurio/model-recommendation.json`, ne v kontraktu
nastavení. `t3 lazurio model --base-dir <home>` čte offline přepis projektu
(`current`) a tento soubor (`lastManaged`), výstup je beze změny; s argumentem
JSON srovnává jen přes běžící službu (`POST /api/lazurio/model-recommendation`,
rozsah `settings:write`). Na Environmentu aktualizovaném z 0.0.45 zůstane
dřívější doporučení výchozím modelem T3 a projekt Lazurio dostane doporučení až
při dalším `lazurio chat defaults --apply`. Kdo si na 0.0.45 vybral vlastní
výchozí model, má ho dál mimo projekt Lazurio; v projektu Lazurio pak platí
doporučení, dokud si tam v nastavení projektu nevybere jiný model (lidem to
oznamte, etapa 8). Model platí jen tam, kde ho poskytovatel nabízí: Codex
0.156.1 GPT-6.1 Sol nenabízí a nové vlákno pak vezme výchozí model
poskytovatele, dokud se Codex neaktualizuje. Offline úprava nastavení nebo
databáze nikdy není náhradní cestou nasazení. T3 a Platformu vydávejte spolu.

Bez proměnné se chování nemění. „Add project“ zmizí z palety příkazů i ze
sidebaru, jen když klient zná aspoň jeden Environment a každý z nich je
spravovaný. Bez jakéhokoli Environmentu zůstává a z palety vede do Settings →
Connections jako v upstreamu. Za stejné podmínky zmizí „Copy prompt link“
u odeslaných zpráv i v paletě (Lazurio/t3code#77, schválená varianta skrýt):
odkaz vede na hostovanou aplikaci upstreamu s textem zadání v adrese a na
spravovaném Environmentu vlákno neotevře. Co dělá odkaz, který přesto přijde,
popisuje [specifikace overlaye](./lazurio-overlay.md#odkazy-na-zadání-upstreamu).

Kód spravované složky žije ve složkách overlaye (`apps/*/src/lazurio/`);
upstream soubory nesou jen háčky o několika řádcích. Kontraktní test je hlídá
(„the managed Lazurio Folder keeps its seams“) a `apps/server/src/lazurio/cli.test.ts`
drží výstup `t3 lazurio capabilities` a `t3 lazurio model` bajt po bajtu.

Při přestavbě na nový upstream zachovejte testy spravovaného startu, nativní
stráže projektů a příkazů, stráže tahů agenta, skrytého Scratch a spravovaného
prvního spuštění; samotný výběr modelu je záměrně mimo fork.

### Přihlášení přes Lazurio

**Rozhodnutí 0201 bod 4 (plán DEV-6665, Lazurio/t3code#46).** Na Environmentu
Lazuria (`T3CODE_LAZURIO_FOLDER`) se Codex a Claude přihlašují oficiálním
přihlášením svých CLI (`codex login`, `claude auth login`), které spouští
stránka Začínáme Launchpadu. Přihlášení se tak uloží tam, kde ho čte T3,
terminál, Codex Desktop přes SSH i všichni agenti. Vlastní „Continue with
ChatGPT“ T3 by vytvořilo přihlášení platné jen pro T3, proto ho overlay na
Environmentu Lazuria nenabízí ani nepovolí:

- **Web.** Kde T3 nabízelo vlastní přihlášení Codexu (pata dialogu „Add
  provider instance“, nastavení Codexu ve spravovaném režimu, dialog dalšího
  účtu ChatGPT a uvítání, pokud je vidět), ukáže odkaz „Open Getting started“
  na `T3CODE_LAZURIO_TOOLS_URL`, česky „Otevřít Začínáme“. Bez proměnné odkaz
  chybí a text řekne, že se přihlašuje v Lazuriu. Instance spravovaného
  Codexu, která je ještě přihlášená k účtu jen pro T3, si v nastavení nechá
  „Disconnect“ („Odpojit“), tedy upstream odhlášení; „Change account“ ani
  „Reconnect“ nenabídne. Jako upstream je neaktivní, když stránka nastavení
  nesmí zapisovat (režim jen pro čtení), instance je vypnutá nebo sezení nemá
  upstream oprávnění k odhlášení (`providers:manage`).
- **Server.** `LazurioProviderSignIn.guard` obalí upstream `ProviderAuthService`
  tam, kde ho upstream skládá (`orchestration-v2/runtimeLayer.ts`):
  pro instanci Codexu odmítne `start` i `importProfile` chybou
  `ProviderSetupError`, takže token platný jen pro T3 nevznikne ani z
  oficiální desktop nebo mobilní aplikace. Odhlášení, zrušení a ostatní
  poskytovatelé zůstávají upstreamu. Instance spravovaného Codexu, která na
  Environmentu už je, se nemaže a jde odpojit; jen se v ní znovu nepřihlásí.
- **`t3 lazurio providers <request-json>`.** Po přihlášení CLI ho spustí
  Launchpad stejného Environmentu jako uživatel Environmentu. Příkaz si vydá
  sezení z úložiště tajemství T3 (jako `t3 lazurio model`), zavolá běžící
  službu cestou `POST /api/lazurio/providers` a sezení zase odvolá. Cesta
  chce rozsahy upstreamu pro obnovu poskytovatelů a pro změnu instancí
  poskytovatelů v nastavení, od v0.1.0 `orchestration:read` a
  `providers:manage`. Požadavek
  `{"providers": ["codex" | "claude", …], "enable"?: true}` jmenuje
  CLI, ne ovladač T3 (`claude` je ovladač `claudeAgent`). S `enable` služba
  nejdřív zapne výchozí instanci každého jmenovaného poskytovatele (u
  explicitní instance oba příznaky `enabled`) atomicky přes zapisovač
  nastavení a nic jiného nemění. Výchozí instance bez záznamu v nastavení je od
  v0.1.0 zapnutá sama (#17300), takže `enable` mění jen instanci, kterou někdo
  vypnul. Projekt, který si poskytovatele vypnul sám (#17879), ho má vypnutý
  dál, i když odpověď říká `enabled: true`. ID instance ovladač neurčuje:
  leží-li na ID výchozí instance (`codex`, `claudeAgent`) instance jiného ovladače, výchozí
  instance toho poskytovatele není. Požadavek s `enable` pak nic nezapne ani
  znovu nenačte a odpoví 409 se seznamem, co kde leží
  (`{"error": "driver-mismatch", "mismatches": [...]}`); příkaz tuto odpověď
  vypíše ve své chybě. Pak u každé zapnuté instance jmenovaných
  poskytovatelů zahodí její mezipaměti (Claude si výsledek své sondy drží
  5 minut) a přečte poskytovatele znovu. Instanci, kterou požadavek právě
  zapnul, registr přestaví a nová instance poskytovatele přečte sama.
  Odpověď `{"version": 1, "providers": [...]}` s položkami `provider`,
  `instanceId`, `enabled`, `status` a `auth` je stav po obnově; hned po zapnutí může
  ještě ukazovat kontrolu (`warning`, `unknown`), další volání bez `enable`
  už výsledek sondy. Neběží-li služba, příkaz skončí chybou a nic nemění.
  Na `t3 lazurio capabilities` je `"providerRefresh": true`.

Bez `T3CODE_LAZURIO_FOLDER` se nic nemění; cesta a příkaz existují, ale dělají
jen to, co klient se stejnými rozsahy může přes WebSocket. Kontraktní test
(„providers sign in through Lazurio, never through T3's own ChatGPT sign-in“)
hlídá stráž v `orchestration-v2/runtimeLayer.ts`, obě stráže
v `CodexSetupSection.tsx` (včetně předání stavu instance kvůli odpojení)
a odkaz v `AddProviderInstanceDialog.tsx`;
`cli.test.ts` drží výstup příkazu bajt po bajtu.

### Párování prohlížeče

**Rozhodnutí Admina 2026-10-17 (řádek 19): Environment páruje svůj prohlížeč
sám.** Nahrazuje pravidlo z 2026-09-21, že přímá návštěva ukáže párovací stránku
T3 a fork zůstává beze změny. Stránka bez platného sezení T3, nebo se sezením
spárovaným na 0.0.45, si řekne vlastnímu originu o údaj
(`GET /.lazurio/chat/pairing`, brána ho předá Launchpadu), Launchpad ho vydá
příkazem `t3 lazurio pairing` s rozsahy operátora (standardní rozsahy upstreamu
bez `relay:write`, tedy i `access:read` a `access:write`) a stránka ho vymění bez
přesměrování. Celou specifikaci, šev a to, co z něj hlídá kontraktní test, drží
[specifikace overlaye](./lazurio-overlay.md#párování-prohlížeče).

Fork se na Platformu nespoléhá: dokud Launchpad na cestě neodpoví přesně
údajem, pokračuje stránka na párovací stránku jako dřív, takže vydání
s řádkem 19 může jít na Environmenty před Platformou i po ní. Platforma pozná
T3, které `t3 lazurio pairing` má, podle `"operatorPairing": true`
v `t3 lazurio capabilities` (kontrakt verze 1).

### Agenti a vlákna

**Rozhodnutí 0210, dodatek 3 (řádky 20 a 21, plán DEV-6676).** Buddy pracuje s vlákny T3
Code jako jeho člověk, a to v každém Environmentu, kam dosáhne: přihlásí se přes SSH a jedná
s přístupy toho Environmentu. Hranicí je celý Environment (rozhodnutí 0172). Kdo smí jako uživatel
Environmentu spustit `t3`, vydá už dnes libovolné sezení příkazem `t3 auth session issue`; agentní
příkazy tedy nepřidávají žádné oprávnění, jen ho dávají agentovi bez ručně vydaného tokenu.

- **Příkazy.** `t3 thread list|read|search|launch|send|interrupt|wait|organize|fork`,
  `t3 request list|read|respond|approve|deny`, `t3 queue list|read|edit|cancel|reorder|promote`
  a `t3 events [--follow]`, v Buddyho T3 Code navíc `t3 lazurio buddy thread`. Upstream má od
  v0.1.2 vlastní `t3 thread list|start|send|show` (#22732) a `t3` se dvěma skupinami stejného
  jména nespustí, proto je skupina jedna: příkazy overlaye a ostatní upstreamu (`start`, `show`),
  na střetu jmen (`list`, `send`) slouží overlay. `send` bez `--mode` řadí do fronty jako
  upstream a nic nepřeruší, zprávu čte i ze standardního vstupu (`-` vedle `--message-file -`)
  a `--wait` počká na běh odeslání a vypíše odpověď. S `--json` každý vypíše výsledek, nebo
  `{"error": {"code", "message"}}`. Návratový kód 0 je hotovo, 1 odmítnutí, chybný příkaz nebo
  neúspěšný běh, 2 vlákno čeká na odpověď (`send --wait`), 3 neběžící T3 (nic se nečetlo ani
  nezměnilo) a 4 vypršené `t3 thread wait`. Uživatelský návod je
  [docs/user/agent-cli.md](../user/agent-cli.md).
- **Sezení.** Příkaz najde běžící server podle stavu běhu v T3 home (`--base-dir`), z jeho úložiště
  tajemství si vydá krátká sezení (10 minut; sledování událostí hodinu a pak nové), drží je jen
  v paměti a na konci je odvolá. Nic nového se neukládá. Na `/mcp` je klientem MCP se stropem
  full-access, tedy nejvíc, co smí schválený agent mít: stejné nástroje, kontroly i chyby jako
  u každého agenta. Plochu člověka používá s rozsahy `orchestration:read` a
  `orchestration:operate` jen na to, co žádný nástroj MCP nedělá: na seznam vláken s jejich
  čekajícími žádostmi, na rozhodnutí žádosti o oprávnění (stejný příkaz jako tlačítko
  v aplikaci) a na živý stream seznamu vláken. Klientem MCP je upstreamový `mcpToolSession`
  a sezení vydává vlastní `issueSession` se štítkem `t3 agent cli`, nikdy sezení klienta MCP
  upstreamu (`t3 thread cli`), jinak by klíče odeslání níže ztratily společný prostor. Rozhodování o oprávněních upstream na MCP
  záměrně nedává a fork ho tam nepřidává.
- **Jednou na klíč.** `t3 thread send --idempotency-key <klíč>` pošle zprávu jednou na klíč, i když
  příkaz poběží znovu nebo po restartu T3: opakování nic nepošle a vypíše výsledek prvního
  odeslání. Zpráva jde přes `/mcp` nástrojem `t3_thread_send`, takže ji T3 zapíše jako od agenta
  (`createdBy: "agent"`, `creationSource: "mcp"`), nikdy jako krok člověka. T3 odvodí id příkazu
  z `clientRequestId` a z jmenného prostoru klienta MCP a potvrzenka příkazu ho provede jednou.
  Sezení agentních příkazů (štítek `t3 agent cli`) proto sdílejí jeden jmenný prostor
  (`agentCliRequests.ts`, šev v `server.ts`), ostatní klienti MCP mají prostor svého sezení.
  V tom prostoru příkaz místo holého klíče předá otisk SHA-256 klíče s vláknem a s tím, kdo posílá
  (`T3CODE_ACTING_SENDER` a `T3CODE_ACTING_FOR` stopy „Buddy za …“, u příkazů člověka prázdné):
  stejný klíč do jiného vlákna nebo od jiného odesílatele je jiná zpráva, ne výsledek té první.
  Po odeslání s klíčem se příkaz cestou overlaye `POST /api/lazurio/agent-cli/send-state`
  (`agentCliSendState.ts`, rozsah `orchestration:read`) zeptá, co T3 zapsal: potvrzenku příkazu
  a zprávu, kterou udělal. Opakování doručeného klíče vypíše úspěch s původním `commandId`, i když
  T3 výsledek přehrát nemůže, protože je vlákno mezitím archivované (`"delivery": "delivered"`).
  Klíč, který už poslal jinou zprávu, skončí kódem `idempotency_conflict` a nic nepošle; text
  porovnává po oříznutí, jak ho ořízne nástroj T3 (`OrchestratorMcpPrompt`). Klíč, jehož příkaz T3
  odmítl, skončí kódem `command_rejected`, protože odmítnutá potvrzenka platí navždy.
  Konečné kódy a ty, po kterých má smysl poslat znovu, vypisuje `docs/user/agent-cli.md`; T3 bez
  této cesty dál jen posílá. Ve stejném prostoru jsou i nahrané přílohy, takže jeden agentní
  příkaz připojí, co nahrál jiný; všechny jednají za vlastníka Environmentu. Delegace budí takto:

  ```sh
  T3CODE_ACTING_SENDER=delegace t3 thread send <vlákno> --mode queue \
    --idempotency-key <klíč buzení> --message-file - --base-dir ~/.t3-buddy --json
  ```

  Probuzení se ve vlákně neukáže, uživatel vidí jen Buddyho odpověď na něj (řádek 27).

- **Nové vlákno.** `t3 thread launch` bez `--project` začne v projektu Lazurio, který si zapsal
  spravovaný start (`lazurio/model-recommendation.json`). Přepínač modelu ani režimu nemá
  (rozhodnutí 0189): T3 dá vláknu, které spustí volající mimo vlákno, model i režim, se kterými
  v jeho projektu začne nové vlákno ve webu (#22732, `resolveProjectSettings` nad nastavením
  Environmentu a záznamem projektu), tedy přepis projektu (u projektu Lazurio i doporučený model
  Platformy, řádek 15), jinak výchozí model a režim Environmentu; výchozí režim T3 je full-access
  (Lazurio/t3code#94). Kde model není nikde, T3 spuštění odmítne (`invalid_request`, kód 1). Se
  `--scratch` model vybere T3, protože projekt Scratch určí až spuštění; Environment Lazuria
  Scratch nenabízí.
- **Token MCP bez přihlášení.** `t3 auth session issue --subject mcp-client
  --runtime-mode-ceiling <režim>` (řádek 20). Bez přepínače zůstává strop Supervised.

Platforma, Machines i Buddy poznají T3, které příkazy má, podle `"agentCli": true` v
`t3 lazurio capabilities` (kontrakt verze 1), klíč odeslání podle `"threadSendIdempotency": true`,
konečné kódy a `commandId` odeslání podle `"threadSendOutcome": true`
a `t3 lazurio buddy thread` podle `"buddyThread": true`. Bez proměnných Lazuria příkazy fungují stejně, jen
`t3 thread launch` chce `--project`. Kontraktní test („agents work with threads through the agent
CLI's seams“) hlídá švy v `binCli.ts` (i jedinou skupinu `thread`), exporty `waitForRun`
a `runResultText` v `cli/thread.ts`, výchozí `queue`, štítek sezení, přepínač v `cli/auth.ts`,
strop v `EnvironmentAuth.ts`, export v `OrchestratorMcpService.ts` a rozsahy obou sezení; `agentCli.test.ts` spouští skutečné
CLI proti skutečnému `/mcp` s kontrolami přístupu T3.

### Nástroj na otázky

**Rozhodnutí 0211 (řádek 22, plán DEV-6676).** Agent se člověka ptá nástrojem svého harnessu na
otázky, ne jen textem ve zprávě: otázka v textu zapadne a vlákno vypadá, že pracuje, a přitom stojí.
T3 otázku nástroje ukáže ve vlákně s volbami a drží ji, dokud člověk neodpoví. Claude Code nabízí
`AskUserQuestion` ve všech režimech T3 sám, proto overlay mění jen Codex.

- **Funkce Codexu.** Codex nabízí `request_user_input` v režimu Plan vždy, v režimu Default jen se
  zapnutou funkcí `default_mode_request_user_input`. Má ji od verze 0.106.0, stejně ve vývoji
  a ve výchozím stavu vypnutou v 0.156.1, 0.163.0 i 0.164.0-alpha.7. Každý `codex app-server`, který
  T3 spouští pro svá vlákna, dostane `-c features.default_mode_request_user_input=true` před
  podpříkazem. Uživatelův `~/.codex/config.toml` se nemění (rozhodnutí 0161); sonda poskytovatele
  a generování textu (`codex exec`) přepínač nedostávají. Spouštěcí argumenty z nastavení
  poskytovatele nebo z `T3CODE_CODEX_LAUNCH_ARGS` jdou za ním, takže v nich
  `--disable default_mode_request_user_input` nebo `-c features.default_mode_request_user_input=false`
  funkci vypne bez vydání. Overlay používá `-c`, ne `--enable`: Codex, který klíč nezná, jen varuje
  (s `--strict-config` ve spouštěcích argumentech start odmítne), kdežto `--enable` neznámou funkci
  odmítne vždy.
- **Pokyn agentovi.** Kontext T3 v tahu (`turn/start.additionalContext`, posílá ho s každým tahem,
  ke kterému připojí svůj server MCP, tedy v provozu s každým) má položku `lazurio_questions`.
  Codex ji pošle modelu znovu, jen když se změní, a T3 ji po kompakci vrátí. Hodnotu položky
  delší než 4 000 bajtů Codex potichu zkrátí uprostřed, proto upstream od v0.1.1 dělí svůj
  kontext do číslovaných položek `t3_code_orchestration_NN` a jeho test měří každou položku
  (#18415). `lazurio_questions` má asi 1,1 KB a je poslední položkou.
  Říká, že se agent ptá nástrojem, kdykoli potřebuje odpověď nebo rozhodnutí člověka, i když bez
  odpovědi nejde bezpečně pokračovat. Nejdřív udělá, co na odpovědi nezávisí, a neptá se na nic, co
  zjistí sám. U rozhodnutí, které patří jen člověku, jako je Publikace (merge, odeslání, nasazení),
  žádnou volbu neoznačí jako doporučenou a nerozhodne za něj, ani když se otázka vrátí bez odpovědi.
  Bez nástroje se zeptá ve zprávě s očíslovanými volbami a napíše, že čeká. Pokyn je v kontextu tahu,
  ne v textu režimu: modelům, jejichž katalog má vlastní text režimu (GPT-6), Codex text režimu od T3
  nepošle, a jejich text drží nástroj jen pro volitelné otázky. Z textu režimu Default od T3 (pro
  modely bez vlastního textu) overlay odebral větu, ať se agent ptá prostým textem a nikdy nepíše
  otázku s volbami do zprávy. Text režimu Plan zůstává upstreamu.
- **Otázka čeká na člověka.** V režimu Default posílá Codex otázku jako neblokující
  (`isBlocking: false`) a jeho vlastní TUI ji po dvou minutách zodpoví prázdně. T3 `isBlocking` ani
  `autoResolutionMs` nečte, takže otázka čeká, dokud člověk neodpoví nebo tah nezastaví, a odpověď
  dostane Codex jako výsledek nástroje. Zavřít bez odpovědi jde v T3 jen asynchronní otázka, tato ne
  (upstream).
- **Kde nástroj chybí.** Podagentům Codexu ho Codex nedává („can only be used by the root thread“);
  jejich výstup dostane rodičovský agent. Otázku vlákna delegovaného úkolu T3 předá rodiči jako
  upstream (`DelegatedTaskQuestionReactor`).

Kontraktní test („agents ask people through the question tool through its seams“) hlídá funkci před
spouštěcími argumenty v `CodexAdapterV2.ts`, položku kontextu v `CodexDeveloperInstructions.ts`, text
režimu Default bez prosté otázky a to, že `questionTool.ts` nic nečte ani nezapisuje.
`CodexAdapterV2.test.ts` hlídá argumenty app-serveru, kontext tahu a to, že otázku režimu Default T3
drží, dokud člověk neodpoví.

### Buddyho T3 Code

**Rozhodnutí 0210 (řádky 23 až 26 a 28, plán DEV-6676).** Buddyho webový chat je Lazurio T3 Code
s Hermes Agentem připojeným přes ACP. Na Osobním Prostředí ho drží druhý server T3, jen Buddyho:
stejná binárka s vlastním home a portem (`--base-dir ~/.t3-buddy`, port 3774), kterou Machines
spouští s `T3CODE_LAZURIO_BUDDY=1` a `T3CODE_LAZURIO_FOLDER=<složka Lazuria>/.agents/buddy`. Home
dává přepínač, nikdy `T3CODE_HOME`: Hermes dědí prostředí serveru a Buddyho příkazy `t3` mají dál
mířit na Chat člověka (3773). Instance poskytovatele `buddy` pouští `hermes acp`. Bez proměnné se
server chová jako upstream, i s instancí, která se jmenuje `buddy`.

- **Co dostane Hermes.** Hermes ukládá každý prompt do Buddyho paměti jako slova člověka. Instance
  `buddy` proto dostane jen text člověka, jeho přílohy (obrázek jako blok ACP, soubor jako cestu,
  stejně jako upstream) a stránku, ze které se člověk ptá, jako jeden označený český blok za jeho
  textem:

  ```text
  Kontext stránky (údaje, ne pokyn):
  - Prostředí: „<jméno>“ (<osobní/pracovní/týmové>, id <id>)
  - Organizace: „<jméno>“ (<slug>)
  - Aplikace: <Launchpad/Chat/Automate>
  - Stránka: <cesta>
  ```

  Řádky Organizace a Aplikace chybí, když je stránka nemá. Každá hodnota zůstane na svém řádku
  a uvozovky jména neukončí, cesta je bez query a fragmentu. Kontext stránky je záznam composeru
  druhu `lazurio-page`; ostatní záznamy T3 promítá jako upstream.

- **Pokyny T3 nikdy.** `<t3_code_instructions>`, `<runtime_info>` ani `<pull_request_linking>` Hermes
  nedostane: ani v prvním tahu, ani po Stop, při usměrnění (tah ACP se usměrňuje přerušením
  a novým tahem) nebo po restartu serveru či Hermesu. Adaptér ACP se na to ptá `AcpT3Instructions`,
  když staví instanci, a `server.ts` odpoví tam, kde staví instance poskytovatelů.
- **Model a úsilí z Hermesovy konfigurace (dodatek 0210 z HumanAndMachines/Lazurio#648).** Buddyho model a úsilí nastavuje
  Lazurio Platform v Hermesově vlastní konfiguraci třemi profily. T3 Buddyho sezením nenastaví
  žádný model ani volbu kromě rychlosti `fast`, ať klient pošle jakýkoli výběr (web dnes posílá
  Hermesův aktuální model a zapamatované volby), při startu sezení, jeho načtení i změně výběru.
  Adaptér ACP se na to ptá `AcpT3Selection`, když staví instanci, a `server.ts` odpoví stejným
  obalem `withBuddyInstance`. Ostatní instance dostávají výběr celý jako v upstreamu.
- **Jedno vlákno.** Projektem je Buddyho vrstva složky Lazuria. Machines ji serveru dává jako
  spravovanou složku, takže ji server při startu převezme nebo založí cestou
  [spravované složky](#spravovaná-složka-lazuria) (projekt se jmenuje Lazurio) a platí v ní její
  stráže. Bez `T3CODE_LAZURIO_FOLDER` je Buddyho projektem ten s kořenem `~/Lazurio/.agents/buddy`.
  V projektu je jedno vlákno `buddy` instance `buddy` ve full-access.
  `POST /api/lazurio/buddy/thread` ho najde, nebo napoprvé založí pevným příkazem, takže dvě
  první návštěvy naráz založí jedno. Archivované vlákno vrátí zpět, protože nové by pustilo Hermes
  na nové sezení a rozdvojilo Buddyho paměť. Vlákno s id `buddy` v jiném projektu nebo na jiné
  instanci Buddyho není: cesta ho nechá, jak je, nic přes ně nezaloží a odpoví 409
  `thread-conflict`, aby buzení nikdy nepřistálo v cizím rozhovoru. Mimo Buddyho T3 Code odpoví
  404, bez Buddyho projektu 409. Web se ptá jí při otevření a Delegace přes
  `t3 lazurio buddy thread --json`.
- **Jeden rozhovor pro každého klienta.** Server Buddyho T3 Code odmítne větvení vlákna, návrat ke
  checkpointu, každé jiné vlákno než Buddyho a smazání Buddyho vlákna, ať přijdou z webu, desktopu,
  mobilu, MCP, CLI nebo plánované úlohy: větev i návrat by pustily Hermes na nové sezení
  a rozdvojily Buddyho paměť. Buddyho vlákno udělá jen cesta vlákna (`MakingBuddysThread`), nikdy
  `thread.create` klienta, ani s Buddyho id: utratil by její pevný příkaz za vlákno podle sebe.
  Archivace zůstává a cesta vlákna ho vrátí. Sdílení vlákna s hostem (upstream od v0.1.3)
  server odmítne a web na povrchu jeho dialog nekreslí: Buddyho rozhovor patří do Personalspace,
  který se nesdílí (rozhodnutí 0091). V Buddyho projektu server
  nedělá checkpointy, i když vrstva leží v repozitáři Gitu: návrat, kterému by sloužily, Buddy
  nenabízí.
- **Výchozí nastavení.** Při prvním startu server jednou vypne pokračování vláken po aktualizaci
  (jeho „Continue where you left off.“ by byla slova T3 v Buddyho paměti), prohlížeč agenta
  a instance Codex a Claude. Udělá to před obnovou, která pokračování čte, a záznam
  `lazurio/buddy-surface.json` ve stavové složce zajistí, že pozdější volbu člověka nepřepíše. Když
  nastavení zapsat nejde, server naběhne jako upstream a zkusí to při dalším startu.
- **Povrch.** Web Buddyho T3 Code (klíč `lazurioBuddy` v konfiguraci serveru) ukáže místo sidebaru
  a palety příkazů Buddyho povrch: hlavičku s Mattyčusem (`/assets/avatar.webp`, obrázek
  `mattycus-idle` z design systému, viz `apps/web/src/lazurio/brand/README.md`), vlevo dny
  rozhovoru, kde je místo (od šířky 640 px), a v rozhovoru čáru s datem nad první zprávou každého
  dne. Den v panelu přeskočí na svou první zprávu, i když ji musí nejdřív načíst ze starší
  historie. Dny i skok platí jen pro časovou osu Buddyho Prostředí; časová osa jiného Prostředí
  nebo mimo Buddyho T3 Code je nečte. `/` otevře Buddyho vlákno. Seznam vláken, nové vlákno, větvení, návrat, hlavička vlákna
  T3, podrobnosti vlákna (editor, skripty projektu, větev) ani průvodce prvním spuštěním na povrchu
  nejsou a zkratky nového vlákna a náhledu, které T3 instaluje při startu aplikace, tam nereagují. Zpráva poslaná za běhu tahu ho usměrní;
  frontu člověk volí výslovně opačnou volbou tlačítka odeslání (Ctrl/⌘-klik), jako v upstreamu.
- **Rám bubliny.** V bublině shellu (rám se sandboxem bubliny) mluví povrch s hostitelem protokolem
  `lazurio.buddy.*` verze 1 z LazurioPlatform: pošle `ready`, od rodiče přijme jen platný kontext
  stránky z originu hostitele (`launchpad`, `t3code` nebo `mausbot` pod základem Prostředí)
  a o velikost okna žádá zprávou `layout`. Tlačítka hlavičky žádají celou obrazovku, panel
  a zavření. Esc bez modifikátoru požádá o panel pokaždé, když je v povrchu zavřený každý dialog,
  nabídka i seznam a klávesu nezastavilo nic uvnitř, jako ji zastaví nabídky composeru. Editor
  composeru označí každý Esc za obsloužený, proto obsloužená klávesa sama nestačí. Platí to i na
  celé obrazovce úzkého okna: rozložení povrch nikdy neodvozuje ze šířky. Mimo
  rám hostitele nebo mimo Buddyho T3 Code s nikým nemluví.
- **Vzhled hostitele (požadavek z 2026-10-25).** Povrch v bublině nosí vzhled stránky hostitele,
  světlý nebo tmavý (`theme` kontextu), od prvního kontextu a při každé jeho změně. Požádá o něj
  T3 přes jeho vlastní předvolbu vzhledu, kterou čte celá aplikace, a řídí se tím, jaký vzhled T3
  potom vyřeší, ne tím, že se předvolba uložila. Kde T3 vzhled hostitele vyřešit nemůže (prohlížeč
  rámu blokuje úložiště, nebo uložený motiv takový vzhled nemá a T3 drží jeho vlastní), nosí
  dokument standardní paletu T3 ve vzhledu hostitele, dokud to T3 zase nedokáže, i když T3 svůj
  uložený motiv znovu použije; vykreslení, která
  čtou předvolbu (bloky kódu, terminál), tam zůstanou ve vzhledu T3. Mimo rám platí vzhled, který
  si člověk v T3 nastavil.
- **Stránka u zprávy (řádek 26).** Poslední platný kontext stránky ukáže povrch nad composerem jako
  čip (například „Apps /apps“) s tlačítkem, které ho odebere. Dokud tam čip je, nese zpráva, kterou
  člověk napíše, stránku jako záznam composeru `lazurio-page` s odkazem v textu a Hermes ji dostane
  jako český blok výše. Prázdná zpráva ho nenese. Odebraný čip platí pro tu stránku; jiná stránka
  hostitele ukáže čip znovu. V odeslané zprávě stojí stejný čip, ne upstreamový „nedostupný
  kontext“.
- **Rozhovor jako s kamarádem (řádek 28).** Rozhodnutí 0210, dodatek z 2026-10-22, bod 1: člověk
  vidí a slyší jen to, co Buddy napíše lidskými slovy. Rozhovor ukazuje zprávy a to, na co člověk
  odpovídá (žádost o tajemství, odpovědi na Buddyho otázky), nikdy záznam práce T3: volání nástrojů,
  příkazy, úpravy souborů, uvažování, „Worked for“, přerušení ani zhuštění kontextu. Za běhu tahu
  a po něm, dokud ještě běží práce, kterou Buddy spustil (příkaz, subagent, sledování), stojí na
  konci jeden tichý řádek „Buddy na tom pracuje…“ (anglicky „Buddy is on it…“) bez rozbalení,
  časovače a animace, ne když Buddy čeká na člověka. Po tahu zůstane Buddyho poslední zpráva.
  Nepovedený tah ukáže jeden řádek „Tohle se Buddymu nepovedlo dokončit. Zkuste to prosím znovu.“
  místo chyby T3; chyba se neztratí. Na konci časové osy nestojí nic z práce: práce na pozadí
  s titulkem, odkazem na subagenta a Stop, cíl ani otázka podvlákna. Fronta tamtéž drží a počítá
  jen zprávy člověka; zprávu, kterou do fronty dal agent, například probuzení od Delegace,
  neukáže, a až poběží, ukáže ji vlákno podle řádku 27. V poli zprávy stojí „Napište Buddymu…“
  („Message Buddy…“); jazyk určuje `lang` stránky hostitele. Klávesy terminálu a pravého panelu
  včetně projektových skriptů a Mod+Shift+T povrch nechá prohlížeči (Lazurio/t3code#109). Banner
  chyby vlákna nad rozhovorem místo zprávy T3 (například „Provider turn failed.“) říká „Něco se
  nepovedlo. Zkuste to prosím znovu.“
- **Prostý rozhovor (řádek 28).** Rozhodnutí 0210, dodatek HumanAndMachines/Lazurio#648: Buddyho chat nenabízí
  model, úsilí uvažování, přístup T3 („Full access“) ani režim (režim interakce T3, režim sezení
  Hermesu „Default“). Buddyho model a úsilí nastavuje Lazurio Platform v Hermesově vlastní
  konfiguraci třemi profily a chat je nikdy nepřepisuje. Jedinou volbou pod composerem je přepínač
  Normální / Rychlý (anglicky „Normal“ / „Fast“), navázaný na volbu sezení ACP `fast` Hermesu
  s hodnotami `normal` a `fast`, a jen když ji Hermes nabízí; jinak pod composerem není nic.
  Lazurio Hermes ji od `v0.22.4-lazurio.3` nabízí jako jedinou volbu sezení, bez kategorie a jen
  na trasách s rychlým režimem.
  Rychlý režim Hermesu odpovídá dřív a čerpá víc z předplatného. Přepínač ukáže rychlost, kterou
  člověk zvolil, jinak rychlost Hermesova sezení; volba je volbou composeru pro Hermesův model
  jako volby T3, takže ji ponese další zpráva. Klávesy výběru modelu (Mod+Shift+M), úsilí
  (Mod+Shift+E a kroky úsilí) a režimu (Mod+Shift+A) povrch nechá prohlížeči. Buddy pracuje vždy
  ve full-access: web Buddyho vláknu jiný režim nepošle, ani když ho návrh composeru pamatuje,
  server změnu na jiný režim odmítne („Buddy always works with full access“) a vlákno, které nižší
  režim drží z doby před stráží, vrátí na full-access cesta vlákna, kterou se ptá web i Delegace.
- **Jen rozhovor (řádek 28).** Rozhodnutí 0210, dodatek HumanAndMachines/Lazurio#648: Buddyho
  chat je jen rozhovor, a tak povrch terminál ani pravý panel T3 neukáže, ať vlákno drží cokoli.
  Terminál pod rozhovorem nekreslí, ani když ho vlákno má otevřený z dřívějška (v T3 před Buddyho
  povrchem nebo z akce, která ho otevřela), a čte ho jako zavřený, takže composer má fokus jako
  bez něj. Blok kódu v Buddyho odpovědi nemá „Run in terminal“. Pravý panel čte jako zavřený, takže
  ho neotevře uložený stav vlákna, odkaz v rozhovoru ani agent, který ukáže stránku, a záložky
  vlákna z prohlížeče Environmentu nesleduje. Odkaz v rozhovoru otevře novou záložku prohlížeče bez
  openeru a refereru (`_blank`, `noopener noreferrer`), nikdy náhled ani pravý panel;
  s modifikátorem ho prohlížeč otevře jako jakýkoli odkaz. Povrch nic nezavírá ani nezastavuje: uložený stav zůstává
  a terminál, který vlákno má z dřívějška, běží na serveru dál, dokud neskončí jeho shell, nezavře
  ho klient, který terminály ukazuje, nebo se server nezastaví. Dřív povrch terminál pod rozhovorem
  kreslil a tím se k němu připojil, takže tam, kde žádný shell neběžel, nový spustil.
- **Co zůstává upstreamu.** Když se Hermesovo sezení nenačte (`session/load`), T3 začne nové se
  shrnutím vlákna. To je obnova kontextu, ne pokyn, a řádek ji nemění.

Kontraktní testy hlídají švy: „Buddy's Hermes gets only the person's words through its seams“
obě otázky adaptéru, jeho jediné místo skládání promptu i nastavení výběru, odpověď
v `server.ts` a projekci v `ProviderTurnStartService.ts`, „Buddy keeps one conversation through its seams“ stráže, fázi
startu před obnovou a háčky webu a „Buddy's chat reads like a chat with a friend through its
seams“ švy řádku 28. `buddyPrompt.orchestrator.test.ts` pouští produkční runtime V2 s mock agentem
ACP na místě Hermesu a čte, co agent dostal; `buddySurfaceGuards.test.ts` pouští stráž přes
orchestrátor serveru, `buddySurfaceTimeline.browser.test.tsx` skutečnou časovou osu v Buddyho
povrchu i s odkazy, `buddySurfaceTerminal.browser.test.tsx` skutečné kreslení terminálu T3 pod
rozhovorem, jen s náhradou za jeho emulátor, a `buddySurfaceRightPanel.browser.test.tsx` skutečný
pravý panel T3.

### Kdo jednal: Buddy a Delegace

**Rozhodnutí 0210, večerní dodatek, bod 5 (řádek 27, plán DEV-6676).** Co Buddy napíše nebo
schválí ve vlákně, nese viditelnou značku „Buddy za <jméno uživatele>“ (anglicky „Buddy for
<jméno>“). Probuzení od Delegace v Buddyho vlastním vlákně se ve vlákně neukáže, uživatel vidí jen
Buddyho odpověď (rozhodnuto 2026-10-22). Podrobnosti chování drží
[specifikace overlaye](./lazurio-overlay.md#kdo-jednal-buddy-a-delegace).

- **Rozhraní.** Agentní příkazy čtou z prostředí `T3CODE_ACTING_SENDER=buddy` s
  `T3CODE_ACTING_FOR=<jméno>` a volitelně `T3CODE_ACTING_FOR_ACCUSATIVE=<tvar po „za“>`, nebo
  `T3CODE_ACTING_SENDER=delegace` bez jmen, a obě svá sezení vydají s podepsaným tvrzením.
  Jiná hodnota skončí `invalid_request` (kód 1) dřív, než se cokoli přečte. Přepínač
  `t3 thread send` ani volný štítek odesílatele neexistuje. `t3 lazurio capabilities` uvádí
  `"actingSender": true`.
- **Záznam.** Server zapíše zprávy (`t3 thread launch`, `send`) a rozhodnutí otázek a žádostí o
  oprávnění (`t3 request respond`, `approve`, `deny`), které sezení s tvrzením poslalo, do
  `<state dir>/lazurio/acting-senders/` a web je čte cestou `/api/lazurio/acting-senders`.
  Zapíše je jen dispatch, který krok sám commitnul: znovu poslané command id (třeba stejný
  `--idempotency-key`) značku nepřidá, nezmění ani nezapíše podruhé. Při přestavbě to na
  orchestrátoru upstreamu hlídá `actingSendersReplay.test.ts`.
- **Kdo proměnné nastavuje.** Prostředí Buddyho (proměnné instance poskytovatele Buddyho v jeho
  T3 a služba brány Hermesu) a služba Delegace, nikdy služba T3 sama: agenti vláken, které T3
  spouští, by je zdědili.

Kontraktní test („Buddy's and Delegace's steps carry who took them through their seams“) hlídá
tvrzení v `SessionStore.ts` a `EnvironmentAuth.ts`, přenos v `McpOAuth.ts` a
`McpInvocationContext.ts`, volání v `ws.ts`, obalení v `runtimeLayer.ts`, cestu v `overlay.ts`
a tři švy webu: řádky vlákna v `MessagesTimeline.tsx`, popisek složené zprávy agenta
v `TimelineUserMessageRow.tsx` a značku u žádosti v `TimelineWorkEntryRow.tsx`.

## Kdy vydávat

- **Nový upstream stable** (`pingdotgg/t3code` vydal `vX.Y.Z`): přestavte
  overlay na nový tag a vydejte `X.Y.Z-lazurio.1` postupem
  [Nové stabilní vydání upstreamu](#nové-stabilní-vydání-upstreamu).
- **Vlastní oprava nebo změna overlaye** na stejné bázi: po merge do `main`
  vydejte další `-lazurio.N`.
- **Canary před stable:** z téže špičky `main` nejdřív vydejte preview
  `X.Y.Z-preview.YYYYMMDD.N`, nainstalujte ho na canary Environmenty
  ([Ring 0](#ring-0-lazurioexampleorganization)) a teprve po jejich ověření
  vydejte stable. Oprava během canary je nový commit na `main` a další
  preview `.N+1`.
- Nevydávejte nightly a nevydávejte z jiné branche než `main`.
- PR do `main` se mergují jen rebase, bez merge commitu. Release i CI odmítnou
  merge commit nad upstream tagem. Main ruleset 21717536 to vynucuje:
  povoluje jen `rebase` a vyžaduje lineární historii. Readback:
  `gh api repos/Lazurio/t3code/rulesets/21717536 --jq '[.rules[] | select(.type == "pull_request") | .parameters.allowed_merge_methods], [.rules[].type]'`
  vrátí `[["rebase"]]` a mezi typy `required_linear_history`.

## Ring 0: LazurioExampleOrganization

Canary Environmenty tohoto runbooku jsou Environmenty veřejné referenční
Organizace `LazurioExampleOrganization` (GitHub id 325048785, fiktivní data,
bez tailnetu). Každé preview i stable na ně jde jako první. Určuje to root
rozhodnutí 0204 bod 7
([HumanAndMachines/Lazurio `manual/decision-register.md`](https://github.com/HumanAndMachines/Lazurio/blob/main/manual/decision-register.md),
řádek 0204).

- **Bez souhlasu a okna.** Instalace preview, Update, restarty, reinstalace
  i nová nasazení jejích Environmentů nepotřebují souhlas lidí, kteří je
  používají, ani okno. Agent je provede jako součást vydání na pokyn svého
  Operátora, který má v této Organizaci živou roli Admin, a v jeho právech;
  vlastní pravomoc tím nezíská.
- **Zůstává:** pokyn Operátora, review zdrojů, brány Machines při posunu
  pinu, schválení vydání v GitHub environmentu ([Schválení](#schválení)),
  žádná tajemství v Gitu a vlastní souhlas každé jiné Organizace.
- **Další vlna**, tedy osobní Environmenty a Environmenty ostatních
  Organizací, přijde až po akceptaci v prohlížeči na Environmentech této
  Organizace (root rozhodnutí 0178): Chat se otevře, spárování funguje a,
  jakmile tam je AI, projde neškodný agentní turn.
- **Environmenty pro návštěvníky** (`try-*`) se vracejí do stavu posledního
  reviewovaného nasazení, takže se na nich databáze před `t3 update`
  nezálohuje.
- **Mimo Ring 0** zůstává vstup přes tailnet, který tato Organizace nemá;
  ověří ho až další vlna.

## Nové stabilní vydání upstreamu

Když `pingdotgg/t3code` vydá nové stabilní vydání `vX.Y.Z`, overlay se na
něm přestaví a vyjde `X.Y.Z-lazurio.1`. `main` je rolling patch-stack: starý
`main` se neslučuje ani nepřehrává hromadně. Overlay se přehraje na přesném
tagu jako jeden commit na řádek tabulky [Overlay](#overlay) a hotový
candidate nahradí `main` výměnou.

Postup vede vlastník vydávání (Steward). Organization Admin schvaluje
rozhodnutí, která mění chování nebo kontrakt s Lazuriem, vyměňuje `main`
a schvaluje vydání. Přestavbu může za Stewarda udělat Task Agent podle
[zadání](#zadání-pro-task-agenta) níž: bez mandátu etapy 2–5, s mandátem celou
včetně výměny `main`, vydání a jeho schválení, vždy jen na přesná SHA a verzi,
které sám ověřil. Stav a rozhodnutí přestavby drží jedno
issue v tomto repozitáři s názvem `Přestavba na upstream T3 Code vX.Y.Z`
([šablona](#issue-přestavby)); runbook drží postup.

Přestavuje se jen na stable tagu. Nightly ani preview buildy upstreamu
(`vX.Y.Z-nightly.…`, `vX.Y.Z-preview.…`) ji nespouštějí: workflow vydání
přijme jen upstream tag tvaru `vX.Y.Z` a oficiální desktop a mobilní
aplikace jsou stable vydání, takže server z nightly může mluvit protokolem,
kterému ještě nerozumějí.

Náhled na canary jde až po výměně `main`, protože workflow vydání vydává
jen špičku `main`. Environmenty se tím nepohnou: výměna sama nic nevydá,
preview se nikdy nenabízí a stable vyjde až po canary.

### 1. Sledování

Workflow `Lazurio upstream watch`
(`.github/workflows/lazurio-upstream-watch.yml`) běží každý den kolem 5:41
UTC. Porovná nejnovější stabilní vydání upstreamu (bez draftů a pre-release,
tag tvaru `vX.Y.Z`) s `UPSTREAM_TAG` v `lazurio-fork-ci.yml` na `main`. Když
je upstream novější a:

- žádné issue s názvem začínajícím „Přestavba na upstream T3 Code“ není
  otevřené, založí issue přestavby `Přestavba na upstream T3 Code vX.Y.Z`
  ze [šablony](#issue-přestavby);
- takové issue otevřené je, napíše do něj jednou za každý nový tag komentář
  s tagem a jeho commitem.

Nic jiného nedělá (viz [Hranice automatizace](#hranice-automatizace)). Odběr
všech vydání upstreamu na GitHubu by ho nenahradil: upstream vydává několik
nightly denně a stable se mezi nimi ztratí.

Issue převezme Steward, který sleduje issues tohoto repozitáře (Watch →
Custom → Issues). Začněte hned: oficiální desktop a mobilní aplikace se na
nové vydání brzy aktualizují, a když nové vydání mění orchestrační protokol,
k serverům forku na staré bázi se nepřipojí (viz
[Desktop a mobil](#desktop-a-mobil-proti-serveru-z-forku)). Když upstream
během přestavby vydá další stable, watch to připíše do téhož issue:
přestavujte rovnou na nejnovější a issue přejmenujte. Stejně přejmenujte issue,
které vzniklo dopředu na verzi, jež nevyšla, a inventuru udělejte znovu proti
skutečnému tagu: tak issue pro v0.0.46 přešlo na v0.1.0, kterou upstream vydal
místo ní. Předchozí znění zůstane v historii úprav issue.

Totéž porovnání ručně a poslední běhy watche (jen čtení):

```bash
gh release list --repo pingdotgg/t3code --exclude-drafts --exclude-pre-releases --limit 3
gh api 'repos/Lazurio/t3code/contents/.github/workflows/lazurio-fork-ci.yml?ref=main' \
  -H 'Accept: application/vnd.github.raw' | grep -E '^  UPSTREAM_(TAG|SHA):'
gh run list --repo Lazurio/t3code --workflow lazurio-upstream-watch.yml --limit 3
```

První příkaz vypíše tři nejnovější stabilní vydání upstreamu (název, `Latest`,
tag a čas vydání), druhý `UPSTREAM_TAG` a `UPSTREAM_SHA`, na kterých `main`
stojí. Porovnání hned spustí
`gh workflow run lazurio-upstream-watch.yml --repo Lazurio/t3code`. GitHub
plánované workflow veřejného repozitáře po 60 dnech bez aktivity
v repozitáři vypne; když ho `gh workflow list --repo Lazurio/t3code --all`
ukáže jako `disabled_inactivity`, zapněte ho:
`gh workflow enable lazurio-upstream-watch.yml --repo Lazurio/t3code`.

### 2. Inventura a rozhodnutí

Než se změní první řádek kódu, má issue přestavby tabulku rozhodnutí: jeden
řádek na každý řádek tabulky [Overlay](#overlay) s tím, co upstream změnil
v jeho souborech, s rozhodnutím, zdůvodněním a tím, kdo ho schválil.
Podklady dá klon forku (`origin` je `Lazurio/t3code`, Git 2.40 nebo novější;
jen čtení):

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git   # jen poprvé
NEW_TAG=v0.1.2   # nové stabilní vydání upstreamu
git fetch origin main
git fetch --no-tags upstream "refs/tags/${NEW_TAG}:refs/tags/upstream-${NEW_TAG}"
OLD_SHA="$(git show origin/main:.github/workflows/lazurio-fork-ci.yml | sed -n 's/^  UPSTREAM_SHA: //p')"
NEW_SHA="$(git rev-parse "refs/tags/upstream-$NEW_TAG^{commit}")"
# Commit tagu podle upstreamu: anotovaný tag ho ohlašuje jako <tag>^{}, lehký tag je commit sám.
test "$NEW_SHA" = "$(git ls-remote https://github.com/pingdotgg/t3code.git "refs/tags/${NEW_TAG}^{}" "refs/tags/${NEW_TAG}" |
  sort -k2,2r | head -n 1 | cut -f1)"

gh release view "$NEW_TAG" --repo pingdotgg/t3code   # co upstream o vydání píše
git diff --name-only "$OLD_SHA" origin/main > /tmp/overlay-files
# Soubory overlaye, které upstream změnil (M) nebo smazal (D):
git diff --name-status --no-renames "$OLD_SHA" "$NEW_SHA" |
  awk -F'\t' 'NR == FNR { overlay[$0]; next } $2 in overlay' /tmp/overlay-files -
# Soubory, kde se overlay s upstreamem střetne (prázdný výstup: žádný konflikt):
git merge-tree --write-tree --name-only --merge-base="$OLD_SHA" "$NEW_SHA" origin/main |
  awk 'NR == 1 { next } /^$/ { exit } { print }'
# Co upstream udělal v souborech jednoho řádku (jeho soubory z Cílového stacku):
git log --oneline "$OLD_SHA..$NEW_SHA" -- <soubory řádku>
# Nové a změněné upstream workflow:
git diff --name-status "$OLD_SHA" "$NEW_SHA" -- .github/workflows/
```

`git merge-tree` slučuje celý overlay naráz; přehrávání po řádcích potká
tytéž konflikty po částech. Pro každý řádek pak zvolte jedno rozhodnutí:

- **ponechat**: upstream nic podobného nemá a švy řádku na nové bázi sedí;
- **přestavět**: upstream šev smazal (D výš) nebo přesunul na nové API;
  záměr řádku zůstává a postaví se znovu na novém API. Když upstream smaže
  celou vrstvu (v0.1.0 smazala `apps/server/src/orchestration/`
  i `ProviderService.ts`, #2829), hledejte nový šev tam, kde upstream nové
  služby skládá (v0.1.0 `orchestration-v2/runtimeLayer.ts` a `server.ts`):
  overlay tam upstream službu obalí dekorátorem a upstream soubor nese jeden
  řádek;
- **zmenšit**: část řádku upstream už umí, ta z řádku odpadne;
- **odebrat**: upstream umí celý řádek; řádek z tabulky Overlay odejde
  a jeho soubory z allowlistu.

K tomu případně **nabídnout upstreamu**: změnu, která by pomohla všem,
navrhněte v `pingdotgg/t3code` (issue nebo PR) a odkaz zapište do tabulky.

Co se sloučí bez konfliktu, a přesto se rozbije (smazané a přejmenované
moduly a API, které importují složky overlaye `apps/*/src/lazurio/`, švy,
které hlídá kontraktní test), ukáže naplno až typecheck a testy candidate
(etapa 4); co je známé z inventury, zapište do tabulky hned. K inventuře
patří i brány z etapy 5.

Rozhodnutí navrhuje Steward. Organization Admin schvaluje každé, které mění
chování pro lidi nebo jiné systémy (brány z etapy 5), přidává soubor do
allowlistu nebo vybírá mezi dvěma mechanismy; v issue citujte zvolenou
možnost. Kód se začne měnit, až v tabulce nezbývá otevřené rozhodnutí.

### 3. Přestavba candidate

Candidate vzniká v samostatném worktree z přesného tagu (proměnné z etapy 2):

```bash
git worktree add -b "lazurio/rebuild-$NEW_TAG" "../t3code-rebuild-$NEW_TAG" "$NEW_SHA"
cd "../t3code-rebuild-$NEW_TAG"
pnpm install --frozen-lockfile --filter 't3...' --filter '@t3tools/web...' --filter '@t3tools/scripts...' \
  --filter '@t3tools/monorepo' --filter '@t3tools/oxlint-plugin-t3code...'
```

Install jen pro server, web, skripty a pravidla lintu vynechá desktop a mobil,
které přestavba nepotřebuje, a ušetří asi 2 GB. Když `pnpm` není v `PATH`,
spouštějte ho v tomto i dalších příkazech přes
`npx --yes pnpm@<verze z packageManager v package.json>` (vite-plus pak jako
`… exec vp`).

Řádky přehrajte v pořadí [Cílového stacku](#cílový-stack), každý jako jeden
commit s předmětem z tabulky Overlay, řádek 5 poslední. Řádek přeneste podle
záměru, ne commit po commitu: jeho čistý diff proti staré bázi spojí původní
commit, pozdější opravy i vrácené pokusy do jedné změny.

```bash
git diff --binary --full-index "$OLD_SHA" origin/main -- <soubory řádku> | git apply --3way --index
git status --short   # UU: konflikt; vyřešte ho podle záměru a pak git add <soubor>
git commit -m "<předmět řádku>" -m "<co řádek dělá, proč a co se na nové bázi změnilo>"
```

- Soubor, který upstream smazal, `git apply` odmítne i s celým diffem („does
  not exist in index“). Vynechte ho (za ostatní soubory přidejte
  `':(exclude)<soubor>'`) a šev napište znovu na novém API podle rozhodnutí
  z tabulky.
- Soubor označený \* v Cílovém stacku mění víc řádků. Každý řádek si vezme
  své změny; kde je oddělit nejde, vezme celý soubor první řádek, který ho
  mění, a další řádky ho vynechají. CI musí projít jen hlava candidate
  branch.
- `pnpm-lock.yaml` diffem nepřenášejte. Když řádek mění závislosti
  (`package.json`), vygenerujte lockfile na candidate (`pnpm install`)
  a commitněte ho s řádkem; CI instaluje s `--frozen-lockfile`.
- Kde se commity řádku přenesou čistě, stačí `git cherry-pick -n` s nimi.
  Jejich změny souborů distribuce vraťte
  (`git restore --staged --worktree --source=HEAD -- <soubory>`), patří
  řádku 5.
- Řádek s rozhodnutím „odebrat“ nepřehrávejte; „zmenšit“ a „přestavět“
  udělejte v jeho commitu.

Velkou přestavbu můžete rozdělit na skupiny řádků, které spolu sdílejí
soubory, každou ve vlastním worktree z přesného tagu a s commitem na řádek.
Když řádek importuje soubor, který přidává řádek jiné skupiny, dejte ho do
skupiny jako dočasný commit (lešení) a při integraci ho zahoďte. Commity skupin
pak přeneste do `lazurio/rebuild-$NEW_TAG` v pořadí Cílového stacku. Kdo
integruje, přečte diff každého řádku a kontroly etapy 4 spustí znovu sám;
hlášení skupin nestačí.

Řádek 5 jde poslední. Soubory distribuce vezměte ze starého `main`;
`.github/SECURITY.md` patří upstreamu, a proto se přenáší jako ostatní
upstream soubory:

```bash
git checkout origin/main -- .dockerignore Dockerfile.lazurio '.github/workflows/lazurio-*.yml' \
  .github/ISSUE_TEMPLATE/1-lazurio-t3-code.yml .github/README.md 'docs/operations/lazurio-*.md' \
  '.agents/skills/lazurio-*' scripts/lazurio-release-contract.test.mjs
git diff --binary --full-index "$OLD_SHA" origin/main -- .github/SECURITY.md | git apply --3way --index
```

Pak je upravte na novou bázi:

- `lazurio-fork-ci.yml`: `UPSTREAM_TAG`, `UPSTREAM_SHA` a
  `version: X.Y.Z-lazurio.0` jobu `cli-archives`. Kontraktní test hlídá, že
  verze sedí k `UPSTREAM_TAG`, a sám obě hodnoty drží (test „CI is read-only
  and pins the exact upstream base“): změňte je i tam.
- Allowlist `allowed_upstream_changes`: odeberte soubory, které overlay už
  nemění nebo jejichž změnu převzal upstream. Nový soubor přidejte jen
  s rozhodnutím z issue a se zdůvodněním, do skupiny funkce, které patří.
  Co candidate (i s necommitnutými změnami) pod `apps/`, `packages/`
  a `scripts/` mění, vypíše
  `git diff --name-only "$NEW_SHA" -- apps packages scripts | grep -vE '^apps/[^/]+/src/lazurio/'`.
- Pevná brána testů (`gate` v kroku „Test what the overlay changes“): cesta,
  kterou upstream smazal nebo přejmenoval, krok shodí (v0.1.2 smazala
  `ServerEnvironmentLabel.test.ts`, `VcsProvisioningService.test.ts`
  a `RightPanelTabs.keyboard.browser.test.tsx`; jejich případy overlaye jsou
  ve složkách overlaye). Nahraďte ji vědomě a stejnou změnu udělejte
  v `oldTestGate` kontraktního testu.
- Toolchain: CI, vydání i obraz berou přesně `engines.node` a `packageManager`
  z `package.json` (na v0.1.2 Node 26.12.1 a pnpm 12.14.0) a k obrazu Node
  přesný digest; kontraktní test to hlídá (test „CI, the release and the image
  use upstream's exact Node and pnpm“).
- Švy, které kontraktní test hlídá a které se přesunuly (etapa 4), a jeho
  seznamy souborů overlaye, když se testy přejmenovaly.
- `.github/SECURITY.md`: pod nadpisem „Upstream T3 Code“ text upstreamu
  z nového tagu.
- Formulář issue: příklad verze (`placeholder`).
- Tento runbook: tabulka Overlay (bez odebraných řádků, sloupec „Upstream
  a přestavba“ podle nové báze; ostatní řádky si nechají čísla a pod tabulkou
  je poznámka o odebraném), Cílový stack (u každého řádku jeho commit;
  řádek 5 je tento commit), recepty, které nová báze mění (etapa 5),
  a příklady verzí.
- Specifikaci overlaye, kde se švy přesunuly, a skill
  `lazurio-upstream-rebuild`, kde při přestavbě nesedí.

**Z přestavby na v0.1.1.** Inventura běžela jen čtením v pěti skupinách řádků
(1–5 s branami; 8 a 10–12; 6, 7, 9, 13, 16 a 17; 15, 18 a 19; 20–22). Těžké
řádky (pravý panel 9 a 13; spravovaná složka, přihlášení, párování a CLI 15
a 18–22) vznikly ve worktree skupin a do candidate přešly cherry-pickem
v pořadí Cílového stacku. Ostatní řádky přehrál integrátor rovnou na candidate
po souborech: z commitů starého `main`, které soubor mění, vzal každý souvislý
běh commitů daného řádku jako jeden diff
(`git diff --binary --full-index <první>^ <poslední> -- <soubor> | git apply --3way --index`),
takže i soubor s \* dostal jen změny svého řádku. Většinu práce daly nová
pravidla lintu upstreamu (`prefer-effect-fn`, `no-low-value-comments` a React
Compiler na všech webových souborech) a webové testy v prohlížeči (#20797).
Funkce, které `Effect.fn` dostane za generátorem, dostanou kromě efektu i
argumenty volání, proto `Effect.ignore` obalte: `(effect) => Effect.ignore(effect)`.
Ve worktree vnořeném v repozitáři, jehož `.gitignore` ho ignoruje (třeba
`.worktrees/` nadřazeného checkoutu), pre-commit hook (`vp fmt` nad staged
soubory) potichu nic nenaformátoval; formát tam ověřte
`vp fmt --stdin-filepath=<soubor> < <soubor>` a lint `vp lint --no-ignore`.
V zsh se seznam souborů z proměnné rozdělí jen zápisem `${=FILES}`. Test
„publishes proven install ownership only for manually updated servers“
v `ServerEnvironment.test.ts` na macOS padá (`/private/var`) i na čistém
upstreamu. Řádky 6 a 18 berou `prefersCzech` z `threadTabs.ts` řádku 9, takže
řádek 6 se sám nezkompiluje a oba na řádku 9 závisí; `prefersCzech` je kandidát
na vlastní modul overlaye.

**Z přestavby na v0.1.2.** Inventura běžela jen čtením ve třech skupinách
(1–5; 6–13; 15–22) a řádky 23–26 inventarizovalo vlákno, které je vlastní
(Lazurio/t3code#112). Rozhodující nález byl řádek 21: upstream přidal vlastní
`t3 thread` (#22732) a prosté přehrání by zaregistrovalo dvě skupiny jména
`thread`, se kterými se `t3` (ani server) nespustí. Řádky vznikly po řádcích
přímo na candidate (`git cherry-pick -n` commitů řádku, u více commitů jeden
sjednocený diff přes `git apply --3way --index`) a soubory distribuce z nich
přešly do řádku 5. Většinu práce daly testy, které upstream smazal (#22557)
a ve kterých overlay měl své případy (ty přešly do složek overlaye), a nová
pravidla lintu pro testy (#22560–#22565): částečné falešné časovače a čekání
na snímek v testech v prohlížeči, čekání na skutečný čas a vlastní časové
limity. Rozdělení po řádcích pořád není samostatné (řádek 9 importuje soubor
řádku 13), testy v prohlížeči proto pouštějte až po řádku 13; CI kontroluje
jen hlavu candidate. Řádky 27 a 28 (Lazurio/t3code#106 a #113) a licence
značkových souborů (#110) přibyly na `main` po inventuře a přešly na candidate
stejným postupem; jejich švy na v0.1.2 popisuje tabulka. Řádek 29 je backport
upstream #23798: bez něj od 2026-10-23 neprojde žádné vydání.

### 4. Kontrakt a stráže

Lokálně v candidate (Node a pnpm přesně podle `engines.node` a `packageManager`,
na v0.1.2 Node 26.12.1 a pnpm 12.14.0, závislosti z etapy 3; na macOS spouštějte
testy s `TMPDIR="$(cd "$TMPDIR" && pwd -P)/"`, jinak jeden test upstreamu
narazí na symlink `/var` → `/private/var`):

```bash
node --test scripts/lazurio-release-contract.test.mjs
pnpm exec vp fmt --check
pnpm run lint
pnpm exec vp run --filter t3 typecheck
pnpm exec vp run --filter @t3tools/web typecheck
node apps/server/node_modules/playwright-core/cli.js install --only-shell chromium   # jednou
(cd apps/server && pnpm run test src/lazurio src/auth)
(cd apps/web && pnpm run test src/lazurio)
```

Testy webu od v0.1.1 pouští i projekt `browser`: soubory `*.browser.test.ts(x)`
vykreslují React v headless Chromiu (#20797), které stáhne příkaz výš (CI ho
instaluje s `--with-deps`).

Pak branch pushněte a otevřete PR do `main`, nejdřív jako draft:

```bash
git push -u origin "lazurio/rebuild-$NEW_TAG"
gh pr create --repo Lazurio/t3code --base main --head "lazurio/rebuild-$NEW_TAG" --draft \
  --title "Rebuild the Lazurio overlay on upstream T3 Code $NEW_TAG" --body-file <popis PR>
gh pr checks "lazurio/rebuild-$NEW_TAG" --repo Lazurio/t3code --required --watch
```

Když se běh `pull_request` na PR nespustí (PR přestavby je s `main` v konfliktu
už svou podstatou), spusťte CI ručně na větvi:

```bash
gh workflow run lazurio-fork-ci.yml --repo Lazurio/t3code --ref "lazurio/rebuild-$NEW_TAG"
gh run list --repo Lazurio/t3code --workflow lazurio-fork-ci.yml --branch "lazurio/rebuild-$NEW_TAG" \
  --limit 1 --json databaseId,event,headSha,status,conclusion
```

Povinné checky pak nese commit headu PR. `gh pr checks` je u PR v konfliktu
nevypíše, ověřte je proto přímo na commitu:

```bash
candidate_head="$(gh pr view "lazurio/rebuild-$NEW_TAG" --repo Lazurio/t3code --json headRefOid --jq .headRefOid)"
gh api "repos/Lazurio/t3code/commits/$candidate_head/check-runs" \
  --jq '.check_runs[] | "\(.name): \(.conclusion)"'
```

PR slouží jen CI a review a tlačítkem se nikdy nemerguje: jeho head se stane
`main` výměnou (etapa 6). Popis PR nese přesné vstupy (starou a novou bázi se
SHA, `expected_old_main` a `candidate_head`), odkaz na issue přestavby,
posunuté piny kontraktního testu a změny allowlistu a brány testů. GitHub
v PR ukazuje i všechny změny upstreamu mezi bázemi, overlay se proto čte
lokálně:

```bash
git diff --stat "$NEW_SHA" HEAD                           # celý overlay na nové bázi
git range-diff "$OLD_SHA..origin/main" "$NEW_SHA..HEAD"   # overlay proti starému main
```

Povinné checky main rulesetu jsou čtyři:

```bash
gh api repos/Lazurio/t3code/rulesets/21717536 \
  --jq '[.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'
# ["CLI archives / Build darwin-arm64","CLI archives / Build linux-x64",
#  "CLI archives / Launcher install linux-x64","Server and web compatibility"]
```

Co hlídají a co dělat, když selžou (podrobně
[Testování před vydáním](#testování-před-vydáním), krok 1):

- **Allowlist** (první krok CI): změna upstream souboru, který na allowlistu
  není. Změnu vraťte, nebo soubor přidejte s rozhodnutím z issue.
- **Kontraktní test** hlídá švy overlaye v upstream souborech. Když se šev
  podle rozhodnutí v issue přesunul, upravte pin ve stejném commitu řádku 5
  a v PR ho vyjmenujte. Pin, který projde jen proto, že ve stromu zůstal
  soubor smazaný upstreamem, je chyba: soubor smažte a pin přepište na nový
  šev.
- **Testy** všeho, co overlay mění, a pevná brána. Testy overlaye proti
  skutečnému Chromiu přes CDP se bez `LAZURIO_TEST_DEVTOOLS_ENDPOINT` přeskočí;
  webové testy v prohlížeči běží v headless Chromiu, které CI instaluje.
- **Formát, lint a typecheck.** Smazané a přejmenované moduly a API upstreamu
  se ukážou tady.
- **Image a CLI archivy** včetně `LICENSE`, produkčního faviconu a instalace
  přes launcher.

Review na přesném headu dělá Steward, nebo review agent jeho Organizace. PR
přepněte na Ready, až je CI na přesném headu zelené, review na něm nemá
otevřená vlákna a issue má vyplněnou etapu 5.

### 5. Kompatibilita s Lazuriem

Kromě CI musí přestavba zachovat to, na co spoléhají jiné systémy a lidé. Ke
každé bráně zapište do issue, co se na nové bázi mění, rozhodnutí a jak je to
ověřené. Rozdíl mezi bázemi ukáže
`git diff "$OLD_SHA" "$NEW_SHA" -- <soubory>` se soubory uvedenými u brány.

- **`t3 lazurio capabilities`, `t3 lazurio model`, `t3 lazurio providers`
  a `t3 lazurio pairing`.** Machines ověřují `capabilities` (kontrakt verze 1),
  Platforma volá `model` příkazem `lazurio chat defaults --apply` a Launchpad
  volá `providers` po přihlášení CLI a `pairing`, když Environment páruje svůj
  prohlížeč (řádek 19). `apps/server/src/lazurio/cli.test.ts` drží výstup
  prvních tří bajt po bajtu a výstup `pairing` jako výstup
  `t3 auth pairing create --json` se stejnými rozsahy; při přestavbě se nemění.
  Rozsahy operátora jsou pro `pairing` `AuthStandardClientScopes`
  z `packages/contracts/src/auth.ts` bez `relay:write`; `cli.test.ts` je
  vypisuje doslova, takže změnu standardních rozsahů upstreamu test shodí a její
  přijetí je rozhodnutí. `model` a `providers` jdou přes běžící
  službu sezením, které si CLI samo vydá s rozsahy, jež cesty vyžadují: `model`
  rozsah upstreamu pro `serverUpdateSettings`, `providers` rozsah pro
  `serverRefreshProviders` a rozsahy, které upstream chce pro změnu instancí
  poskytovatelů v nastavení (`requiredScopesForServerSettingsPatch`). CLI
  i cesta je berou ze stejného místa, takže se s upstreamem posunou spolu; na
  v0.1.0, v0.1.1 i v0.1.2 je to `settings:write`, resp. `orchestration:read` a
  `providers:manage`. Když upstream rozsahy rozdělí, ověřte, že úložiště
  tajemství sezení s novými rozsahy vydá. Soubory:
  `apps/server/src/auth/RpcAuthorization.ts`, `packages/contracts/src/auth.ts`
  a `packages/contracts/src/settings.ts`. Na canary ověřte po Update tlačítkem
  `lazurio chat defaults --apply` a přihlášení na stránce Začínáme.
- **Kanál aktualizací.** Environmenty se aktualizují z vydání tohoto
  repozitáře, výchozího repozitáře distribuce, na který je Machines vedou
  i proměnnou `T3CODE_RELEASE_REPOSITORY` (řádek 4). Hlídají ho testy řádku 4
  v CI, kontraktní test výchozího repozitáře a job `Launcher install linux-x64`.
  Soubor `apps/server/src/cloud/serviceProtocol.ts`: když se změní
  `SERVICE_LAUNCHER_PROTOCOL`, tlačítko Update na Environmentu se starým
  launcherem odmítne a Environment je potřeba jednou převést (Testování před
  vydáním, krok 3). Update tlačítkem běží pod launcherem, který na
  Environmentu je, při přechodu na novou bázi tedy pod launcherem staré verze
  s jeho oknem pro připravenost (0.0.45: 120 s; od v0.1.0: 30 min, upstream
  #19311). Když první start nové báze s velkou databází okno nestihne, launcher
  Update vrátí, ale obnoví jen databázi staré verze. Soubor databáze nové báze
  (na v0.1.0 `statev2.sqlite`) zůstane, další pokus ho znovu nevytvoří a
  chyběla by v něm práce z mezidobí. Po vráceném Update ho proto odsuňte
  ([Rollback](#rollback)); Environment s velkou databází převeďte raději pinem
  v Machines. Mezi v0.1.0 a v0.1.1 je databází týž `statev2.sqlite`, který
  launcher před Update zálohuje a vrácený Update obnoví, takže tady zastaralá
  kopie nezůstane. v0.1.2 zůstává u téhož souboru a migrace nepřidává,
  takže to platí i mezi v0.1.1 a v0.1.2; `SERVICE_LAUNCHER_PROTOCOL` je od
  v0.1.0 beze změny 3. Dobu do připravenosti změřte na canary tlačítkem Update
  (etapa 8). Přestavba na v0.1.0 naměřila: Update tlačítkem z 0.0.45 nad
  malou databází `committed` do minuty od kliknutí; první start v0.1.0 nad
  databází V1 o 5,2 GB (kopie i import) byl na Apple Silicon připravený za
  33 s, na VM s pomalejším diskem počítejte s násobkem.
- **CLI a server na jedné verzi.** Update tlačítkem přesune jen aktivní verzi
  launcheru; `~/.local/bin/t3` přesměruje `t3 update` nebo Machines, tlačítko
  ne. Server pod launcherem ho proto po své aktivaci přesměruje na vlastní
  runtime (řádek 4, Lazurio/t3code#30; jen odkaz do `runtime/versions` téže T3
  home). Na tom stojí párování Chatu z Launchpadu (`t3 auth pairing create`
  i `t3 lazurio pairing`), `lazurio chat defaults --apply`
  i `t3 lazurio providers`: CLI staré verze by na nové bázi zapisoval do
  databáze, kterou nový server nečte (na v0.1.0
  `state.sqlite` místo `statev2.sqlite`). Na canary po Update tlačítkem
  ověřte, že `readlink ~/.local/bin/t3` míří na
  `runtime/versions/<nová verze>/t3` a Chat z Launchpadu se spáruje. Soubory:
  `apps/server/src/lazurio/launcherLink.ts`, `apps/server/src/cli/update.ts`
  (`repointLauncher` upstreamu) a `apps/server/src/cloud/pinnedRuntime.ts`, jehož
  úklid starých runtime (od v0.1.1, #22253) nechá runtime, na který míří `t3`.
  Riziko jde i opačně: každý příkaz CLI, který otevře databázi (i
  `t3 auth pairing create` a `t3 auth session issue`), na ní pustí migrace své
  verze, takže `t3` nové báze zmigruje databázi i pod běžícím serverem staré
  (v0.1.1 nad 0.1.0 migracemi 063–067). Při převodu přes SSH proto nejdřív
  zálohujte a pak spusťte `t3 update`, žádný jiný příkaz nové verze před ním.
- **Párování a rozsahy sezení.** Prohlížeče jsou spárované na rok
  (`T3CODE_CLIENT_SESSION_TTL=365d`) a server uložené rozsahy nikdy
  nerozšiřuje. Když upstream rozsahy rozdělí nebo přidá
  (`packages/contracts/src/auth.ts`, `apps/server/src/auth/RpcAuthorization.ts`),
  prohlížeč spárovaný na staré bázi ztratí operace, které nový rozsah
  vyžadují, dokud se znovu nespáruje; na v0.1.0 (#9786–#9791) mimo jiné
  terminál, soubory, Git, nastavení, Update a podržení záložek prohlížeče
  Environmentu. Cesty overlaye berou rozsahy z `requiredScopeForRpcMethod`,
  takže se posunou samy. Prohlížeč, jehož sezení má jen staré rozsahy
  (`sessionHasLegacyPermissions`, na v0.1.0 prohlížeč spárovaný na 0.0.45), se
  na Environmentu Lazuria při příštím načtení Chatu spáruje znovu sám
  (řádek 19), i když cookie ještě platí; když to nejde, zůstane jako dřív.
  Rozdělení nebo nový rozsah, které `sessionHasLegacyPermissions` nepozná, se
  samo nespáruje: buď podmínku v `apps/web/src/lazurio/environmentPairing.ts`
  rozšiřte (mění chování, schvaluje Admin), nebo platí jednou otevřít Chat
  odkazem s párováním (`/pair#token=…` od v0.1.0 nahradí uložený grant).
  Desktop a mobilní aplikaci je potřeba spárovat znovu. Lidem změnu oznamte
  předem (etapa 8). Hlídejte i výchozí udělení `t3 auth pairing create`, kterým
  Launchpad páruje návštěvníky veřejných Environmentů a T3 bez párování
  operátora: v0.1.1 ho rozšířila z 13 na 16 rozsahů o `access:read`,
  `access:write` a `relay:write` (#20432). Žádný rozsah přitom nerozdělila ani
  nepřejmenovala, takže prohlížeče spárované na v0.1.0 se párovat znovu nemusí.
  v0.1.2 rozsahy ani výchozí udělení nemění (`auth.ts` i `RpcAuthorization.ts`
  jsou beze změny).
  Launchpad proto od LazurioPlatform#583 rozsahy standardního párování jmenuje
  výslovně (13 standardních rozsahů v0.1.0): nikdy `relay:write` a na veřejném
  Environmentu ani `access:write`, jinak by návštěvník spravoval přístupy
  a T3 Connect. Taková změna Platformy jde na Environmenty před novou verzí T3
  (etapa 8).
- **Databáze.** Migrace jsou jednosměrné, starší server nemá down migrace.
  Před aktualizací trvalého canary Environmentu zálohujte databázi
  (`try-*` ne; Testování před vydáním, krok 3). Soubory
  `apps/server/src/config.ts` (`dbPath`) a `apps/server/src/persistence/`:
  když nová báze databázi přesouvá nebo zakládá novou, upravte zálohu
  a [Rollback](#rollback) ve stejné přestavbě a do issue zapište, co s daty
  udělá návrat na starou bázi. v0.1.0 přešla na
  `~/.t3/userdata/statev2.sqlite`: vznikne jednou, kopií `state.sqlite` při
  prvním otevření databáze serverem nebo CLI, a `state.sqlite` pak zůstane
  nedotčený. Záloha proto bere oba soubory, které existují, a `settings.json`.
  v0.1.1 zůstává u téhož souboru a přidává migrace 063–067 (063 maže projekce
  V1, které nic nečte; ty, které čte import V1, zůstávají). v0.1.2 žádnou
  migraci nepřidává (jen přestala exportovat `migrationEntries`), takže návrat
  na v0.1.1 nechá databázi, jak je. Návrat na v0.1.0 nad
  zmigrovanou databází jde podle kódu i bez obnovy, ověřený je ale jen čtením.
  Nový `t3 doctor` s pozastavenou službou databázi zkompaktuje (smaže překonané
  události) a na výslovnou volbu smaže `state.sqlite`, a tím i cestu zpět na
  0.0.45; Machines ani agenti ho proto automaticky nepouštějí.
- **Desktop a mobil.** Oficiální aplikace jsou upstream a se serverem se
  domlouvají na orchestračním protokolu (`ORCHESTRATION_PROTOCOL_VERSION`
  v `packages/contracts/src/environment.ts`; 0.0.45 má 1, v0.1.0 až v0.1.2
  mají 2). Když se liší, aplikace a server různých protokolů se nespojí (viz
  [Desktop a mobil](#desktop-a-mobil-proti-serveru-z-forku)). Na canary
  připojte aplikaci verze nové báze.
- **Kontrakt prohlížeče Environmentu (LazurioPlatform F50).** Hub, pohled
  a Launchpad Platformy čtou soubory držitelů a adresy pohledů, které overlay
  píše a čte. Ručně kopírované části kontraktu jsou pomocníci
  v `apps/server/src/lazurio/holders.ts` (vyjmenovává je jeho hlavička),
  čtení adresy pohledu v obou `browserView.ts` a pravidla id záložky a jména
  pásu v obou složkách overlaye. Dokud je úkol 703 nenahradí soubory
  převzatými z ověřeného artefaktu shellu Platformy, musí zůstat shodné
  s modulem kontraktu Platformy (`src/browser/contract/`). Přestavba je proto
  přenáší beze změny chování, nanejvýš s novými importy, a `holders.test.ts`
  s vektory Platformy i kontrola obou kopií v kontraktním testu projdou beze
  změny vektorů. Změna kontraktu je samostatná změna s Platformou, ne součást
  přestavby.
- **Slot shellu a vzhled design systému.** Shell Environmentu
  (`/.lazurio/shell.js`, rozhraní v1) se zavěšuje do `apps/web/index.html`
  a `sidebar/SidebarChrome.tsx` a `apps/web/src/lazurio/theme.css` mapuje jeho
  tokeny na tokeny T3 z `apps/web/src/index.css`. Kontraktní test hlídá slot,
  barevné role shellu a to, že mapované tokeny `index.css` deklaruje ve
  stejném scope. Nové tokeny upstreamu nezachytí, ty mají výchozí hodnoty T3;
  proto kontrola v prohlížeči na canary (etapa 7).
- **Machines a Platforma.** Co nová báze potřebuje od Environmentu
  (proměnné v drop-inu služby, oprávnění pro systemd, nové soubory nebo
  služby) a co z overlaye volá Platforma, zapište do issue jako změny
  Machines a Platformy. Nasazují se před stable (etapa 8).

### 6. Výměna `main`

Výměnu provádí Organization Admin, nebo jeho Task Agent na jeho explicitní
pokyn vázaný na oba SHA či s mandátem ze [zadání](#zadání-pro-task-agenta), vždy
na SHA, která sám ověřil. Používá k tomu existující bypass `OrganizationAdmin`
v main rulesetu 21717536. Ostatním force-push dál blokuje pravidlo
`non_fast_forward` a běžné PR a check ochrany platí pro všechny beze změny.
Steward předá Adminovi přesný starý `main` (`expected_old_main`), přesný head
PR (`candidate_head`) a odkaz na zelený běh CI.

Předpoklady:

1. `Lazurio Fork CI` je zelené na přesném headu PR, review na tomto headu
   nemá otevřená vlákna a issue nemá otevřené rozhodnutí.
2. Současný `main` je zachycený publikovaným **immutable** vydáním
   `v…-lazurio.N`. Jiný tag nestačí. Tag vydání míří buď přesně na starý
   `main`, nebo na jeho předka, od kterého se starý `main` liší jen
   v `docs/`. Takové commity nemění nic, co se vydává, a jejich obsah přejde
   do nového `main` s přestavěným overlayem; kvůli nim se samostatné vydání
   nedělá (rozhodnutí Admina 2026-10-02, DEV-6633). Ověřte obojí a že vydání
   je immutable:

   ```bash
   git fetch origin main --tags
   expected_old_main="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
   candidate_head="$(gh pr view "lazurio/rebuild-$NEW_TAG" --repo Lazurio/t3code --json headRefOid --jq .headRefOid)"
   capture="$(gh api repos/Lazurio/t3code/releases/latest --jq .tag_name)"   # poslední stable vydání
   capture_sha="$(gh api "repos/Lazurio/t3code/git/ref/tags/$capture" --jq .object.sha)"
   git merge-base --is-ancestor "$capture_sha" "$expected_old_main"
   git diff --quiet "$capture_sha" "$expected_old_main" -- . ':(exclude)docs/'
   test "$(gh api "repos/Lazurio/t3code/releases/tags/$capture" --jq .immutable)" = true
   ```

   Pokud starý `main` mění proti poslednímu vydání cokoli mimo `docs/`,
   vydejte ho nejdřív běžnou cestou: preview na Ring 0 s kontrolou
   v prohlížeči, pak stable ze stejné špičky `main` (tak před přestavbou na
   v0.1.0 vzniklo zachycení `0.0.45-lazurio.9`). Docs commity starého `main`
   přeneste do candidate.

3. Admin ověří, že bypass existuje:

   ```bash
   gh api repos/Lazurio/t3code/rulesets/21717536 --jq '.bypass_actors'
   # očekáváno: [{"actor_id":null,"actor_type":"OrganizationAdmin","bypass_mode":"always"}]
   # (Maintainer vidí null kvůli svým právům; readback dělá Admin.)
   ```

Potom Admin, nebo jeho Task Agent podle pokynu či mandátu výš, vymění `main`
z klonu, který candidate head má
(`git fetch origin "lazurio/rebuild-$NEW_TAG"`):

```bash
git push --force-with-lease="refs/heads/main:$expected_old_main" \
  origin "${candidate_head}:refs/heads/main"
```

Neúspěšný lease znamená souběžnou změnu. Nikdy ho automaticky neopakujte.

Po výměně:

- PR přestavby GitHub sám označí jako merged, protože jeho head je teď
  `main`.
- `Lazurio Fork CI` proběhne na `main`:
  `gh run list --repo Lazurio/t3code --workflow lazurio-fork-ci.yml --branch main --limit 1`.
- Nové upstream workflow vypněte (viz
  [Hranice automatizace](#hranice-automatizace)). Po výměně na v0.1.3 jsou to
  `relay-preview.yml`, `relay-preview-cleanup.yml` a `stale-needs-more-info.yml`;
  vypněte je ještě před 06:17 UTC, kdy by `stale-needs-more-info.yml` poprvé
  běžel (`relay-preview-cleanup.yml` má plán v 07:17 UTC na runneru, který tu
  není).
- Každé vydání z `main` je od teď na nové bázi a opravu na starou bázi už
  vydat nejde. Vyměňujte proto, až je poslední stable na staré bázi
  v pořádku.

### 7. Náhled na canary

Z nového `main` vydejte preview `X.Y.Z-preview.YYYYMMDD.1`
([Spuštění vydání](#spuštění-vydání), [Schválení](#schválení),
[Ověření publikovaného vydání](#ověření-publikovaného-vydání))
a nainstalujte ho na canary Environmenty
([Ring 0](#ring-0-lazurioexampleorganization)) po záloze databáze na trvalých
Environmentech (`try-*` bez zálohy)
([Testování před vydáním](#testování-před-vydáním), krok 3). Projděte
všechny kontroly kroku 3 a navíc to, čeho se přestavba dotkla v každém
řádku:

- přihlášení přes Launchpad Chat a spárování prohlížeče Environmentem: přímá
  návštěva Chatu bez sezení (záložka, přepínač shellu) se spáruje sama a zůstane
  na odkazované stránce, Settings → Connections ukáže Authorized clients;
  co umí a neumí prohlížeč spárovaný na staré bázi a zda se spároval znovu;
- `t3 lazurio capabilities`, `lazurio chat defaults --apply` Platformy
  a nová vlákna ve složce Lazuria bez uvítání;
- „+ Nový modul“ z Launchpadu otevře neodeslané zadání;
- agentní turn s Codexem i s Claude: agent pracuje ve vlastním okně prohlížeče
  Environmentu, `preview_open` ukáže jeho záložku v panelu a
  `printenv AGENT_BROWSER_SESSION` ve vlákně Codexu i Claude vypíše sezení
  toho vlákna. Na Ring 0 ověřte turn jen s poskytovatelem, který je tam už
  přihlášený, jinak na prvním Environmentu s AI. Osobní účet poskytovatele na
  sdílený Environment Ring 0 nepřihlašujte;
- „+“ i Mod+T otevřou Novou kartu a serverový prohlížeč upstreamu se nikde
  neukáže;
- rail, hlavička sloupce pod horním řádkem s přepínačem a wordmarkem a Buddy,
  s tenkou čárou mezi railem a sidebarem v barvě motivu (světlý i tmavý);
- stará vlákna po migraci databáze a restart služby se zachovanými daty.
  Bez přihlášeného poskytovatele vlákno se zprávou nevznikne (odeslání je
  vypnuté), stará vlákna pak ověřte na prvním Environmentu s historií;
- oficiální desktop aplikace verze nové báze proti serveru.

Kontrolu v prohlížeči (root rozhodnutí 0178) udělá ten, kdo preview
připravil a nainstaloval, sám; Organization Admin ji pak na canary projde
a přijme. Výsledek obou zapište do issue. Oprava během canary je běžný PR do `main`
a další preview `.N+1`.

Přihlásit se do Environmentů Ring 0 potřebuje člověk s přístupem (Owner nebo
člen Teamu), nebo testovací účet z lokální custody Ring 0. Pracujte ve
vlastním profilu prohlížeče, ne v profilu, kde jiné vlákno testuje odhlášení:
„Odhlásit“ ukončí sezení Lazuria pro celý profil a WebSocket T3 pak odpovídá 401.

Preview nainstalované `t3 update` přes SSH přepíše službu na launcher nové
verze, takže okno starého launcheru ani přesměrování `t3` po Update neukáže.
Aspoň jeden trvalý Environment Ring 0 proto nechte na předchozím stable:
přechod tlačítkem Update na něm ověříte v etapě 8.

### 8. Stable a nasazení

1. **Platforma a Machines první.** Změny, které nová verze potřebuje (etapa
   5), dostanou všechny dotčené Environmenty dřív než stable. Stable si lidé
   nainstalují tlačítkem Update sami a kdykoli, kdežto Platforma a Machines
   přijdou na Environment jen naším rolloutem (rozhodnutí 0200, F47). Jiné jsou
   změny, kterými se Machines a Platforma nové verzi přizpůsobují pro svou
   vlastní práci (zálohy, párování správce, limity paměti): ty musí být
   nasazené dřív, než Machines nebo Platforma na Environment s novou verzí
   příště sáhnou, a stable kvůli nim nečeká. Do issue zapište, která změna je
   které povahy.
2. **Oznámení lidem**, když přestavba mění, co uvidí nebo musí udělat: nové
   spárování prohlížeče tam, kde ho Environment neobstará sám (viz brána
   Párování a rozsahy sezení), aktualizace a nové spárování desktop a mobilní
   aplikace, cokoli z tabulky rozhodnutí.
3. **Stable `X.Y.Z-lazurio.1`** ze stejného commitu jako canary preview, po
   výslovném souhlasu Admina (nebo s mandátem ze
   [zadání](#zadání-pro-task-agenta)). Canary Environment pak vraťte z preview
   (Testování před vydáním, krok 4).
4. **Co dostanou Environmenty.** Environmenty pod launcherem ukážou tlačítko
   Update po příští kontrole kanálu (při startu a každých 6 hodin). Na
   Environmentu Ring 0, který zůstal na předchozím stable, ověřte tlačítkem
   Update (ne `t3 update`), že Update nabídne, projde trialem launcheru
   a zálohou databáze, `t3 --version` i `readlink ~/.local/bin/t3` ukážou novou
   verzi a Chat z Launchpadu se spáruje. U nové báze změřte dobu do
   připravenosti (etapa 5, Kanál aktualizací). Pin T3 v Machines je minimum:
   na stable se Environmenty dostanou tlačítkem i bez něj; zvedněte ho, až má
   nový Environment rovnou začínat na nové bázi.
5. **Desktop a mobil** až po Update ve webové T3 (viz
   [Desktop a mobil](#desktop-a-mobil-proti-serveru-z-forku)); u v0.1.1
   desktop 0.1.1 a mobilní aplikace 2.x, které se stejným protokolem připojí
   k Environmentům na obou bázích. Mobilní aplikace 1.x se k Environmentu od
   0.1.0 nepřipojí; verze 2.0 je v App Store a Google Play od 2026-10-15.
   Řekněte to lidem v oznámení (bod 2).
6. **Plán dalších vln** předložte Organization Adminovi ke schválení; mimo
   Ring 0 se bez něj nic nenasazuje. Plán jmenuje Environmenty a jejich
   pořadí, okna, přepnutí tailnetu, změny Machines a Platformy (bod 1)
   a oznámení lidem (bod 2).

### 9. Po vydání

- **Upstreamu** nabídněte, co by pomohlo všem a příští overlay zmenšilo
  (v tabulce „nabídnout upstreamu“): issue nebo PR v `pingdotgg/t3code`
  podle jeho `CONTRIBUTING.md`. Odkaz zapište do sloupce „Upstream
  a přestavba“.
- **Runbook a skill** doplňte běžným PR do `main`: Cílový stack o commity,
  které na `main` přibyly po výměně (opravy z canary), podle pravidel řazení,
  sloupec „Upstream a přestavba“ podle upstream `main` toho dne a všechno, co
  při přestavbě nesedělo. Kroky drží runbook, skill na ně jen odkazuje. Změna
  jen v `docs/` pravidlo zachycení z etapy 6 neporuší; změna skillu
  (`.agents/`) leží mimo `docs/`, takže před příští výměnou `main` ji musí
  zachytit další vydání.
- **Issue přestavby** zavřete s odkazem na stable vydání a PR přestavby.

### Issue přestavby

Issue přestavby drží vstupy, stav etap a rozhodnutí. Šablona je níž mezi
značkami `rebuild-issue`; issue z ní založíte takto (nahraďte `vX.Y.Z`):

```bash
gh api 'repos/Lazurio/t3code/contents/docs/operations/lazurio-fork-release.md?ref=main' \
  -H 'Accept: application/vnd.github.raw' |
  sed -n '/^<!-- rebuild-issue:start -->$/,/^<!-- rebuild-issue:end -->$/p' > /tmp/rebuild-issue.md
gh issue create --repo Lazurio/t3code --title "Přestavba na upstream T3 Code vX.Y.Z" \
  --body-file /tmp/rebuild-issue.md
```

Vstupy vyplňte hned, tabulky v etapách 2 a 5. Issue je veřejné.

<!-- rebuild-issue:start -->

Přestavba overlaye Lazuria na nové stabilní vydání upstream T3 Code. Postup
a příkazy:
[Nové stabilní vydání upstreamu](https://github.com/Lazurio/t3code/blob/main/docs/operations/lazurio-fork-release.md#nové-stabilní-vydání-upstreamu).
Issue je veřejné: žádná jména klientských Organizací, lidí ani soukromých
hostů, jen Environmenty a role.

**Vstupy**

- Nová báze: `vX.Y.Z` = `<SHA tagu>`
- Stará báze: `<UPSTREAM_TAG>` = `<UPSTREAM_SHA>`; `main` = `<expected_old_main>`
- Zachycení `main`: stable `v…-lazurio.N` = `<SHA>` (immutable)
- Candidate: branch `lazurio/rebuild-vX.Y.Z`, PR #…, head `<candidate_head>`

**Etapy**

- [ ] 1. Sledování: issue je přiřazené Stewardovi a vstupy jsou vyplněné.
- [ ] 2. Inventura a rozhodnutí: tabulka rozhodnutí je vyplněná a rozhodnutí,
      která mění chování nebo kontrakt, mají schválení Organization Admina
      (s citací zvolené možnosti).
- [ ] 3. Přestavba candidate: jeden commit na řádek v pořadí Cílového stacku,
      řádek 5 poslední.
- [ ] 4. Kontrakt a stráže: `Lazurio Fork CI` je zelené na přesném headu PR;
      posunuté piny kontraktního testu a změny allowlistu jsou v PR.
- [ ] 5. Kompatibilita s Lazuriem: každá brána má zápis.
- [ ] 6. Výměna `main`: zachycení je ověřené, `main` je vyměněný
      (`expected_old_main` → `candidate_head`) a nové upstream workflow jsou
      vypnuté.
- [ ] 7. Náhled na canary: preview `X.Y.Z-preview.YYYYMMDD.N` prošlo na Ring 0
      kontrolami i kontrolou v prohlížeči.
- [ ] 8. Stable a nasazení: změny Platformy a Machines jsou nasazené, oznámení
      lidem je venku, `X.Y.Z-lazurio.1` je vydané, Update tlačítkem
      z předchozího stable je ověřený a plán dalších vln je předaný Adminovi.
- [ ] 9. Po vydání: návrhy upstreamu jsou podané, runbook a skill jsou
      doplněné a issue se zavírá.

**Rozhodnutí po řádcích Overlaye**

Jeden řádek na každý řádek tabulky Overlay. Rozhodnutí: ponechat, přestavět,
zmenšit nebo odebrat; k tomu případně nabídnout upstreamu (s odkazem).

| #   | Řádek                                     | Co upstream změnil v jeho souborech | Rozhodnutí | Zdůvodnění a dopad | Schválení |
| --- | ----------------------------------------- | ----------------------------------- | ---------- | ------------------ | --------- |
| 1   | `hosted: configurable client session TTL` |                                     |            |                    |           |

**Brány kompatibility**

| Brána                                            | Co se na nové bázi mění | Rozhodnutí a ověření |
| ------------------------------------------------ | ----------------------- | -------------------- |
| `t3 lazurio capabilities`, `model` a `providers` |                         |                      |
| Kanál aktualizací a protokol launcheru           |                         |                      |
| CLI a server na jedné verzi                      |                         |                      |
| Párování a rozsahy sezení                        |                         |                      |
| Databáze                                         |                         |                      |
| Desktop a mobil (orchestrační protokol)          |                         |                      |
| Kontrakt prohlížeče Environmentu                 |                         |                      |
| Slot shellu a vzhled design systému              |                         |                      |
| Machines a Platforma                             |                         |                      |

**Otevřené otázky a blokery**

- …

<!-- rebuild-issue:end -->

### Zadání pro Task Agenta

Přestavbu může Steward nebo Organization Admin svěřit Task Agentovi (Claude
Code, Codex a další) celou, od inventury po stable. Zadání vložte do jeho Chatu,
nahraďte v něm `vX.Y.Z` a odkaz na issue a v odstavci „Mandát“ ponechte jen to,
co mu svěřujete. Agent postupuje podle skillu
[`lazurio-upstream-rebuild`](../../.agents/skills/lazurio-upstream-rebuild/SKILL.md),
který vede práci nad tímto runbookem.

```text
Pracuješ v repozitáři Lazurio/t3code, distribuci Lazurio T3 Code. Repozitář je veřejný.
Upstream T3 Code vydal stabilní vX.Y.Z a přestavba overlaye na něj se vede v issue <odkaz na
issue přestavby>. Postup je v docs/operations/lazurio-fork-release.md, sekce „Nové stabilní
vydání upstreamu“, a ve skillu .agents/skills/lazurio-upstream-rebuild. Přečti runbook celý
i sekce, na které odkazuje, a řiď se jím.

Udělej přestavbu end to end:
1. Inventura a rozhodnutí (etapa 2): tabulka rozhodnutí v issue, jeden řádek na řádek tabulky
   Overlay, a brány kompatibility z etapy 5. Kód začni měnit, až v tabulce nezbývá otevřené
   rozhodnutí.
2. Zachycení starého main: když se main od posledního stable liší mimo docs/, nejdřív preview
   na Ring 0, kontrola v prohlížeči a stable na staré bázi.
3. Candidate, stráže a review (etapy 3 a 4): jeden commit na řádek v pořadí Cílového stacku,
   řádek 5 poslední; lokálně kontraktní test, formát, lint, typecheck a testy overlaye; push
   branche lazurio/rebuild-vX.Y.Z a PR do main, nejdřív jako draft; zelené Lazurio Fork CI na
   přesném headu; review od Stewarda (nebo review agenta jeho Organizace). Pak PR přepni na
   Ready.
4. Kompatibilita (etapa 5): ke každé bráně zapiš do issue, co se mění a jak jsi to ověřil.
5. Výměna main, preview a Ring 0 (etapy 6 a 7) včetně kontroly v prohlížeči.
6. Stable (etapa 8) a test tlačítka Update z předchozího stable; plán dalších vln předlož.
7. Po vydání (etapa 9): runbook a skill oprav všude, kde při přestavbě nesedí.

Mandát (ponech jen, co platí):
- Etapy 6–8 smíš udělat sám. Výměnu main děláš jen přesně podle runbooku na ověřená SHA.
- Schválení vydání v environmentu lazurio-t3code-release smíš udělat mým účtem, vždy jen na
  přesné SHA a verzi, které jsi sám ověřil. Dispatch vydání dělá jiný účet (prevent_self_review).
- Rozhodnutí, která by schvaloval Admin, ber jako schválená tímto zadáním a zapiš je do issue
  se zdůvodněním a zdrojem.
- Na Ring 0 smíš instalovat preview a stable bez souhlasu lidí, kteří ho používají. Než tam
  začneš, domluv se s vlákny, která tam pracují.
- Mimo Ring 0 nic nenasazuj: plán dalších vln mi předlož ke schválení.

Nikdy nemerguj PR přestavby tlačítkem, nevytvářej tagy ani vydání ručně, neměň nastavení
repozitáře, rulesety ani environmenty a nezapínej upstream workflow. Force push smíš jen na
vlastní PR branch s přesným --force-with-lease=<ref>:<sha>. Do kódu, commitů, PR ani issue
nepiš jména klientských Organizací, lidí ani soukromých hostů, jen Environmenty a role.
O přihlášení člověka mě požádej jednou, až ho opravdu potřebuješ.

Na konci mi napiš česky a lidsky, co se změnilo pro lidi na Environmentech: které funkce
overlaye zůstaly, které nahradil upstream a proč, co je ověřené v prohlížeči. K tomu odkazy na
PR, vydání a issue, přesné SHA a verze, plán dalších vln a co zůstává otevřené.
```

Bez odstavce „Mandát“ agent dělá jen etapy 2–5: nepushuje na `main`, nevydává,
nic neschvaluje a skončí Ready PR s přesným headem, odkazem na zelený běh CI a
stavem tabulky rozhodnutí a bran.

## Testování před vydáním

1. **CI.** `Lazurio Fork CI` na PR i na `main` musí být zelené. Běží v něm:
   - hlídání upstream souborů (allowlist), kontrola formátu, lint celého
     repozitáře upstreamovým skriptem a pravidly (`pnpm run lint`), typecheck
     serveru a webu a kontraktní test;
   - testy všeho, co overlay mění: každý testovací soubor, který overlay přidá
     nebo změní, a upstream testy vedle každého souboru, který mění
     (`X.ts` → `X.test.ts`, `X.browser.test.ts` a každý další
     `X.<jméno>.test.ts`, totéž s `.tsx`), každý balíček svým vlastním
     testovacím skriptem. Seznam se odvozuje z diffu proti přesné upstream bázi,
     takže nový šev se otestuje bez úpravy workflow. K tomu pevná brána (`gate`)
     ve stejném kroku: všechny testy v `apps/server/src/auth` (i ty nezměněné
     importují švy overlaye), v obou složkách overlaye, upstream testy projektů
     (`ProjectService.test.ts` jde přes dekorátor spravované složky),
     enginu serverového prohlížeče, který ovládá hostitel prohlížeče
     Environmentu (`ServerBrowserPage.test.ts`), kontrola, že React Compiler
     zkompiluje každý webový soubor včetně overlaye
     (`reactCompilerCoverage.test.ts`), a v souborech, které CI testovala dřív.
     Cesta brány, která zmizí nebo nemá testy, krok shodí; kontraktní test
     hlídá, že brána drží celou starou bránu. Testy overlaye proti skutečnému
     Chromiu přes CDP (`environmentBrowserConnection`, `environmentBrowserPage`)
     se bez `LAZURIO_TEST_DEVTOOLS_ENDPOINT` přeskočí. Webové testy, které
     vykreslují React (`*.browser.test.ts(x)`, #20797), i test enginu běží
     v headless Chromiu (chrome-headless-shell), které CI před testy instaluje;
   - build OCI image a kontrola, že nese `LICENSE` T3 Code a produkční favicon
     upstreamu;
   - `CLI archives`: build obou archivů na nativních runnerech, kontrola jejich
     `LICENSE` a faviconu a `smoke-cli-archive`;
   - `Launcher install linux-x64`: archiv se servíruje přes HTTP v upstream
     layoutu a `t3 update` ho stáhne přes `T3CODE_RELEASE_BASE_URL`, ověří
     `SHA256SUMS`, rozbalí a zkontroluje přesnou verzi. Nainstalovaný runtime
     pak odpoví na `__service-preflight` stavem `ready` se stejnou verzí.
     Tyto dvě brány projde i skutečný Update. Restart samotné služby CI
     neověřuje, protože runner nemá uživatelský service manager.
2. **Lokální smoke** (volitelné; hodí se při ladění buildu). Spusťte v čistém
   worktree na Linux x64 nebo Mac arm64 s `vp` a Rustem:

   ```bash
   VERSION=0.1.2-lazurio.0 KEY=linux-x64 RUST_TARGET=x86_64-unknown-linux-gnu  # Mac: darwin-arm64, aarch64-apple-darwin
   vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/scripts...
   node scripts/update-release-package-versions.ts "$VERSION"
   vp run --filter t3 build
   node scripts/apply-web-brand-assets.ts production apps/server/dist/client
   cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target "$RUST_TARGET"
   node apps/server/scripts/cli.ts build-exe --verbose   # na Node z engines.node, jiný build odmítne
   mkdir -p "$HOME/.cache/t3-rm/$KEY" && cp "native/resource-monitor/target/$RUST_TARGET/release/t3-resource-monitor" "$HOME/.cache/t3-rm/$KEY/"
   node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$VERSION" \
     --resource-monitor-dir "$HOME/.cache/t3-rm" --output-dir release-cli   # Mac: --platform mac --arch arm64
   node scripts/smoke-cli-archive.ts --archive "release-cli/t3-$VERSION-$KEY.tar.gz" --expect-version "$VERSION"
   git checkout -- apps/server/package.json apps/web/package.json apps/desktop/package.json packages/contracts/package.json
   ```

3. **Canary přes preview.** Vydejte preview a nainstalujte ho přes SSH s TTY
   na canary Environmenty pod launcherem: nejdřív Environmenty
   [Ring 0](#ring-0-lazurioexampleorganization), osobní a další Environmenty
   až po akceptaci v prohlížeči na nich. Lokální
   `t3 update` nejde přes launcherův trial ani zálohu databáze (ty má jen
   tlačítko Update, #22), proto na trvalých Environmentech nejdřív zálohujte
   databázi a nastavení (Environmenty pro návštěvníky `try-*` bez zálohy, viz
   Ring 0). Záloha bere každý soubor databáze, který existuje: `statev2.sqlite`
   (živá databáze od v0.1.0) i `state.sqlite` (databáze 0.0.45 a zdroj kopie
   při přechodu na v0.1.0), a k nim `settings.json`:

   ```bash
   # Konzistentní kopie za běhu (SQLite backup API)
   python3 - <<'EOF'
   import os, shutil, sqlite3, time
   userdata = os.path.expanduser("~/.t3/userdata")
   backup = os.path.expanduser("~/.t3/backups/pre-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
   os.makedirs(backup, 0o700)
   for name in ("statev2.sqlite", "state.sqlite"):
       if os.path.exists(os.path.join(userdata, name)):
           source = sqlite3.connect("file:" + os.path.join(userdata, name) + "?mode=ro", uri=True)
           target = sqlite3.connect(os.path.join(backup, name))
           source.backup(target)
           target.close()
           source.close()
   if os.path.exists(os.path.join(userdata, "settings.json")):
       shutil.copy2(os.path.join(userdata, "settings.json"), backup)
   print(backup)
   EOF
   # Od 0.1.0-lazurio.4 bere `t3 update` vydání z Lazurio/t3code i bez proměnné.
   # Na Environmentu s 0.1.0-lazurio.3 a starším ji SSH shell nemá (je jen
   # v drop-inu služby) a bez ní by `t3 update` hledal vydání v pingdotgg/t3code.
   export T3CODE_RELEASE_REPOSITORY=Lazurio/t3code
   ~/.local/bin/t3 update 0.1.1-preview.20261021.1 --yes   # preview potvrďte v terminálu
   ~/.local/bin/t3 --version
   ```

   Souhlas s preview chce vždy terminál (bez TTY ho CLI odmítne); `--yes`
   odpoví jen na dotaz na restart služby, a to kladně. Na nestabilní lince
   spusťte `t3 update` v relaci tmux, ať ho výpadek SSH nepřeruší uprostřed
   instalace, a souhlas pošlete klávesami:

   ```bash
   VERSION=0.1.1-preview.20261021.1
   tmux new-session -d -s t3upd "export T3CODE_RELEASE_REPOSITORY=Lazurio/t3code; ~/.local/bin/t3 update $VERSION --yes; echo T3_UPDATE_EXIT=\$?; sleep 3600"
   tmux capture-pane -p -t t3upd | tail -5   # čekejte na „Install the preview build anyway?“
   tmux send-keys -t t3upd y && tmux send-keys -t t3upd Enter
   tmux capture-pane -p -t t3upd | grep T3_UPDATE_EXIT && tmux kill-session -t t3upd
   ```

   Příkazy Platformy přes SSH (`lazurio chat defaults --apply`) potřebují
   `~/.local/bin` v `PATH` (`export PATH="$HOME/.local/bin:$PATH"`), jinak
   hlásí `t3-launcher-missing`.

   **Když nová verze mění protokol launcheru** (`SERVICE_LAUNCHER_PROTOCOL`
   v `apps/server/src/cloud/serviceProtocol.ts`, např. 2 → 3 mezi v0.0.42
   a v0.0.44), spusťte `t3 update` bez `--yes`, na dotaz na restart odpovězte
   **ne** a službu přepněte novým CLI: `~/.local/bin/t3 service install`.
   Starý CLI by při restartu zapsal stav služby ve starém protokolu a nový
   launcher by ho odmítl („Service state is invalid or unsupported.“). Oprava
   takto shozené služby:
   `~/.local/bin/t3 service install` a `systemctl --user reset-failed
   t3code.service && systemctl --user start t3code.service` (#25).

   Ověřte přesnou verzi, `~/.t3/runtime/service-state.json` (protokol
   a `activeVersion`), přihlášení a pairing přes Launchpad Chat i přímou
   návštěvou Chatu bez sezení, terminál,
   agentní turn (jen na Environmentu s AI; Ring 0 bez AI ho přeskočí a ověří
   ho první Environment s AI), starý i nový thread, upload a download,
   reconnect a restart služby se zachovanými daty. Ověřte také, že Environment na stable preview
   nenabízí (`/.well-known/t3/environment` → `availableServerUpdate`). První
   selhání zastaví rozšiřování.

   U vydání se záložkami vlákna a Novou kartou (F47 krok 4) ověřte v prohlížeči
   (root 0178) na Environmentu s Platformou s kroky 1–3: „+“, Mod+T i prázdný
   panel ukážou Novou kartu v barvách T3; adresa i záložka z Přehledu se stanou
   záložkou vlákna; nástroj otevře povrch T3; druhé zařízení ukáže stejné
   záložky; × s Vrátit (Mod+Shift+T záložku přeskočí) a sdílená záložka proti
   Launchpadu; `preview_open` i
   `lazurio browser window` agenta ukážou své okno; archivace ukončí jen záložky
   toho vlákna, po 8 s; SSE projde bránou Environmentu; nové vlákno před první
   zprávou ukáže větu o prohlížeči a po ní Novou kartu bez obnovení stránky.

   U vydání se jménem a vzhledem (rozhodnutí 0200) ověřte v prohlížeči na
   Environmentu s Platformou, jejíž shell deklaruje tokeny: titulek záložky
   a štítek vedle wordmarku říkají „T3 Code (Lazurio)“ i v preview; světlý
   vzhled je design systém (bílé plochy, papírový sidebar a rail jako jedna
   plocha, černá tlačítka, Inter Tight) a čtou se v něm nabídky, diff
   a terminál; tmavý režim a vybraný motiv jsou T3; kontrast 50 a 200 mění
   barvy textu a linek; přepínač Chat · Apps · Automate má aktivní záložku
   odlišenou od dráhy; česká diakritika v řádcích sidebaru se neořízne. Na
   Environmentu se starší Platformou vypadá T3 jako upstream.

   U vydání s nástrojem na otázky (rozhodnutí 0211, řádek 22) ověřte, že proces
   `codex … app-server` (`ps -o args= -u "$USER" | grep '[a]pp-server'`) má
   v argumentech `-c features.default_mode_request_user_input=true` (stačí
   jedno vlákno Codexu). Dokud Ring 0 nemá AI (poskytovatele záměrně nemá),
   kontrola vydání tam končí tímto spuštěním app-serveru s přepínačem,
   nezměněným stavem poskytovatelů bez nové chyby startu a fungujícím CLI
   a prohlížečem. Živý tah Codexu s otázkou `request_user_input` pak proběhne
   po Ring 0 na trvalém Environmentu s AI, na osobním Environmentu Admina s jeho
   souhlasem: ve vlákně Codexu v režimu Default požádejte o práci, která skončí
   rozhodnutím, třeba o Publikaci. Agent se zeptá v panelu otázek s volbami bez
   doporučené a vlákno na odpověď čeká, `t3 request list` otázku ukáže,
   `t3 request respond` ji zodpoví a tah pokračuje. Jakmile Ring 0 dostane
   poskytovatele, živý tah s otázkou se ověřuje znovu na něm.

   U vydání s řádkem 23 (Buddyho T3 Code) se Hermesův prompt ověřuje jen tam, kde Machines
   spouští Buddyho T3 Code. Pošlete Buddymu zprávu z bubliny a v Hermesově sezení ACP (state.db
   v `HERMES_HOME`) zkontrolujte, že zpráva člověka nese jen jeho text a blok „Kontext stránky“,
   bez `<t3_code_instructions>`, `<runtime_info>` a `<pull_request_linking>`, i po Stop a po
   restartu služby. Přepněte pod composerem Rychlý a pošlete další zprávu: Hermesovo sezení
   přejde na rychlý tier a model i úsilí zůstanou ty z profilu Platformy. Ostatní Environmenty
   řádek nemění.

   U vydání s řádkem 28 pošlete Buddymu z bubliny prosbu, kterou splní nástrojem: za běhu tahu
   stojí pod ní jen „Buddy na tom pracuje…“ a po tahu jen Buddyho odpověď, nad composerem nestojí
   nic z jeho práce a pole zprávy říká „Napište Buddymu…“ (na anglické stránce „Message Buddy…“).
   Pod composerem není výběr modelu, úsilí, přístupu („Full access“) ani režimu („Default“), jen
   přepínač Normální / Rychlý, nabízí-li Hermes volbu `fast`; Rychlý se projeví v Hermesově
   sezení s další zprávou. Přepněte vzhled stránky hostitele mezi světlým a tmavým: povrch
   v bublině ho následuje.

4. **Stable a tlačítko Update.** Stable vydejte ze stejného commitu až po
   zeleném canary a výslovném souhlasu Admina. Canary Environmenty vraťte
   z preview (se stejnou proměnnou, kde ji potřebuje, viz krok 3):
   `t3 update --channel stable --allow-downgrade` (bez `--allow-downgrade` je
   to odmítnuté, SemVer řadí `-lazurio.N` pod `-preview.…`). Environmenty na
   předchozím stable ukážou banner Update po příští kontrole kanálu (při
   startu a každých 6 hodin). Tlačítko projde trialem launcheru a zálohou
   databáze, **jen když má Environment launcher se stejným protokolem, jaký
   nová verze vyžaduje**. Jinak preflight update bezpečně odmítne („This
   release requires a newer T3 Code service launcher“) a Environment je
   potřeba jednou převést lokálně (postup výše) nebo zvýšením pinu
   v Machines, které instalují přes `t3 service install`.

## Spuštění vydání

Vydání se spouští jen z `main` a jen z commitu, který je právě na jeho špičce:

```bash
VERSION=0.1.1-preview.20261021.1   # nebo stable 0.1.1-lazurio.1
SOURCE_SHA="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
# Báze zdroje z jeho lazurio-fork-ci.yml. Workflow ověří, že tag i commit se s ní
# shodují a že tag u upstreamu míří na ten commit (#69).
CI="$(gh api "repos/Lazurio/t3code/contents/.github/workflows/lazurio-fork-ci.yml?ref=$SOURCE_SHA" \
  -H 'Accept: application/vnd.github.raw')"
UPSTREAM_TAG="$(sed -n 's/^  UPSTREAM_TAG: //p' <<<"$CI")"
UPSTREAM_SHA="$(sed -n 's/^  UPSTREAM_SHA: //p' <<<"$CI")"

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
     `main`. Když se `main` mezitím posunul, skončí a nic nepublikuje; spusťte
     vydání znovu s novou špičkou;
   - napíše `SHA256SUMS` a attestuje každý archiv zvlášť;
   - postaví, pushne a attestuje `ghcr.io/lazurio/t3code:<verze>` s OCI štítky
     distribuce a ověří, že publikovaný image nese `LICENSE` a produkční
     favicon;
   - vytvoří tag `v<verze>` na `source_sha` tokenem release App (API odmítne
     existující tag);
   - publikuje GitHub Release `Lazurio T3 Code v<verze>`: stable jako
     `latest`, preview jako pre-release, které `latest` nikdy není (workflow to
     po publikaci ověří).

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
jediný repozitář `t3code`. App na další repozitáře nepřidávejte a do bypassu
rulesetu nepřidávejte jiného aktéra.

## Schválení

Když jsou první dva kroky zelené, požádejte Admina o schválení a pošlete mu
odkaz na běh. Admin ho schválí v GitHubu (běh → Review deployments →
`lazurio-t3code-release` → Approve). Jediný povinný schvalovatel environmentu je
Organization Admin, takže bez jeho schválení vydání nevyjde. Environment má
`prevent_self_review`: vydání proto spouštíte vy, ne Admin, protože vlastní běh
by schválit nemohl. Totéž platí pro Task Agenta, který podle mandátu ze
[zadání](#zadání-pro-task-agenta) schvaluje účtem Admina: vydání pak spustí jiný
účet (Steward) a agent ho schválí, vždy jen na přesném SHA a verzi, které sám
ověřil. Pokud si vydání rozmyslíte, Admin ho odmítne (Reject) a nic se
nepublikuje.

## Ověření publikovaného vydání

```bash
VERSION=0.1.1-preview.20261021.1
mkdir -p "/tmp/t3-$VERSION" && cd "/tmp/t3-$VERSION"
gh release download "v$VERSION" --repo Lazurio/t3code
sha256sum --check SHA256SUMS            # macOS: shasum -a 256 --check SHA256SUMS
gh attestation verify "t3-$VERSION-linux-x64.tar.gz" --repo Lazurio/t3code
gh attestation verify "t3-$VERSION-darwin-arm64.tar.gz" --repo Lazurio/t3code
gh attestation verify "oci://ghcr.io/lazurio/t3code:$VERSION" --repo Lazurio/t3code
gh release view "v$VERSION" --repo Lazurio/t3code --json tagName,isPrerelease
gh api repos/Lazurio/t3code/releases/latest --jq .tag_name   # preview tu nikdy není
tar -tzf "t3-$VERSION-linux-x64.tar.gz" | grep -Fx "t3-$VERSION-linux-x64/LICENSE"
```

Pak proveďte Update na canary Environmentu (viz
[Testování před vydáním](#testování-před-vydáním)).

## Desktop a mobil proti serveru z forku

Oficiální desktop a mobilní aplikace jsou neupravený upstream a o našem kanálu
nevědí:

- **Desktop** porovnává s verzí serveru jen `X.Y.Z`. Desktop `0.1.1` proti
  serveru `0.1.1-lazurio.N` (nebo preview `0.1.1-preview.…`) nic nenabízí.
  Proti serveru se starším `X.Y.Z` (`0.1.0-lazurio.N`) nabídne aktualizaci na
  svou verzi; server pak hledá `v0.1.1` v `Lazurio/t3code`, kde není, a skončí
  hláškou, že verze v kanálu není publikovaná („t3@0.1.1 is not published in
  Lazurio/t3code releases.“). Server se nezmění. Totéž nastane, když se desktop
  sám aktualizuje na novější upstream dřív, než vydáme refresh; stejně skončí
  i jeho hromadné „update everything“ (#18053), které míří na verzi z npm.
- **Mobil** („Check for updates“) čte index `pingdotgg/t3code` a nabídne
  nejnovější upstream verzi kanálu serveru. Server ji v našem kanálu nenajde
  a skončí stejnou hláškou.

**Když nová upstream báze mění orchestrační protokol**
(`ORCHESTRATION_PROTOCOL_VERSION` v `packages/contracts/src/environment.ts`;
0.0.45 má 1, v0.1.0 i v0.1.1 mají 2), aplikace a server různých protokolů se
nespojí vůbec. Server nového protokolu odmítne WebSocket aplikace se starším
protokolem (HTTP 426) a aplikace nového protokolu se k serveru se starším
nepřipojí a hlásí, že T3 Code na serveru potřebuje aktualizaci. Protokolem 2
mluví desktop od 0.1.0 a mobilní aplikace od 2.0. Oficiální aplikace se na nové
upstream vydání aktualizují dřív, než vyjde přestavba, a k Environmentům na
staré bázi se do té doby nepřipojí. Proto přestavbu začínejte hned (etapa 1 v
[Nové stabilní vydání upstreamu](#nové-stabilní-vydání-upstreamu)), lidem
změnu oznamte předem a po Update ve webové T3 aktualizujte i aplikace a znovu
je spárujte.

Ověřeno 2026-09-30 (DEV-6633): desktop 0.0.44 proti serveru
`0.0.44-preview.…` nic nenabídl. Podrobnosti a stav v #26.

Pořadí pro operátory proto je: nejdřív Update ve webové T3 v Environmentu
(tlačítko nabízí jen vydání našeho kanálu), potom aktualizace desktopu.
Nabídku z desktopu nebo mobilu na upstream verzi ignorujte.

## Rollback

Tlačítkem se na nižší verzi vrátit nedá. Rollback je vždy nové, vyšší vydání:
opravte chybu (nebo revertujte commit) na `main` a vydejte další
`-lazurio.N`, během canary další preview.

Nouzové cesty, když T3 na Environmentu nenaběhne a na opravu se nedá čekat.
Žádná z nich zatím nebyla živě vyzkoušená. Agenti a terminály běží od v0.1.0
mimo službu (`app-t3code-agents.slice`), proto se zastavují zvlášť.

- **Předchozí verze stejné báze nebo z v0.1.1 zpět na v0.1.0.** Pokud mezitím
  proběhly nové migrace databáze (starší server nemá down migrace) nebo se mění
  protokol launcheru, nesmí starší server naběhnout dřív, než je databáze
  obnovená a stav služby zapsaný jeho CLI. Od v0.1.0 je databází
  `statev2.sqlite`, na 0.0.45 `state.sqlite`. Z v0.1.1 na v0.1.0 by podle kódu
  šlo i bez obnovy (v0.1.0 migrace 063–067 nezná a jen je zaloguje), ověřené je
  to ale jen čtením:

  ```bash
  export T3CODE_RELEASE_REPOSITORY=Lazurio/t3code   # jen pro t3 0.1.0-lazurio.3 a starší
  ~/.local/bin/t3 update <předchozí verze> --allow-downgrade   # restart: ne
  systemctl --user stop t3code.service app-t3code-agents.slice
  cp ~/.t3/backups/<záloha>/statev2.sqlite ~/.t3/userdata/statev2.sqlite
  rm -f ~/.t3/userdata/statev2.sqlite-wal ~/.t3/userdata/statev2.sqlite-shm
  ~/.local/bin/t3 service install   # CLI předchozí verze zapíše svůj protokol a službu spustí
  ```

  Data vzniklá po záloze se tím ztratí.

- **Z v0.1.0 zpět na 0.0.45.** 0.0.45 čte `state.sqlite`, který v0.1.0
  nemění, takže Environment přistane na stavu z okamžiku aktualizace.
  `statev2.sqlite` odsuňte (nikdy nemažte): další Update na v0.1.0 by jinak
  pokračoval z něj místo nové kopie.

  ```bash
  export T3CODE_RELEASE_REPOSITORY=Lazurio/t3code   # jen pro t3 0.1.0-lazurio.3 a starší
  ~/.local/bin/t3 update 0.0.45-lazurio.<N> --allow-downgrade   # restart: ne
  systemctl --user stop t3code.service app-t3code-agents.slice
  aside=~/.t3/backups/statev2-$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -m 700 "$aside" && mv ~/.t3/userdata/statev2.sqlite* "$aside"/
  ~/.local/bin/t3 service install
  ```

  Když 0.0.45 nastavení nepřečte (v logu služby „failed to parse
  settings.json, using defaults“), vraťte `settings.json` ze zálohy.
  `state.sqlite` obnovte ze zálohy, jen když ho po aktualizaci změnilo něco
  jiného. Ztratí se práce z období v0.1.0 (zůstane v odsunutém
  `statev2.sqlite`) a spárování z něj: prohlížeče spárované na v0.1.0 budou
  odhlášené. Kdo tu práci chce zpět, vrátí odsunutý soubor před dalším Update
  na v0.1.0, a přijde tím o práci z období 0.0.45.

- **Po vráceném Update na v0.1.0** (trial launcheru nestihl nebo selhal
  a Environment běží dál na 0.0.45) odsuňte `statev2.sqlite*` stejně, než
  Update zkusíte znovu. Launcher obnoví jen `state.sqlite` a další pokus by
  jinak začal ze zastaralé kopie prvního pokusu, bez práce z mezidobí.

- canary Environment z preview vrátit
  `t3 update --channel stable --allow-downgrade`.

Pin T3 v Machines je minimum: Environment s vyšší verzí nevrátí.

## Co nedělat

- Publikované vydání, jeho assety ani tag nikdy nemažte a nepřepisujte. Chybné
  vydání nahradí vyšší verze.
- Nepublikujte vydání ručně (`gh release create`). Tag `v*-lazurio.*` ani
  `v*-preview.*` ručně vytvořit nejde; kanál plní jen workflow.
- Nepoužívejte release App mimo workflow a její privátní klíč nikam
  nekopírujte.
- Nespoléhejte na příznak pre-release: servery ho neskryjí. Canary drží jen
  preview tvar verze.
- Nepushujte na `main` s force mimo [výměnu `main`](#6-výměna-main).
- PR přestavby nemergujte tlačítkem: `main` nahradí jen výměna.
- Nespouštějte upstream workflow (`release.yml` a další) a nezapínejte je.

## Hranice automatizace

Upstream workflow soubory zůstávají ve stromu, aby refresh zůstal bez diffu, ale
v nastavení Actions tohoto repozitáře jsou **vypnuté**. Potřebují Blacksmith
runnery a upstream secrets, takže odsud publikovat nemohou. Zapnuté by jen
visely ve frontě nebo padaly a `release.yml` by reagoval na tagy `v*`. Když
přestavba přinese nový upstream workflow, vypněte ho hned po výměně `main`
(přestavba na v0.1.0 přinesla `mobile-android-apk.yml`, který cron spouští
každou hodinu):

```bash
gh workflow list --repo Lazurio/t3code --all --json id,path,state \
  | jq -r '.[] | select(.path | test("lazurio-") | not) | select(.state == "active") | .id' \
  | xargs -n1 gh workflow disable --repo Lazurio/t3code
```

Nový upstream workflow s triggerem `pull_request` se může spustit už na PR
přestavby. Bez Blacksmith runnerů a upstream secrets jen visí ve frontě nebo
selže; povinným checkem není.

Aktivní zůstávají jen workflow Lazuria:

- `lazurio-fork-ci.yml`: read-only CI, povinný check
  `Server and web compatibility`;
- `lazurio-cli-archives.yml`: build archivů, volaný z CI a z vydání;
- `lazurio-release.yml`: vydání, spouštěné ručně a schvalované Adminem;
- `lazurio-upstream-watch.yml`: denní porovnání s upstreamem (etapa
  [Sledování](#1-sledování)). Čte jen veřejná vydání upstreamu a soubory
  `main` a zapisuje jen issues tohoto repozitáře, tokenem `GITHUB_TOKEN`
  s oprávněním `issues: write`. Nic nepřestavuje, netaguje ani nevydává:
  přestavbu, výměnu `main` a vydání dělají lidé.

## Historie

Do září 2026 vycházely jen OCI image pod tagy `lazurio-vX.Y.Z-rN`, bez CLI
archivů. Tyto tagy a vydání zůstávají jako neměnný archiv. Launcher je
ignoruje, protože tagy nezačínají na `v`. Nové verze je nepoužívají.
