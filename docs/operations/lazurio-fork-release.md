# Lazurio T3 Code: vydávání

Runbook pro vlastníka vydávání T3 Code v Lazuriu (Steward). Vydání připravíte,
otestujete a spustíte sami; Organization Admin ho jen schválí v GitHub
environmentu.

`Lazurio/t3code` je upravená distribuce T3 Code pro Lazurio Mašiny: server a web
klient přesného upstream stable vydání a nad nimi overlay Lazuria. Overlay chování
T3 Code mění: hostované nastavení, aktualizace z kanálu Lazuria, zadání
z Launchpadu, slot pro shell Lazuria, prohlížeč Environmentu a spravovaná složka
Lazuria. Co přesně a ve kterých souborech, říká [Overlay](#overlay); podrobnou
specifikaci prohlížeče Environmentu drží [specifikace
overlaye](./lazurio-overlay.md). T3 vždy běží v kořeni vlastního hostname
(`https://t3code.<vm>.<org>.lazurio.io/`) za TLS reverse proxy. Oficiální
desktop a mobilní aplikace se připojují jako neupravení upstream klienti.
Vzhled a branding webového klienta zůstávají upstream; do jeho UI zasahuje jen
slot pro shell Lazuria (viz [Lazurio shell](#lazurio-shell)), prohlížeč
Environmentu v pravém panelu a uvítání spravované složky Lazuria.

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
[Přestavba](#přestavba-na-nový-upstream-tag)). Dnešní commity každého řádku a
jeho soubory uvádí [Cílový stack](#cílový-stack). Sloupec „Upstream a
přestavba“ říká, proč řádek zůstává a co z něj podle upstream `main` k
2026-10-12 při přestavbě na 0.0.46 odpadne.

| #   | Commit                                                                                          | Proč ho Lazurio potřebuje                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Upstream a přestavba                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `hosted: configurable client session TTL`                                                       | `T3CODE_CLIENT_SESSION_TTL` (Machines nastavuje `365d`).                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Upstream má pevných 30 dní: zůstává.                                                                                                                                                                                                                                                                                                |
| 2   | `hosted: serve behind an explicit HTTPS external origin`                                        | `T3CODE_EXTERNAL_ORIGIN`: server na loopbacku za proxy je dosažitelný zvenku, používá Secure cookie `__Host-t3_session` a mutace a WebSocket upgrady autentizované cookie přijímá jen z tohoto originu.                                                                                                                                                                                                                                                                                                             | Upstream ekvivalent nemá. Upstream `main` kontroluje Origin sám (#18509): kontrola odpadne, proměnná, Secure `__Host-` cookie a politika loopbacku zůstanou.                                                                                                                                                                        |
| 3   | `hosted: explicit environment label`                                                            | `T3CODE_ENVIRONMENT_LABEL` pojmenuje kontejnerový Workspace (například `Acme / Management`).                                                                                                                                                                                                                                                                                                                                                                                                                        | Upstream čte jen `PRETTY_HOSTNAME` a hostname, Machines nastavují proměnnou: zůstává.                                                                                                                                                                                                                                               |
| 4   | `feat: in-app update from the configured release channel`                                       | `T3CODE_RELEASE_REPOSITORY` a server-advertised `availableServerUpdate`: Mašina nabízí aktualizaci na nejvyšší vydání z nastaveného repozitáře a instaluje ho tlačítkem Update. Navrženo upstreamu.                                                                                                                                                                                                                                                                                                                 | Upstream má pevné `pingdotgg/t3code` a bere první vydání kanálu: zůstává celý.                                                                                                                                                                                                                                                      |
| 5   | `release: Lazurio distribution`                                                                 | Tento runbook, [specifikace overlaye](./lazurio-overlay.md), `Dockerfile.lazurio`, `.dockerignore`, kontraktní test a workflow `lazurio-fork-ci.yml`, `lazurio-cli-archives.yml` a `lazurio-release.yml`, včetně preview vydání pro canary (`X.Y.Z-preview.YYYYMMDD.N` jako GitHub pre-release).                                                                                                                                                                                                                    | Zůstává; v přestavbě jde poslední.                                                                                                                                                                                                                                                                                                  |
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

Hostované proměnné a spravovaná složka platí, jen když jsou nastavené, a shell,
prohlížeč Environmentu a Nová karta se ukážou, jen když je Environment nabízí.
Bez ohledu na to běží dvě věci: server pod launcherem kontroluje vydání svého
kanálu (vypne to `T3CODE_UPDATE_CHECK_ENABLED=false`) a procesy poskytovatelů
dostávají `AGENT_BROWSER_SESSION`, které nic nepovoluje. Řádek odeberte, jakmile
upstream nabídne ekvivalent. Upstream soubory pod `apps/`, `packages/` a `scripts/` overlay mění
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
  `.github/workflows/lazurio-*.yml`, `docs/operations/lazurio-*.md` a
  `scripts/lazurio-release-contract.test.mjs`) patří celé řádku 5. Jejich
  konečný stav (allowlist, švy v kontraktním testu, tento runbook) popisuje
  všechny řádky, proto řádek 5 jde poslední.
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
6. 9c3b3e8e8, 6df0dfa00. `apps/web/src/main.tsx`, `apps/web/src/routes/_chat.tsx`,
   `apps/web/src/lazurio/`: `LazurioPromptDraft.tsx`, `promptDraft.ts` a jeho
   test.
7. 1e4cf23d6, 47c8f9713. `apps/web/index.html`,
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
    `apps/server/src/lazurio/`: `cli.ts`, `managedFolder.ts`,
    `managedFolderConfig.ts`, `modelRecommendation.ts` a
    `modelRecommendationRoute.ts`, každý s testem, `managedFolderStartup.ts`,
    `routeAuth.ts`\*, `overlay.ts`\*. Web: `components/CommandPalette.tsx`,
    `components/GitActionsControl.tsx`, `components/Sidebar.tsx`,
    `components/chat/DraftHeroHeadline.tsx`,
    `components/onboarding/FirstRunGate.tsx`,
    `components/sidebar/SidebarThreadHeader.tsx`, `hooks/useHandleNewThread.ts`
    a jeho test, `hooks/useScratchProject.ts`, `routes/welcome.tsx`;
    `apps/web/src/lazurio/`: `ManagedFolderWelcome.tsx`, `managedFolder.ts` a
    jeho test. `packages/contracts/src/server.ts`,
    `packages/contracts/src/settings.ts`.

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
stránku Environmentu, kde se přihlašují agenti.

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

## Kdy vydávat

- **Nový upstream stable** (`pingdotgg/t3code` vydal `vX.Y.Z`): přestavte
  overlay na nový tag (viz další sekce) a vydejte `X.Y.Z-lazurio.1`.
- **Vlastní oprava nebo změna overlaye** na stejné bázi: po merge do `main`
  vydejte další `-lazurio.N`.
- **Canary před stable:** z téže špičky `main` nejdřív vydejte preview
  `X.Y.Z-preview.YYYYMMDD.N`, nainstalujte ho na canary Mašiny a teprve po
  jejich ověření vydejte stable. Oprava během canary je nový commit na `main`
  a další preview `.N+1`.
- Nevydávejte nightly a nevydávejte z jiné branche než `main`.
- PR do `main` se mergují jen rebase, bez merge commitu. Release i CI odmítnou
  merge commit nad upstream tagem. Main ruleset 21717536 to vynucuje:
  povoluje jen `rebase` a vyžaduje lineární historii. Readback:
  `gh api repos/Lazurio/t3code/rulesets/21717536 --jq '[.rules[] | select(.type == "pull_request") | .parameters.allowed_merge_methods], [.rules[].type]'`
  vrátí `[["rebase"]]` a mezi typy `required_linear_history`.

## Přestavba na nový upstream tag

`main` je rolling patch-stack. Starý `main` se neslučuje ani nepřehrává
hromadně. Přestavbu připravujete vy (Steward): candidate branch, checky a
přesné SHA. Samotnou výměnu `main` provádí Organization Admin, nebo jeho Task
Agent na jeho explicitní pokyn. Používá k tomu existující bypass
`OrganizationAdmin` v main rulesetu 21717536. Ostatním force-push dál blokuje
pravidlo `non_fast_forward` a běžné PR a check ochrany platí pro všechny beze
změny.

1. Z přesného upstream stable tagu založte candidate branch a přehrajte overlay
   jako [Cílový stack](#cílový-stack): jeden commit na řádek tabulky Overlay,
   s jeho předmětem, řádek 5 poslední. Každý řádek přeneste podle záměru
   (`git cherry-pick` jeho commitů, případně ručně) a zmenšete o všechno, co
   už upstream umí (sloupec „Upstream a přestavba“). Řádek, který odpadne celý,
   z tabulky odeberte.
2. V `lazurio-fork-ci.yml` aktualizujte `UPSTREAM_TAG`, `UPSTREAM_SHA` a verzi
   `X.Y.Z-lazurio.0` u jobu `cli-archives`. Kontraktní test hlídá, že sedí
   k `UPSTREAM_TAG`.
3. Při každé přestavbě znovu projděte allowlist `allowed_upstream_changes`.
   Soubor, který overlay už nemění nebo jehož změnu převzal upstream, z něj
   odeberte. Nový soubor přidejte jen jako vědomé rozhodnutí se zdůvodněním,
   do skupiny funkce, které patří.
4. Otevřete PR a počkejte na zelené `Lazurio Fork CI`. Pak předejte Adminovi
   přesný starý `main` (`expected_old_main`) a přesný nový head
   (`candidate_head`) spolu s odkazem na zelený běh.
5. Než se `main` přepne, musí být současný `main` zachycený publikovaným
   **immutable** vydáním `v…-lazurio.N`. Jiný tag nestačí. Tag vydání míří
   buď přesně na starý `main`, nebo na jeho předka, od kterého se starý
   `main` liší jen v `docs/`. Takové commity nemění nic, co se vydává, a
   jejich obsah přejde do nového `main` s přestavěným overlayem; kvůli nim
   se samostatné vydání nedělá (rozhodnutí Admina 2026-10-02, DEV-6633).
   Ověřte obojí a že vydání je immutable:

   ```bash
   git fetch origin main --tags
   expected_old_main="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
   capture=v0.0.45-lazurio.7   # poslední stable vydání
   capture_sha="$(gh api "repos/Lazurio/t3code/git/ref/tags/$capture" --jq .object.sha)"
   git merge-base --is-ancestor "$capture_sha" "$expected_old_main"
   git diff --quiet "$capture_sha" "$expected_old_main" -- . ':(exclude)docs/'
   test "$(gh api "repos/Lazurio/t3code/releases/tags/$capture" --jq .immutable)" = true
   ```

   Pokud starý `main` mění proti poslednímu vydání cokoli mimo `docs/`,
   vydejte ho nejdřív. Docs commity starého `main` přeneste do candidate. Admin
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

   Neúspěšný lease znamená souběžnou změnu. Nikdy ho automaticky neopakujte.

6. Vydejte `X.Y.Z-lazurio.1` z nového `main` postupem níže.

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

3. **Canary přes preview.** Vydejte preview a na canary Mašinách pod launcherem
   (nejdřív testovací VM klientské Organizace, potom osobní VM a další Mašiny) ho nainstalujte přes
   SSH s TTY. Lokální `t3 update` nejde přes launcherův trial ani zálohu
   databáze (ty má jen tlačítko Update, #22), proto nejdřív zálohujte databázi:

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
   služby se zachovanými daty. Ověřte také, že Mašina na stable preview
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

4. **Stable a tlačítko Update.** Stable vydejte ze stejného commitu až po
   zeleném canary a výslovném souhlasu Admina. Canary Mašiny vraťte z preview
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
VERSION=0.0.45-preview.20261012.5   # nebo stable 0.0.45-lazurio.8
SOURCE_SHA="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
UPSTREAM_TAG=v0.0.45
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
     `main`. Když se `main` mezitím posunul, skončí a nic nepublikuje; spusťte
     vydání znovu s novou špičkou;
   - napíše `SHA256SUMS` a attestuje každý archiv zvlášť;
   - postaví, pushne a attestuje `ghcr.io/lazurio/t3code:<verze>` a ověří, že
     publikovaný image nese `LICENSE` a produkční favicon;
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

Pak proveďte Update na canary Mašině (viz Testování).

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

Ověřeno 2026-09-30 (DEV-6633): desktop 0.0.44 proti serveru
`0.0.44-preview.…` nic nenabídl. Podrobnosti a stav v #26.

Pořadí pro operátory proto je: nejdřív Update ve webové T3 v Environmentu
(tlačítko nabízí jen vydání našeho kanálu), potom aktualizace desktopu.
Nabídku z desktopu nebo mobilu na upstream verzi ignorujte.

## Rollback

Tlačítkem se na nižší verzi vrátit nedá. Rollback je vždy nové, vyšší vydání:
opravte chybu (nebo revertujte commit) na `main` a vydejte další
`-lazurio.N`, během canary další preview.

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

- Publikované vydání, jeho assety ani tag nikdy nemažte a nepřepisujte. Chybné
  vydání nahradí vyšší verze.
- Nepublikujte vydání ručně (`gh release create`). Tag `v*-lazurio.*` ani
  `v*-preview.*` ručně vytvořit nejde; kanál plní jen workflow.
- Nepoužívejte release App mimo workflow a její privátní klíč nikam
  nekopírujte.
- Nespoléhejte na příznak pre-release: servery ho neskryjí. Canary drží jen
  preview tvar verze.
- Nepushujte na `main` s force mimo postup „Přestavba na nový upstream tag“.
- Nespouštějte upstream workflow (`release.yml` a další) a nezapínejte je.

## Hranice automatizace

Upstream workflow soubory zůstávají ve stromu, aby refresh zůstal bez diffu, ale
v nastavení Actions tohoto repozitáře jsou **vypnuté**. Potřebují Blacksmith
runnery a upstream secrets, takže odsud publikovat nemohou. Zapnuté by jen
visely ve frontě nebo padaly a `release.yml` by reagoval na tagy `v*`. Když
refresh přinese nový upstream workflow, vypněte ho také:

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
