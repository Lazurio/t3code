# Lazurio T3 Code: vydávání

Runbook pro vlastníka vydávání T3 Code v Lazuriu (Steward). Vydání připravíte,
otestujete a spustíte sami; Organization Admin ho jen schválí v GitHub
environmentu.

`Lazurio/t3code` je distribuce **Lazurio T3 Code** (rozhodnutí 0200), upravená
distribuce T3 Code pro Environmenty Lazuria: server a web klient přesného
upstream stable vydání a nad nimi overlay Lazuria. Overlay chování T3 Code mění:
hostované nastavení, aktualizace z kanálu Lazuria, zadání z Launchpadu, slot pro
shell Lazuria, prohlížeč Environmentu, spravovaná složka Lazuria, jméno
v aplikaci, vzhled na Environmentu a přihlášení poskytovatelů přes Lazurio. Co
přesně a ve kterých souborech, říká
[Overlay](#overlay); podrobnou specifikaci prohlížeče Environmentu drží
[specifikace overlaye](./lazurio-overlay.md). T3 vždy běží
v kořeni vlastního hostname (`https://t3code.<vm>.<org>.lazurio.io/`) za TLS
reverse proxy. Oficiální desktop a mobilní aplikace se připojují jako
neupravení upstream klienti. Značka T3 Code zůstává. Do UI webového klienta
zasahuje slot pro shell Lazuria (viz [Lazurio shell](#lazurio-shell)),
prohlížeč Environmentu v pravém panelu, uvítání spravované složky Lazuria,
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
`<base>/v<verze>/t3-<verze>-<platforma>.tar.gz`. Mašina míří na náš kanál
jedinou proměnnou `T3CODE_RELEASE_REPOSITORY=Lazurio/t3code` v drop-inu služby:
podle ní server čte index vydání, ukazuje banner a stahuje z
`https://github.com/Lazurio/t3code/releases/download`. `T3CODE_RELEASE_BASE_URL`
je jen pro zrcadlo a Machines ho nenastavují.

Publikace nikoho automaticky nepřepne. Mašina přejde na novou verzi, až
uživatel klikne na Update, nebo až někdo spustí `t3 update`.

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
`0.0.45-lazurio.8` jde vydat i po `0.0.45-preview.20261012.5`.

SemVer řadí `X.Y.Z-lazurio.N` pod `X.Y.Z-preview.…` (`lazurio` < `preview`)
a obojí pod samotné upstream `X.Y.Z`. Z preview na stable proto vede jen výslovný
návrat `t3 update --channel stable --allow-downgrade`; tlačítko ho nenabídne.

Ze stejného důvodu je `0.0.45-lazurio.1` nižší než upstream `0.0.45`. Mašinu,
která běží na upstream buildu se stejným `X.Y.Z`, tlačítko na náš kanál
nepřevede. Poprvé ji převeďte pinem v Machines nebo
`t3 update 0.0.45-lazurio.<N> --allow-downgrade`; další vydání už tlačítko
nabídne normálně.

## Overlay

`main` je přesný upstream stable tag a nad ním jen commity overlaye. Tabulka je
cílový stack: jeden commit na řádek, jak ho přehraje příští přestavba (viz
[Přestavba candidate](#3-přestavba-candidate)). Dnešní commity každého řádku a
jeho soubory uvádí [Cílový stack](#cílový-stack). Sloupec „Upstream a
přestavba“ říká, proč řádek zůstává a co z něj podle upstream `main` k
2026-10-12 při přestavbě na 0.0.46 odpadne.

| #   | Commit                                                                                          | Proč ho Lazurio potřebuje                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Upstream a přestavba                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `hosted: configurable client session TTL`                                                       | `T3CODE_CLIENT_SESSION_TTL` (Machines nastavuje `365d`).                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Upstream má pevných 30 dní: zůstává.                                                                                                                                                                                                                                                                                                |
| 2   | `hosted: serve behind an explicit HTTPS external origin`                                        | `T3CODE_EXTERNAL_ORIGIN`: server na loopbacku za proxy je dosažitelný zvenku, používá Secure cookie `__Host-t3_session` a mutace a WebSocket upgrady autentizované cookie přijímá jen z tohoto originu.                                                                                                                                                                                                                                                                                                             | Upstream ekvivalent nemá. Upstream `main` kontroluje Origin sám (#18509): kontrola odpadne, proměnná, Secure `__Host-` cookie a politika loopbacku zůstanou.                                                                                                                                                                        |
| 3   | `hosted: explicit environment label`                                                            | `T3CODE_ENVIRONMENT_LABEL` pojmenuje kontejnerový Workspace (například `Acme / Management`).                                                                                                                                                                                                                                                                                                                                                                                                                        | Upstream čte jen `PRETTY_HOSTNAME` a hostname, Machines nastavují proměnnou: zůstává.                                                                                                                                                                                                                                               |
| 4   | `feat: in-app update from the configured release channel`                                       | `T3CODE_RELEASE_REPOSITORY` a server-advertised `availableServerUpdate`: Mašina nabízí aktualizaci na nejvyšší vydání z nastaveného repozitáře a instaluje ho tlačítkem Update. Navrženo upstreamu.                                                                                                                                                                                                                                                                                                                 | Upstream má pevné `pingdotgg/t3code` a bere první vydání kanálu: zůstává celý.                                                                                                                                                                                                                                                      |
| 5   | `release: Lazurio distribution`                                                                 | Tento runbook, [specifikace overlaye](./lazurio-overlay.md), `Dockerfile.lazurio`, `.dockerignore`, kontraktní test a workflow `lazurio-fork-ci.yml`, `lazurio-cli-archives.yml`, `lazurio-release.yml` (včetně preview vydání pro canary, `X.Y.Z-preview.YYYYMMDD.N` jako GitHub pre-release) a `lazurio-upstream-watch.yml`, formulář issue, `.github/README.md` a bezpečnostní politika `.github/SECURITY.md`. Jméno distribuce nesou vydání, image, formulář a README (rozhodnutí 0200).                        | Zůstává; v přestavbě jde poslední.                                                                                                                                                                                                                                                                                                  |
| 6   | `lazurio: unsent prompt draft by link from the shell`                                           | „+ Nový modul“ otevře Chat se zadáním v poli zprávy nového vlákna, neodeslaným ([Zadání z Launchpadu](#zadání-z-launchpadu)).                                                                                                                                                                                                                                                                                                                                                                                       | Upstream `main` přidává odkazy `/new?prompt=` (#18454), které nesou text v adrese a projekt vybírají podle `repo`. Odkaz overlaye text nenese: zůstává vedle nich.                                                                                                                                                                  |
| 7   | `feat(web): Lazurio shell slot`                                                                 | Slot pro shell Lazuria ve webovém klientovi: načtení `/.lazurio/shell.js`, rail vedle aplikace, hlavička sloupce nahoře v sidebaru a Buddy (viz [Lazurio shell](#lazurio-shell)). Mimo Lazurio se nic nevykreslí.                                                                                                                                                                                                                                                                                                   | Upstream ekvivalent nemá: zůstává.                                                                                                                                                                                                                                                                                                  |
| 8   | `feat(server): each thread's provider processes get its agent-browser session`                  | Každý proces poskytovatele, který T3 spustí pro vlákno, dostane `AGENT_BROWSER_SESSION=t3-<id vlákna>`: agenti vlákna pracují ve vlastním okně prohlížeče Environmentu (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)).                                                                                                                                                                                                                                                                                     | Rozhodnutí 0191; upstream ekvivalent nemá. Upstream `main` maže `ProviderService.ts`: šev se přestaví na `AgentScope.wrap` nebo v adaptérech, s testem pro Codex i Claude.                                                                                                                                                          |
| 9   | `feat(web): the right panel shows the thread's Environment browser tabs`                        | Webový klient nemá vlastní prohlížeč. Pravý panel ukazuje záložky prohlížeče Environmentu, které vlákno drží, podle seznamu serveru, na každém zařízení stejné. Nad pohledem není hlavička, jedinou lištou je lišta pohledu; menu záložky přidá Open in new tab a Reload. × záložku pro vlákno pustí s možností Vrátit a panel se sám otevře, když agent záložku ukáže (viz [Prohlížeč Environmentu](#prohlížeč-environmentu)).                                                                                     | Rozhodnutí 0191, F47; webové UI prohlížeč nemá, tohle je zdokumentovaný minimální zásah do UI. Švy se na 0.0.46 posunou a upstream znovuotevření zavřené záložky musí tyto povrchy přeskočit.                                                                                                                                       |
| 10  | `feat(server): T3's browser tools drive the Environment browser`                                | Nástroje prohlížeče T3 (`preview_open`, `preview_snapshot`, …) ovládají prohlížeč Environmentu i ve webovém T3. Záložku, kterou otevřou nebo převezmou, přidají do záložek vlákna a pohled jiného Environmentu pošlou webu jako živou událost. Spolu s ním porty serverového prohlížeče upstreamu (#15328, ac8e9453c), převzaté ve stavu upstream `main` 611132c1: preferovaný host v brokeru, vysvětlení chyb preferovaného hostitele, ARIA strom pro agenta, `playwright-core` vedle CLI bundlu a engine stránky. | Rozhodnutí 0191. Port ARIA stromu a `playwright-core` odpadnou (upstream je má), preferovaný host se zúží na přednost před desktopem a 60 s pro `open`, engine stránky použije upstream `ServerBrowserPage`. Co s druhým preferovaným hostem, serverovým prohlížečem upstreamu, rozhodne Admin před přestavbou (Lazurio/t3code#43). |
| 11  | `feat(server): a thread's Environment browser tabs live in its holder file`                     | Záložky vlákna žijí v jeho souboru držitele, který čte hub pohledu. Server je srovnává s hubovým seznamem živých záložek na hodinách bootu, podává je webu cestou `/api/lazurio/thread-tabs` se SSE a přidává do nich záložky z `preview_open` a z nové vazby sezení agent-browser vlákna.                                                                                                                                                                                                                          | F47; na 0.0.46 se přesune jen řádek v `server.ts` (`layerMakeRoutes`).                                                                                                                                                                                                                                                              |
| 12  | `feat(server): archiving or deleting a thread lets go of its tabs and stops its agent's daemon` | Archivace i smazání vlákna smaže jeho soubor držitele a zastaví démona agent-browser vlákna; při startu totéž pro vlákna, která už nežijí.                                                                                                                                                                                                                                                                                                                                                                          | Rozhodnutí Admina 2026-10-11, F47; na 0.0.46 adaptér přejde na `OrchestratorV2.streamDomainEvents`.                                                                                                                                                                                                                                 |
| 13  | `feat(web): "+" and the empty panel open Nová karta`                                            | Kde shell Environmentu definuje `<lazurio-new-tab>`, otevře „+“ záložku Nová karta a prázdný panel ukáže Novou kartu s upstream akcemi „+“ jako nástroji.                                                                                                                                                                                                                                                                                                                                                           | F47 bod 10. Na 0.0.46 upstream ukazuje „+“ při každém otevřeném panelu a Mod+T otevírá nabídku: obojí potřebuje větev. Odpadne, až upstream nabídne bod rozšíření „+“.                                                                                                                                                              |
| 14  | `feat(web): reorder right panel tabs by dragging (#17730)`                                      | Backport upstream 410793042: záložky pravého panelu jde přetahovat, povrchy overlaye stejně jako ostatní.                                                                                                                                                                                                                                                                                                                                                                                                           | Odpadne: upstream ho má na `main` (od nightly 0.0.46).                                                                                                                                                                                                                                                                              |
| 15  | `feat(lazurio): provide a managed Folder project and native model reconciliation`               | S `T3CODE_LAZURIO_FOLDER` začíná Chat ve složce Lazuria daného Environmentu a `t3 lazurio` srovnává doporučený model Platformy (viz [Spravovaná složka Lazuria](#spravovaná-složka-lazuria)).                                                                                                                                                                                                                                                                                                                       | F51; upstream ekvivalent nemá. Na 0.0.46 se převzetí složky přesune do `ProjectService.bootstrap` a stráž příkazů na vstupy orchestrace v2: přestavba.                                                                                                                                                                              |
| 16  | `feat(web): the in-app name T3 Code (Lazurio)`                                                  | Rozhodnutí 0200 bod 2: v aplikaci se T3 Code jmenuje „T3 Code (Lazurio)“, vedle wordmarku stojí štítek „Lazurio“ a náhledová vydání se nejmenují „Nightly“ (viz [Jméno a vzhled](#jméno-a-vzhled)).                                                                                                                                                                                                                                                                                                                 | Upstream ekvivalent nemá, štítek fáze je konstanta buildu: zůstává. Při přestavbě ověřte, že upstream nezměnil tvar verze náhledů ani místo pilulky vedle wordmarku.                                                                                                                                                                |
| 17  | `feat(web): the design system's light look on a Lazurio Environment`                            | Rozhodnutí 0200 bod 4: ve standardním světlém vzhledu bere webový klient barvy, písmo a zaoblení design systému z tokenů `--lz-*`, které deklaruje shell Environmentu (LazurioPlatform F36). Jeden soubor `apps/web/src/lazurio/theme.css` a import v `main.tsx`; bez shellu se nepoužije nic (viz [Jméno a vzhled](#jméno-a-vzhled)).                                                                                                                                                                              | Motivy Environmentu upstreamu (`t3 theme set`) dají jen barvy, při každém načtení bliknou a resetují volbu člověka: zůstává. Kontraktní test hlídá, že mapované tokeny `index.css` deklaruje ve stejném scope.                                                                                                                      |
| 18  | `feat(lazurio): providers sign in through Lazurio, and the Launchpad turns them on`             | Rozhodnutí 0201 bod 4 (Lazurio/t3code#46): s `T3CODE_LAZURIO_FOLDER` se Codex a Claude přihlašují svými CLI ze stránky Začínáme Launchpadu (`T3CODE_LAZURIO_TOOLS_URL`). Web tam, kde nabízel vlastní „Continue with ChatGPT“, odkáže na Začínáme, server vlastní přihlášení Codexu v T3 odmítne pro každého klienta a `t3 lazurio providers` poskytovatele zapne a hned znovu načte (viz [Přihlášení přes Lazurio](#přihlášení-přes-lazurio)).                                                                     | Upstream ekvivalent nemá. Při přestavbě ověřte, že upstream nepřidal další vstup do vlastního přihlášení Codexu (nová tlačítka, MCP nástroj) mimo `ProviderAuthService.start` a `importProfile`.                                                                                                                                    |

Hostované proměnné a spravovaná složka platí, jen když jsou nastavené, a shell,
prohlížeč Environmentu, Nová karta a vzhled design systému se ukážou, jen když je
Environment nabízí. Bez ohledu na to platí tři věci: server pod launcherem
kontroluje vydání svého kanálu (vypne to `T3CODE_UPDATE_CHECK_ENABLED=false`),
procesy poskytovatelů dostávají `AGENT_BROWSER_SESSION`, které nic nepovoluje,
a build distribuce se v aplikaci jmenuje „T3 Code (Lazurio)“. Řádek odeberte,
jakmile upstream nabídne ekvivalent. Upstream soubory pod `apps/`, `packages/`
a `scripts/` overlay mění
jen v přesných souborech z allowlistu `allowed_upstream_changes` v
`lazurio-fork-ci.yml`. Allowlist je seskupený podle funkce, které soubor patří,
a soubory, které mění víc funkcí, má v jedné skupině společných švů. Každý
záznam je vědomé rozhodnutí se zdůvodněním; jakoukoli jinou změnu pod těmito
cestami CI odmítne. Vlastní složky overlaye `apps/*/src/lazurio/`, které upstream
nemá, projdou celé. Overlay mění i wire kontrakty, ve třech souborech
`packages/contracts` a jen o volitelná pole. Verze se razítkují jen při buildu
upstream skriptem `scripts/update-release-package-versions.ts`, do Gitu se
necommitují.

### Cílový stack

Příští přestavba přehraje overlay jako jeden commit na řádek tabulky, s jeho
předmětem a v jeho pořadí, jen řádek 5 jde poslední. U každého řádku jsou
commity, které k němu na `main` patří (stav k d2156a2a0), a soubory, které jeho
commit mění.

- Soubory distribuce (`.dockerignore`, `Dockerfile.lazurio`,
  `.github/workflows/lazurio-*.yml`, `.github/ISSUE_TEMPLATE/1-lazurio-t3-code.yml`,
  `.github/README.md`, `.github/SECURITY.md`, `docs/operations/lazurio-*.md` a
  `scripts/lazurio-release-contract.test.mjs`)
  patří celé řádku 5. Jejich konečný stav (allowlist, švy v kontraktním testu,
  tento runbook) popisuje všechny řádky, proto řádek 5 jde poslední.
- Commit, který mění jen soubory distribuce, patří řádku 5. Commit, který mění i
  jiné soubory, patří řádku těch souborů a jeho změny souborů distribuce
  přejdou do řádku 5. Pozdější commity se řadí stejně, podle souborů.
- Soubor označený \* mění víc řádků. Každý řádek si vezme své změny; kde je
  oddělit nejde, vezme soubor celý první řádek, který ho mění. CI musí projít
  jen hlava candidate branch.

1. 344ba7c42. `apps/server/src/auth/SessionStore.ts`\* a jeho test,
   `apps/server/src/cli/config.ts`\* a `config.test.ts`\*,
   `apps/server/src/config.ts`\*.
2. 4e853c5cd. `apps/server/src/auth/`: `EnvironmentAuth.ts` a
   `EnvironmentAuthPolicy.ts` s testy, `SessionStore.ts`\*, `http.ts`,
   `utils.ts`; `apps/server/src/cli/config.ts`\* a `config.test.ts`\*,
   `apps/server/src/config.ts`\*, `apps/server/src/server.test.ts`.
3. de42efcb5, 96a87f066. `apps/server/src/environment/ServerEnvironmentLabel.ts`
   a jeho test.
4. 86352a95b. Server: `cli/update.ts`, `cloud/bootService.ts`,
   `cloud/pinnedRuntime.ts`, `cloud/releaseIndex.ts` a `cloud/selfUpdate.ts`
   s testy, `environment/ServerEnvironment.ts` a jeho test. Web:
   `components/ChatView.tsx`\* (banner aktualizace),
   `components/chat/useAutoBalanceUpdateBanner.tsx`,
   `components/settings/ConnectionsSettings.tsx`, `versionSkew.ts` a jeho test.
   `packages/contracts/src/environment.ts`, `packages/shared/src/cliRelease.ts`
   a jeho test, `scripts/install.sh`, `scripts/install.ps1`,
   `scripts/install-scripts.test.ts`, `docs/user/updating.md`,
   `docs/user/background-service.md`.
5. 4fa74fa1c, 86cf9d93a (preview pro canary); docs 4cd91ceca, 79eb9c95d,
   77b88dd53, e0c5b1927, 7200b04ff, 9e0795d0f, cfe97431e, 97d1b3668, a0e4479f4,
   f5fc40194, c2dd83504, 830f4a4e5, b122de46c, d2156a2a0; test 9b6f3fba0, e22e37ddf,
   8f43969d8, fea295e3f, f8c831bd5, 041391a86. Soubory distribuce.
6. 9c3b3e8e8, 6df0dfa00. `apps/web/src/main.tsx`\*, `apps/web/src/routes/_chat.tsx`,
   `apps/web/src/lazurio/`: `LazurioPromptDraft.tsx`, `promptDraft.ts` a jeho
   test.
7. 1e4cf23d6, 47c8f9713. `apps/web/index.html`\*,
   `apps/web/src/components/AppSidebarLayout.tsx`.
8. 2968ed2ac, 5998ed586, f9d8ab6e2, 2d37d1423.
   `apps/server/src/provider/Layers/ProviderService.ts`,
   `apps/server/src/lazurio/agentBrowserSession.ts` a jeho test.
9. 25529ed69, 0226905a8, 27f182e66, 23bbc9eb2, b5c94d28f, e180feb1a, 5b59988e7,
   125780bdd, 36d48686d, 6dfad6e81, 8f6100212, 795005201, a4d50406b, aa6e55bf2,
   51d019359, ebaedfc75. `apps/web/src/components/ChatView.tsx`\* (volání háčku,
   obal rámů), `RightPanelTabs.tsx`\* (název, ikona, tooltip a menu záložky,
   volání háčku, řádek konceptu),
   `apps/web/src/rightPanelStore.ts`\* (druh povrchu, jeho člen,
   `openProactive`, akce `lazurio`); `apps/web/src/lazurio/`:
   `LazurioEnvironmentBrowser.tsx`\* a jeho test, `environmentBrowser.ts` a jeho
   test, `browserView.ts`, `threadTabs.ts`\* a jeho test\*.
10. fbd407a33; porty b534888b0, 9f21f9553, 81804e8b3, 482505171, ecfbf94ea;
    opravy d78f38fbb, 90e27b548, 5ccd81dc5, af268ebbf, 9f65de0fc, 1c020c2bd,
    70c0218be (vrácený v 5b4bff3b6), 5933d2535. `apps/server/src/server.ts`\*,
    `apps/server/src/mcp/`: `PreviewAutomationBroker.ts` a `McpHttpServer.ts`
    s testy, `toolkits/preview/tools.ts`; `apps/server/package.json`,
    `pnpm-lock.yaml`, `scripts/lib/cli-external-packages.ts` a jeho test;
    `apps/server/src/lazurio/`: `environmentBrowser.ts`\* a jeho test\*,
    `environmentBrowserConnection.ts` a `environmentBrowserPage.ts` s testy,
    `preferredHostErrors.ts`, `browserView.ts`.
11. 02d8c3791, 5b4bff3b6, 09a34d82e. `apps/server/src/server.ts`\*,
    `apps/server/src/lazurio/`: `holders.ts`\* a jeho test\*, `overlay.ts`\*,
    `threadTabs.ts`\* a jeho test\*, `threadTabsRoute.ts` a jeho test\*,
    `routeAuth.ts`\*, `threadLifecycle.ts`\*, `environmentBrowser.ts`\* a jeho
    test\*.
12. c9ef2a1e7, 18043f639, 26e141cd0, a6915a2eb. `apps/server/src/lazurio/`:
    `threadLifecycle.ts`\* a jeho test, `holders.ts`\* a jeho test\*,
    `threadTabs.ts`\* a jeho test\*, `threadTabsRoute.test.ts`\*, `overlay.ts`\*.
13. aa5e41ab9. `apps/web/src/components/RightPanelTabs.tsx`\* (dvě podmínky Nové
    karty), `apps/web/src/rightPanelStore.ts`\* (Nová karta jako singleton
    druhu); `apps/web/src/lazurio/`: `LazurioNewTab.tsx` a jeho test,
    `LazurioEnvironmentBrowser.tsx`\*, `threadTabs.ts`\* a jeho test\*.
14. 8b3d9c1e2. `apps/web/src/components/ChatView.tsx`\*, `RightPanelTabs.tsx`\*,
    `apps/web/src/rightPanelStore.ts`\* a jeho test,
    `apps/web/src/routes/_chat.pull-requests.tsx`.
15. 8b0e53424, b64117698. Server: `bin.ts`, `cli/config.ts`\*, `config.ts`\*,
    `orchestration/Layers/OrchestrationEngine.ts` a jeho test,
    `orchestration/Layers/ProviderCommandReactor.ts` a jeho test,
    `serverRuntimeStartup.ts`, `serverSettings.ts`,
    `vcs/VcsProvisioningService.ts` a jeho test, `ws.ts`;
    `apps/server/src/lazurio/`: `cli.ts`\* a jeho test\*, `managedFolder.ts`,
    `managedFolderConfig.ts`, `modelRecommendation.ts` a
    `modelRecommendationRoute.ts`, každý s testem, `managedFolderStartup.ts`,
    `routeAuth.ts`\*, `overlay.ts`\*. Háček `updateSettingsWith` ve
    `serverSettings.ts` je obecný: používá ho i řádek 18. Web: `components/CommandPalette.tsx`,
    `components/GitActionsControl.tsx`, `components/Sidebar.tsx`,
    `components/chat/DraftHeroHeadline.tsx`,
    `components/onboarding/FirstRunGate.tsx`,
    `components/sidebar/SidebarThreadHeader.tsx`, `hooks/useHandleNewThread.ts`
    a jeho test, `hooks/useScratchProject.ts`, `routes/welcome.tsx`;
    `apps/web/src/lazurio/`: `ManagedFolderWelcome.tsx`, `managedFolder.ts` a
    jeho test. `packages/contracts/src/server.ts`,
    `packages/contracts/src/settings.ts`.
16. Commit `feat(web): the in-app name T3 Code (Lazurio)` (po d2156a2a0).
    `apps/web/src/`: `branding.ts`, `branding.logic.ts` a `branding.test.ts`,
    `components/sidebar/SidebarChrome.tsx`; `apps/web/index.html`\* (titulek a
    splash), `apps/web/public/manifest.webmanifest`.
17. Commit `feat(web): the design system's light look on a Lazurio Environment`
    (po d2156a2a0). `apps/web/src/main.tsx`\* (import),
    `apps/web/src/lazurio/theme.css`.
18. Commit `feat(lazurio): providers sign in through Lazurio, and the Launchpad
turns them on` (po 1250f2186). Server: `server.ts`\* (stráž nad
    `ProviderAuthServiceLive`); `apps/server/src/lazurio/`: `providerRefresh.ts`,
    `providerRefreshRoute.ts` a `providerSignIn.ts`, každý s testem,
    `cli.ts`\* a jeho test\*, `routeAuth.ts`\*, `overlay.ts`\*. Web:
    `components/settings/CodexSetupSection.tsx`,
    `components/settings/AddProviderInstanceDialog.tsx`;
    `apps/web/src/lazurio/`: `LazurioSignIn.tsx`, `providerSignIn.ts` a jeho test.

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
  (rozhodnutí 0200 bod 1: značka T3 Code zůstává; vedle wordmarku přibude jen
  štítek „Lazurio“, viz [Jméno a vzhled](#jméno-a-vzhled)). Jedno místo
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
motiv T3, světlý i tmavý, i jeho přepnutí za běhu, a na Environmentu i světlý
vzhled design systému, který tokeny T3 mapuje. Vlastní výběr motivů má
zatím každá aplikace; sjednocení motivů napříč aplikacemi je samostatná
pozdější práce.

Mezi railem a sidebarem T3 nesmí být vidět čára. Proto:

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
  místo upstream `Alpha`, takže se jmenuje „T3 Code (Lazurio)“: v titulku
  záložky, na stránkách párování, 404 a chyby, v hlášení chyby, ve splashi
  a ve web manifestu (`short_name` je „T3 Code“). Štítek „Lazurio“ stojí
  i vedle wordmarku v sidebaru, v místě, které upstream dává pilulce Dev
  a Nightly, a to v každém režimu identifikace. Vývojový build zůstává
  „T3 Code (Dev)“. Náhled `X.Y.Z-preview.YYYYMMDD.N` je canary příštího
  stable, ne nightly: jmenuje se stejně a nemá noční artwork upstreamu.
- **Vzhled (řádek 17).** Shell Environmentu (`/.lazurio/shell.js`,
  LazurioPlatform F36, dodatek z 2026-10-13) deklaruje tokeny design systému
  `--lz-*` na kořeni dokumentu a označí ho `data-lazurio-theme="light"`.
  `apps/web/src/lazurio/theme.css` je mapuje na vlastní tokeny T3 jen ve
  standardním světlém vzhledu: obě jeho pravidla platí pod
  `:root[data-lazurio-theme="light"]:not([data-theme-id]):not(.dark)`, jedno na
  kořeni a jedno ve scope palety sidebaru (`[data-app-sidebar]`), kam patří
  i rail. Bílé plochy a papírový sidebar, inkoustový text, černá tlačítka,
  šedý výběr o stupeň tmavší, vlasové linky, neutrální fokus, signální barvy,
  jedna modrá pro odkazy a oznámení o aktualizaci, písmo Inter Tight a Geist
  Mono, `--control-radius` 6 px a bez zrnitosti. Aktivní záložka přepínače
  (`--sidebar-row-active`, bílá) se liší od jeho dráhy
  (`--sidebar-control-surface`, gray-100).
- **Co zůstává T3.** Soubor píše jen surové tokeny T3, nikdy `--contrast-*`,
  `--app-theme-*` ani `--lazurio-*`, a žádnou barvu přímo. Nastavení kontrastu
  proto dál funguje, motiv, který si člověk vybere, editor motivů a tmavý
  režim zůstávají paletami T3, písmo zvolené ve Vzhledu vyhraje a barevné
  role shellu se přizpůsobí samy. Stíny, sklo, širší škála zaoblení, velikosti
  písma a ikony zůstávají T3; design systém zatím nemá tmavé rozhraní.
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
  dřív než ho přečte router nebo párování; token zůstane.
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
  cizí origin nevloží nic. Člověk uvidí jen chybový toast „Could not open the
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
běží jeden sdílený Chromium a webový klient T3 žádný prohlížeč nemá. Overlay
proto dává agentům každého vlákna vlastní okno tohoto prohlížeče (sezení
agent-browser vlákna), nástrojům prohlížeče T3 prohlížeč Environmentu a
pravému panelu záložky, které vlákno drží, každou jako pohled jedné vzdálené
záložky. Celou specifikaci, švy v upstream souborech a to, co z nich hlídá
kontraktní test, drží [specifikace
overlaye](./lazurio-overlay.md#prohlížeč-environmentu).

**Vazba na vydání Platformy (F47).** T3 `0.0.45-lazurio.8` s tímto overlayem
potřebuje vydání LazurioPlatform s kroky 1–3 F47 na každém Environmentu, který
deklaruje prohlížeč: hub čte soubory držitelů a píše `tabs.json`, pohled posílá
`lazurio-browser:closed`, `/new-tab` uvádí origin T3 ve `frame-ancestors` a
`/.lazurio/shell.js` definuje `<lazurio-new-tab>`. Pořadí:

1. vydání Platformy (krok 5 F47) na všech Environmentech s prohlížečem;
2. preview T3 `0.0.45-preview.<datum>.N` na canary Environmentu;
3. kontrola obojího v prohlížeči Adminem (viz Testování před vydáním);
4. stable `0.0.45-lazurio.8`.

Na pořadí záleží, protože stable si lidé nainstalují tlačítkem Update sami,
kdežto Platforma přijde na Environment jen naším rolloutem. Kód pro starší
Platformu fork nenese: na ní lazurio.8 zapisuje soubory držitelů (starý hub je
ignoruje), nic nepouští (není seznam), Nová karta chybí (zůstává upstream „+“ a
Browser je ve webu nedostupný) a okno agenta do pásu přijde dál. Opačně je nová
Platforma s lazurio.7 dnešní stav: záložky stránek nedrží nic a skončí 30 s po
posledním divákovi. Větev `/.lazurio/browser.json?session=` nechává Platforma
lazurio.7; odebere ji, až bude lazurio.8 všude.

### Spravovaná složka Lazuria

**LazurioPlatform F51: spravovaný Chat začíná ve složce, doporučený model
vlastní Platforma.** `T3CODE_LAZURIO_FOLDER` určí kanonickou existující složku
Lazuria jako výchozí kontext Chatu. Server při startu, ještě před připraveností,
převezme nebo založí její nativní projekt. Ostatní projekty a konverzace
zůstávají jako historie; nová vlákna začínají v kořeni složky. Nejde o sandbox
souborového systému. `T3CODE_LAZURIO_TOOLS_URL` odkáže spravované uvítání na
stránku Environmentu, kde se přihlašují agenti. Uvítání mluví česky (s vykáním),
má-li prohlížeč češtinu, jinak anglicky, jako ostatní texty overlaye.

Machines ověří `t3 lazurio capabilities` (kontrakt verze 1) a po zřízení složky
spustí `lazurio chat defaults --apply` Platformy. Doporučení vlastní Platforma;
služba nastavení T3 atomicky zachová výslovnou volbu uživatele.
`t3 lazurio model --base-dir <home>` čte metadata beze změny; s argumentem JSON
srovnává jen přes běžící službu. Offline úprava nastavení nebo databáze nikdy
není náhradní cestou nasazení. T3 a Platformu vydávejte spolu.

Bez proměnné se chování nemění. „Add project“ zmizí z palety příkazů i ze
sidebaru, jen když klient zná aspoň jeden Environment a každý z nich je
spravovaný. Bez jakéhokoli Environmentu zůstává a z palety vede do Settings →
Connections jako v upstreamu.

Kód spravované složky žije ve složkách overlaye (`apps/*/src/lazurio/`);
upstream soubory nesou jen háčky o několika řádcích. Kontraktní test je hlídá
(„the managed Lazurio Folder keeps its seams“) a `apps/server/src/lazurio/cli.test.ts`
drží výstup `t3 lazurio capabilities` a `t3 lazurio model` bajt po bajtu.

Při přestavbě na nový upstream zachovejte testy spravovaného startu, nativní
stráže příkazů, stráže tahů agenta a spravovaného uvítání; samotný výběr
modelu je záměrně mimo fork.

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
  chybí a text řekne, že se přihlašuje v Lazuriu.
- **Server.** `LazurioProviderSignIn.guard` obalí upstream `ProviderAuthService`:
  pro instanci Codexu odmítne `start` i `importProfile` chybou
  `ProviderSetupError`, takže token platný jen pro T3 nevznikne ani z
  oficiální desktop nebo mobilní aplikace. Odhlášení, zrušení a ostatní
  poskytovatelé zůstávají upstreamu. Instance spravovaného Codexu, která na
  Environmentu už je, se nemaže; jen se v ní znovu nepřihlásí.
- **`t3 lazurio providers <request-json>`.** Po přihlášení CLI ho spustí
  Launchpad stejného Environmentu jako uživatel Environmentu. Příkaz si vydá
  sezení z úložiště tajemství T3 (jako `t3 lazurio model`), zavolá běžící
  službu cestou `POST /api/lazurio/providers` a sezení zase odvolá. Cesta
  chce rozsahy upstreamu pro obnovu poskytovatelů a pro zápis nastavení.
  Požadavek `{"providers": ["codex" | "claude", …], "enable"?: true}` jmenuje
  CLI, ne ovladač T3 (`claude` je ovladač `claudeAgent`). S `enable` služba
  nejdřív zapne výchozí instanci každého jmenovaného poskytovatele (u
  explicitní instance oba příznaky `enabled`) atomicky přes zapisovač
  nastavení a nic jiného nemění. Pak u každé zapnuté instance jmenovaných
  poskytovatelů zahodí její mezipaměti (Claude si výsledek své sondy drží
  5 minut) a přečte poskytovatele znovu. Instanci, kterou požadavek právě
  zapnul, registr přestaví a nová instance poskytovatele přečte sama.
  Odpověď `{"version": 1, "providers": [{"provider", "instanceId",
"enabled", "status", "auth"}]}` je stav po obnově; hned po zapnutí může
  ještě ukazovat kontrolu (`warning`, `unknown`), další volání bez `enable`
  už výsledek sondy. Neběží-li služba, příkaz skončí chybou a nic nemění.
  Na `t3 lazurio capabilities` je `"providerRefresh": true`.

Bez `T3CODE_LAZURIO_FOLDER` se nic nemění; cesta a příkaz existují, ale dělají
jen to, co klient se stejnými rozsahy může přes WebSocket. Kontraktní test
(„providers sign in through Lazurio, never through T3's own ChatGPT sign-in“)
hlídá stráž v `server.ts`, obě stráže v `CodexSetupSection.tsx` a odkaz v
`AddProviderInstanceDialog.tsx`; `cli.test.ts` drží výstup příkazu bajt po bajtu.

## Kdy vydávat

- **Nový upstream stable** (`pingdotgg/t3code` vydal `vX.Y.Z`): přestavte
  overlay na nový tag a vydejte `X.Y.Z-lazurio.1` postupem
  [Nové stabilní vydání upstreamu](#nové-stabilní-vydání-upstreamu).
- **Vlastní oprava nebo změna overlaye** na stejné bázi: po merge do `main`
  vydejte další `-lazurio.N`.
- **Canary před stable:** z téže špičky `main` nejdřív vydejte preview
  `X.Y.Z-preview.YYYYMMDD.N`, nainstalujte ho na canary Environment a teprve
  po jeho ověření vydejte stable. Oprava během canary je nový commit na `main`
  a další preview `.N+1`.
- Nevydávejte nightly a nevydávejte z jiné branche než `main`.
- PR do `main` se mergují jen rebase, bez merge commitu. Release i CI odmítnou
  merge commit nad upstream tagem. Main ruleset 21717536 to vynucuje:
  povoluje jen `rebase` a vyžaduje lineární historii. Readback:
  `gh api repos/Lazurio/t3code/rulesets/21717536 --jq '[.rules[] | select(.type == "pull_request") | .parameters.allowed_merge_methods], [.rules[].type]'`
  vrátí `[["rebase"]]` a mezi typy `required_linear_history`.

## Nové stabilní vydání upstreamu

Když `pingdotgg/t3code` vydá nové stabilní vydání `vX.Y.Z`, overlay se na
něm přestaví a vyjde `X.Y.Z-lazurio.1`. `main` je rolling patch-stack: starý
`main` se neslučuje ani nepřehrává hromadně. Overlay se přehraje na přesném
tagu jako jeden commit na řádek tabulky [Overlay](#overlay) a hotový
candidate nahradí `main` výměnou.

Postup vede vlastník vydávání (Steward). Organization Admin schvaluje
rozhodnutí, která mění chování nebo kontrakt s Lazuriem, vyměňuje `main`
a schvaluje vydání. Etapy 2–5 a 9 může za Stewarda udělat Task Agent (pro
etapy 2–5 je [zadání](#zadání-pro-task-agenta) níž), výměnu `main` a vydání
jen na výslovný pokyn vázaný na přesné SHA a verzi. Stav a rozhodnutí přestavby drží jedno
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
přestavujte rovnou na nejnovější a issue přejmenujte.

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
NEW_TAG=v0.0.46
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
  záměr řádku zůstává a postaví se znovu na novém API;
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
```

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

Řádek 5 jde poslední. Soubory distribuce vezměte ze starého `main`;
`.github/SECURITY.md` patří upstreamu, a proto se přenáší jako ostatní
upstream soubory:

```bash
git checkout origin/main -- .dockerignore Dockerfile.lazurio '.github/workflows/lazurio-*.yml' \
  .github/ISSUE_TEMPLATE/1-lazurio-t3-code.yml .github/README.md 'docs/operations/lazurio-*.md' \
  scripts/lazurio-release-contract.test.mjs
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
  kterou upstream smazal, krok shodí. Nahraďte ji vědomě a stejnou změnu
  udělejte v `oldTestGate` kontraktního testu.
- Švy, které kontraktní test hlídá a které se přesunuly (etapa 4).
- `.github/SECURITY.md`: pod nadpisem „Upstream T3 Code“ text upstreamu
  z nového tagu.
- Formulář issue: příklad verze (`placeholder`).
- Tento runbook: tabulka Overlay (bez odebraných řádků, sloupec „Upstream
  a přestavba“ podle nové báze), Cílový stack (u každého řádku jeho commit;
  řádek 5 je tento commit), recepty, které nová báze mění (etapa 5),
  a příklady verzí.

### 4. Kontrakt a stráže

Lokálně v candidate (Node 24, pnpm 11.10.0):

```bash
node --test scripts/lazurio-release-contract.test.mjs
pnpm install --frozen-lockfile
pnpm exec vp fmt --check
pnpm exec vp run --filter t3 typecheck
pnpm exec vp run --filter @t3tools/web typecheck
(cd apps/server && pnpm run test src/lazurio src/auth)
(cd apps/web && pnpm run test src/lazurio)
```

Pak branch pushněte a otevřete PR do `main`, nejdřív jako draft:

```bash
git push -u origin "lazurio/rebuild-$NEW_TAG"
gh pr create --repo Lazurio/t3code --base main --head "lazurio/rebuild-$NEW_TAG" --draft \
  --title "Rebuild the Lazurio overlay on upstream T3 Code $NEW_TAG" --body-file <popis PR>
gh pr checks "lazurio/rebuild-$NEW_TAG" --repo Lazurio/t3code --required --watch
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
- **Testy** všeho, co overlay mění, a pevná brána. Testy proti skutečnému
  Chromiu se bez `LAZURIO_TEST_DEVTOOLS_ENDPOINT` přeskočí.
- **Formát, lint a typecheck.** Smazané a přejmenované moduly a API upstreamu
  se ukážou tady.
- **Image a CLI archivy** včetně `LICENSE`, produkčního faviconu a instalace
  přes launcher.

PR přepněte na Ready, až je CI na přesném headu zelené a issue má vyplněnou
etapu 5.

### 5. Kompatibilita s Lazuriem

Kromě CI musí přestavba zachovat to, na co spoléhají jiné systémy a lidé. Ke
každé bráně zapište do issue, co se na nové bázi mění, rozhodnutí a jak je to
ověřené. Rozdíl mezi bázemi ukáže
`git diff "$OLD_SHA" "$NEW_SHA" -- <soubory>` se soubory uvedenými u brány.

- **`t3 lazurio capabilities`, `t3 lazurio model` a `t3 lazurio providers`.**
  Machines ověřují `capabilities` (kontrakt verze 1), `lazurio chat defaults
--apply` Platformy volá `model` a Launchpad po přihlášení CLI volá
  `providers`. `apps/server/src/lazurio/cli.test.ts` drží jejich výstup bajt
  po bajtu a při přestavbě se nemění. `model` a `providers` jdou přes běžící
  službu sezením, které si CLI samo vydá s rozsahy, jež cesty vyžadují
  (`requiredScopeForRpcMethod` pro `serverUpdateSettings`
  a `serverRefreshProviders`); CLI i cesta je berou ze stejného místa, takže
  se s upstreamem posunou spolu. Když upstream rozsahy rozdělí, ověřte, že
  úložiště tajemství sezení s novými rozsahy vydá. Soubory:
  `apps/server/src/auth/RpcAuthorization.ts` a
  `packages/contracts/src/auth.ts`. Na canary ověřte `lazurio chat defaults
--apply` a přihlášení na stránce Začínáme.
- **Kanál aktualizací.** Environmenty se aktualizují z vydání tohoto
  repozitáře přes `T3CODE_RELEASE_REPOSITORY` (řádek 4). Hlídají ho testy
  řádku 4 v CI a job `Launcher install linux-x64`. Soubor
  `apps/server/src/cloud/serviceProtocol.ts`: když se změní
  `SERVICE_LAUNCHER_PROTOCOL`, tlačítko Update na Environmentu se starým
  launcherem odmítne a Environment je potřeba jednou převést (Testování před
  vydáním, krok 3).
- **Párování a rozsahy sezení.** Prohlížeče jsou spárované na rok
  (`T3CODE_CLIENT_SESSION_TTL=365d`) a server uložené rozsahy nikdy
  nerozšiřuje. Když upstream rozsahy rozdělí nebo přidá
  (`packages/contracts/src/auth.ts`, `apps/server/src/auth/RpcAuthorization.ts`),
  prohlížeč spárovaný na staré bázi ztratí operace, které nový rozsah
  vyžadují, dokud se znovu nespáruje. Cesty overlaye berou rozsahy
  z `requiredScopeForRpcMethod`, takže se posunou samy; lidem změnu oznamte
  předem (etapa 8).
- **Databáze.** Migrace jsou jednosměrné, starší server nemá down migrace.
  Před aktualizací canary zálohujte databázi (Testování před vydáním, krok
  3). Soubory `apps/server/src/config.ts` (`dbPath`) a
  `apps/server/src/persistence/`: když nová báze databázi přesouvá nebo
  zakládá novou, upravte zálohu a [Rollback](#rollback) ve stejné přestavbě
  a do issue zapište, co s daty udělá návrat na starou bázi.
- **Desktop a mobil.** Oficiální aplikace jsou upstream a se serverem se
  domlouvají na orchestračním protokolu (`ORCHESTRATION_PROTOCOL_VERSION`
  v `packages/contracts/src/environment.ts`; server bez něj má 1). Když se
  liší, aplikace a server různých protokolů se nespojí (viz
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
  a `AppSidebarLayout.tsx` a `apps/web/src/lazurio/theme.css` mapuje jeho
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
pokyn vázaný na oba SHA. Používá k tomu existující bypass `OrganizationAdmin`
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
   vydejte ho nejdřív. Docs commity starého `main` přeneste do candidate.

3. Admin ověří, že bypass existuje:

   ```bash
   gh api repos/Lazurio/t3code/rulesets/21717536 --jq '.bypass_actors'
   # očekáváno: [{"actor_id":null,"actor_type":"OrganizationAdmin","bypass_mode":"always"}]
   # (Maintainer vidí null kvůli svým právům; readback dělá Admin.)
   ```

Potom Admin, nebo jeho Task Agent na explicitní pokyn vázaný na oba SHA,
vymění `main` z klonu, který candidate head má
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
  [Hranice automatizace](#hranice-automatizace)).
- Každé vydání z `main` je od teď na nové bázi a opravu na starou bázi už
  vydat nejde. Vyměňujte proto, až je poslední stable na staré bázi
  v pořádku.

### 7. Náhled na canary

Z nového `main` vydejte preview `X.Y.Z-preview.YYYYMMDD.1`
([Spuštění vydání](#spuštění-vydání), [Schválení](#schválení),
[Ověření publikovaného vydání](#ověření-publikovaného-vydání))
a nainstalujte ho na canary Environment po záloze databáze
([Testování před vydáním](#testování-před-vydáním), krok 3). Projděte
všechny kontroly kroku 3 a navíc to, čeho se přestavba dotkla v každém
řádku:

- přihlášení přes Launchpad Chat a nové spárování prohlížeče; co umí
  a neumí prohlížeč spárovaný na staré bázi;
- `t3 lazurio capabilities`, `lazurio chat defaults --apply` Platformy
  a nová vlákna ve složce Lazuria s uvítáním;
- „+ Nový modul“ z Launchpadu otevře neodeslané zadání;
- agentní turn s Codexem i s Claude: agent pracuje ve vlastním okně
  prohlížeče Environmentu a `preview_open` ukáže jeho záložku v panelu;
- rail, hlavička sloupce a Buddy, bez čáry mezi railem a sidebarem;
- stará vlákna po migraci databáze a restart služby se zachovanými daty;
- oficiální desktop aplikace verze nové báze proti serveru.

Kontrolu v prohlížeči (root rozhodnutí 0178) udělá ten, kdo preview
připravil a nainstaloval, sám; Organization Admin ji pak na canary projde
a přijme. Výsledek obou zapište do issue. Oprava během canary je běžný PR do `main`
a další preview `.N+1`.

### 8. Stable a nasazení

1. **Platforma a Machines první.** Změny, které nová verze potřebuje (etapa
   5), dostanou všechny dotčené Environmenty dřív než stable. Stable si lidé
   nainstalují tlačítkem Update sami a kdykoli, kdežto Platforma a Machines
   přijdou na Environment jen naším rolloutem (rozhodnutí 0200, F47).
2. **Oznámení lidem**, když přestavba mění, co uvidí nebo musí udělat: nové
   spárování prohlížeče, aktualizace desktop a mobilní aplikace, cokoli
   z tabulky rozhodnutí.
3. **Stable `X.Y.Z-lazurio.1`** ze stejného commitu jako canary preview, po
   výslovném souhlasu Admina. Canary Environment pak vraťte z preview
   (Testování před vydáním, krok 4).
4. **Co dostanou Environmenty.** Environmenty pod launcherem ukážou tlačítko
   Update po příští kontrole kanálu (při startu a každých 6 hodin). Na
   Environmentu, který zůstal na předchozím stable, ověřte, že Update nabídne,
   projde trialem launcheru a zálohou databáze a `t3 --version` ukáže novou
   verzi. Pin T3 v Machines je minimum: na stable se Environmenty dostanou
   tlačítkem i bez něj; zvedněte ho, až má nový Environment rovnou začínat na
   nové bázi.
5. **Desktop a mobil** až po Update ve webové T3 (viz
   [Desktop a mobil](#desktop-a-mobil-proti-serveru-z-forku)).

### 9. Po vydání

- **Upstreamu** nabídněte, co by pomohlo všem a příští overlay zmenšilo
  (v tabulce „nabídnout upstreamu“): issue nebo PR v `pingdotgg/t3code`
  podle jeho `CONTRIBUTING.md`. Odkaz zapište do sloupce „Upstream
  a přestavba“.
- **Runbook** doplňte běžným PR do `main`: Cílový stack o commity, které na
  `main` přibyly po výměně (opravy z canary), podle pravidel řazení,
  a sloupec „Upstream a přestavba“ podle upstream `main` toho dne. Změna jen
  v `docs/` pravidlo zachycení z etapy 6 neporuší.
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
- [ ] 7. Náhled na canary: preview `X.Y.Z-preview.YYYYMMDD.N` prošlo na canary
      Environmentu kontrolami i kontrolou v prohlížeči.
- [ ] 8. Stable a nasazení: změny Platformy a Machines jsou nasazené, oznámení
      lidem je venku, `X.Y.Z-lazurio.1` je vydané a Update z předchozího stable
      je ověřený.
- [ ] 9. Po vydání: návrhy upstreamu jsou podané, runbook je doplněný a issue
      se zavírá.

**Rozhodnutí po řádcích Overlaye**

Jeden řádek na každý řádek tabulky Overlay. Rozhodnutí: ponechat, přestavět,
zmenšit nebo odebrat; k tomu případně nabídnout upstreamu (s odkazem).

| #   | Řádek                                     | Co upstream změnil v jeho souborech | Rozhodnutí | Zdůvodnění a dopad | Schválení |
| --- | ----------------------------------------- | ----------------------------------- | ---------- | ------------------ | --------- |
| 1   | `hosted: configurable client session TTL` |                                     |            |                    |           |

**Brány kompatibility**

| Brána                                          | Co se na nové bázi mění | Rozhodnutí a ověření |
| ---------------------------------------------- | ----------------------- | -------------------- |
| `t3 lazurio capabilities` a `t3 lazurio model` |                         |                      |
| Kanál aktualizací a protokol launcheru         |                         |                      |
| Párování a rozsahy sezení                      |                         |                      |
| Databáze                                       |                         |                      |
| Desktop a mobil (orchestrační protokol)        |                         |                      |
| Kontrakt prohlížeče Environmentu               |                         |                      |
| Slot shellu a vzhled design systému            |                         |                      |
| Machines a Platforma                           |                         |                      |

**Otevřené otázky a blokery**

- …

<!-- rebuild-issue:end -->

### Zadání pro Task Agenta

Steward může etapy 2–5 svěřit Task Agentovi (Claude Code, Codex a další).
Zadání vložte do jeho Chatu a nahraďte v něm `vX.Y.Z` a odkaz na issue:

```text
Pracuješ v repozitáři Lazurio/t3code, distribuci Lazurio T3 Code. Repozitář je veřejný.
Upstream T3 Code vydal stabilní vX.Y.Z a přestavba overlaye na něj se vede v issue <odkaz na
issue přestavby>. Postup je v docs/operations/lazurio-fork-release.md, sekce „Nové stabilní
vydání upstreamu“. Přečti ji celou i sekce, na které odkazuje, a řiď se jí.

Udělej etapy 2 až 5:
1. Inventura: spusť příkazy etapy 2 a v issue vyplň tabulku rozhodnutí, jeden řádek na každý
   řádek tabulky Overlay, a brány kompatibility z etapy 5. U každého řádku navrhni rozhodnutí
   se zdůvodněním. Rozhodnutí, které mění chování pro lidi nebo jiné systémy, přidává soubor do
   allowlistu nebo vybírá mezi mechanismy, nech na Organization Adminovi a dál nepokračuj,
   dokud ho v issue nezapíše.
2. Candidate: worktree z přesného tagu, jeden commit na řádek v pořadí Cílového stacku, řádek 5
   poslední, každý řádek podle záměru (čistý diff řádku; šev, který upstream smazal, znovu na
   novém API).
3. Stráže: lokálně kontraktní test, formát, typecheck a testy overlaye. Pak push branche
   lazurio/rebuild-vX.Y.Z a PR do main, nejdřív jako draft, s přesnými vstupy (stará a nová
   báze, expected_old_main, candidate_head), posunutými piny kontraktního testu a změnami
   allowlistu. Počkej na zelené Lazurio Fork CI na přesném headu a oprav, co selže. Pak PR
   přepni na Ready.
4. Kompatibilita: ke každé bráně etapy 5 zapiš do issue, co se mění a jak jsi to ověřil.

Nikdy nepushuj na main, PR přestavby nemerguj, nevytvářej tagy ani vydání, nespouštěj workflow
vydání, nic neschvaluj v environmentu, neměň nastavení repozitáře ani rulesety a nezapínej
upstream workflow. Force push smíš jen na vlastní PR branch s přesným
--force-with-lease=<ref>:<sha>. Výměna main, vydání a jejich schválení (etapy 6 až 8) patří
Adminovi a Stewardovi; uděláš je jen na jejich výslovný pokyn vázaný na přesné SHA a verzi.
Do kódu, commitů, PR ani issue nepiš jména klientských Organizací, lidí ani soukromých hostů,
jen Environmenty a role.

Na konci vrať odkaz na PR a jeho přesný head, expected_old_main, odkaz na zelený běh CI, stav
tabulky rozhodnutí a bran, posunuté piny kontraktního testu a co zůstává otevřené.
```

## Testování před vydáním

1. **CI.** `Lazurio Fork CI` na PR i na `main` musí být zelené. Běží v něm:
   - hlídání upstream souborů (allowlist), kontrola formátu, lint celého
     repozitáře upstreamovým skriptem a pravidly (`pnpm run lint`), typecheck
     serveru a webu a kontraktní test;
   - testy všeho, co overlay mění: každý testovací soubor, který overlay přidá
     nebo změní, a upstream test vedle každého souboru, který mění
     (`X.ts` → `X.test.ts`), každý balíček svým vlastním testovacím skriptem.
     Seznam se odvozuje z diffu proti přesné upstream bázi, takže nový šev se
     otestuje bez úpravy workflow. K tomu pevná brána (`gate`) ve stejném kroku:
     všechny testy v `apps/server/src/auth` (i ty nezměněné importují švy
     overlaye), v obou složkách overlaye a v souborech, které CI testovala dřív.
     Cesta brány, která zmizí nebo nemá testy, krok shodí; kontraktní test
     hlídá, že brána drží celou starou bránu. Testy proti skutečnému Chromiu
     (`environmentBrowserConnection`, `environmentBrowserPage`) se bez
     `LAZURIO_TEST_DEVTOOLS_ENDPOINT` přeskočí;
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
   VERSION=0.0.45-lazurio.0 KEY=linux-x64 RUST_TARGET=x86_64-unknown-linux-gnu  # Mac: darwin-arm64, aarch64-apple-darwin
   vp install --filter=t3... --filter=@t3tools/web... --filter=@t3tools/scripts...
   node scripts/update-release-package-versions.ts "$VERSION"
   vp run --filter t3 build
   node scripts/apply-web-brand-assets.ts production apps/server/dist/client
   cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target "$RUST_TARGET"
   VP_NODE_VERSION=26.8.2 node apps/server/scripts/cli.ts build-exe --verbose
   mkdir -p "$HOME/.cache/t3-rm/$KEY" && cp "native/resource-monitor/target/$RUST_TARGET/release/t3-resource-monitor" "$HOME/.cache/t3-rm/$KEY/"
   node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$VERSION" \
     --resource-monitor-dir "$HOME/.cache/t3-rm" --output-dir release-cli   # Mac: --platform mac --arch arm64
   node scripts/smoke-cli-archive.ts --archive "release-cli/t3-$VERSION-$KEY.tar.gz" --expect-version "$VERSION"
   git checkout -- apps/server/package.json apps/web/package.json apps/desktop/package.json packages/contracts/package.json
   ```

3. **Canary přes preview.** Vydejte preview a nainstalujte ho přes SSH s TTY
   na canary Environmenty pod launcherem: nejdřív testovací Environment
   klientské Organizace, potom osobní a další Environmenty. Lokální
   `t3 update` nejde přes launcherův trial ani zálohu databáze (ty má jen
   tlačítko Update, #22), proto nejdřív zálohujte databázi:

   ```bash
   # Konzistentní kopie za běhu (SQLite backup API)
   python3 -c 'import sqlite3,os,time; d=os.path.expanduser("~/.t3/backups/pre-"+time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())); os.makedirs(d,0o700); s=sqlite3.connect("file:"+os.path.expanduser("~/.t3/userdata/state.sqlite")+"?mode=ro",uri=True); t=sqlite3.connect(d+"/state.sqlite"); s.backup(t); print(d)'
   # Proměnná je jen v drop-inu služby; SSH shell ji nemá a bez ní by
   # `t3 update` hledal vydání v pingdotgg/t3code.
   export T3CODE_RELEASE_REPOSITORY=Lazurio/t3code
   ~/.local/bin/t3 update 0.0.45-preview.20261012.5   # potvrďte preview; restart: viz níže
   ~/.local/bin/t3 --version
   ```

   **Když nová verze mění protokol launcheru** (`SERVICE_LAUNCHER_PROTOCOL`
   v `apps/server/src/cloud/serviceProtocol.ts`, např. 2 → 3 mezi v0.0.42
   a v0.0.44), odpovězte na dotaz na restart **ne** a službu přepněte novým
   CLI: `~/.local/bin/t3 service install`. Starý CLI by při restartu zapsal stav
   služby ve starém protokolu a nový launcher by ho odmítl („Service state is
   invalid or unsupported.“). Oprava takto shozené služby:
   `~/.local/bin/t3 service install` a `systemctl --user reset-failed
t3code.service && systemctl --user start t3code.service` (#25).

   Ověřte přesnou verzi, `~/.t3/runtime/service-state.json` (protokol
   a `activeVersion`), přihlášení a pairing přes Launchpad Chat, terminál,
   agentní turn, starý i nový thread, upload a download, reconnect a restart
   služby se zachovanými daty. Ověřte také, že Environment na stable preview
   nenabízí (`/.well-known/t3/environment` → `availableServerUpdate`). První
   selhání zastaví rozšiřování.

   U vydání se záložkami vlákna a Novou kartou (F47 krok 4) ověřte v prohlížeči
   (root 0178) na Environmentu s Platformou s kroky 1–3: „+“ i prázdný panel
   ukážou Novou kartu v barvách T3; adresa i záložka z Přehledu se stanou
   záložkou vlákna; nástroj otevře povrch T3; druhé zařízení ukáže stejné
   záložky; × s Vrátit a sdílená záložka proti Launchpadu; `preview_open` i
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

4. **Stable a tlačítko Update.** Stable vydejte ze stejného commitu až po
   zeleném canary a výslovném souhlasu Admina. Canary Environmenty vraťte
   z preview (se stejnou proměnnou):
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
VERSION=0.0.45-preview.20261012.5   # nebo stable 0.0.45-lazurio.8
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
by schválit nemohl. Pokud si vydání rozmyslíte, Admin ho odmítne (Reject) a nic
se nepublikuje.

## Ověření publikovaného vydání

```bash
VERSION=0.0.45-preview.20261012.5
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

- **Desktop** porovnává s verzí serveru jen `X.Y.Z`. Desktop `0.0.45` proti
  serveru `0.0.45-lazurio.N` (nebo preview `0.0.45-preview.…`) nic nenabízí.
  Proti serveru se starším `X.Y.Z` (`0.0.44-lazurio.1`) nabídne „Update to
  0.0.45“; server pak hledá `v0.0.45` v `Lazurio/t3code`, kde není, a skončí
  hláškou, že verze v kanálu není publikovaná. Server se nezmění. Totéž nastane,
  když se desktop sám aktualizuje na novější upstream dřív, než vydáme refresh.
- **Mobil** („Check for updates“) čte index `pingdotgg/t3code` a nabídne
  nejnovější upstream verzi kanálu serveru. Server ji v našem kanálu nenajde
  a skončí stejnou hláškou.

**Když nová upstream báze mění orchestrační protokol**
(`ORCHESTRATION_PROTOCOL_VERSION` v `packages/contracts/src/environment.ts`;
server bez této konstanty má protokol 1), aplikace a server různých protokolů
se nespojí vůbec. Server nového protokolu odmítne WebSocket aplikace se
starším protokolem (HTTP 426) a aplikace nového protokolu se k serveru se
starším nepřipojí a hlásí, že T3 Code na serveru potřebuje aktualizaci.
Oficiální aplikace se na nové upstream vydání aktualizují dřív, než vyjde
přestavba, a k Environmentům na staré bázi se do té doby nepřipojí. Proto
přestavbu začínejte hned (etapa 1 v
[Nové stabilní vydání upstreamu](#nové-stabilní-vydání-upstreamu)), lidem
změnu oznamte předem a po Update ve webové T3 aktualizujte i aplikace.

Ověřeno 2026-09-30 (DEV-6633): desktop 0.0.44 proti serveru
`0.0.44-preview.…` nic nenabídl. Podrobnosti a stav v #26.

Pořadí pro operátory proto je: nejdřív Update ve webové T3 v Environmentu
(tlačítko nabízí jen vydání našeho kanálu), potom aktualizace desktopu.
Nabídku z desktopu nebo mobilu na upstream verzi ignorujte.

## Rollback

Tlačítkem se na nižší verzi vrátit nedá. Rollback je vždy nové, vyšší vydání:
opravte chybu (nebo revertujte commit) na `main` a vydejte další
`-lazurio.N`, během canary další preview.

Nouzové cesty, když T3 na Environmentu nenaběhne a na opravu se nedá čekat:

- na Environmentu `t3 update <předchozí verze> --allow-downgrade`. Pokud mezitím
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
přestavba přinese nový upstream workflow, vypněte ho hned po výměně `main`:

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
