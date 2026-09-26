# Lazurio T3 Code: vydávání

Runbook pro vlastníka vydávání T3 Code v Lazuriu (Steward, dnes Pablo,
`agentrozjedemeai`). Vydání připravíš, otestuješ a spustíš sám; Organization
Admin (Matěj, `immakermatty`) ho jen schválí v GitHub environmentu.

`Lazurio/t3code` distribuuje vanilla upstream T3 Code server a web klient pro
Lazurio Mašiny. T3 vždy běží v kořeni vlastního hostname
(`https://t3code.<vm>.<org>.lazurio.io/`) za TLS reverse proxy. Oficiální
desktop a mobilní aplikace se připojují jako neupravení upstream klienti.

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
Mašina míří na náš kanál přes `T3CODE_RELEASE_BASE_URL=https://github.com/Lazurio/t3code/releases/download`;
volbu repozitáře pro index vydání a banner s aktualizací přináší
`T3CODE_RELEASE_REPOSITORY=Lazurio/t3code` (přichází v PR update-channel).

Publikace nikoho automaticky nepřepne. Mašina přejde na novou verzi, až
uživatel klikne na Update, nebo až někdo spustí `t3 update`.

Každé publikované vydání je na kanálu. Příznak GitHub „pre-release“ servery
neskrývá (index přeskakuje jen drafty), proto ho nepoužíváme a oddělený canary
kanál neexistuje. Canary je pořadí: novou verzi nejdřív nainstaluje canary
Mašina a teprve potom ostatní.

Na macOS je binárka podepsaná ad hoc, stejně jako upstream bez `CSC_LINK`.
Archiv stažený launcherem nemá atribut karantény, takže ho Gatekeeper
neblokuje. Archiv stažený ručně prohlížečem je potřeba odkaranténovat
(`xattr -dr com.apple.quarantine <adresář>`).

### Verze

Verze je `X.Y.Z-lazurio.N`, tag `vX.Y.Z-lazurio.N`. `X.Y.Z` je upstream
stable tag, na kterém `main` stojí. `N` začíná na 1 a roste s každým vydáním
nad stejnou upstream bází. Nová upstream báze začíná znovu od `.1`. Verze
`X.Y.Z-lazurio.0` nikdy nevychází, používá ji jen CI.

Workflow odmítne verzi, která není vyšší než všechna publikovaná vydání. Důvod:
dnešní upstream kód bere jako aktualizaci první vydání v indexu podle data
publikace, takže později publikovaná nižší verze by se serverům nabídla jako
novinka.

Pozor na SemVer: `0.0.42-lazurio.1` je nižší než `0.0.42`. Mašina, která dnes
běží na nativním buildu Machines hlášeném jako `0.0.42`, proto první přechod na
kanál neudělá tlačítkem. Poprvé ji převeď přes pin v Machines nebo
`t3 update 0.0.42-lazurio.1 --allow-downgrade`. Další vydání už tlačítko
nabídne normálně.

## Overlay

`main` je přesný upstream stable tag a nad ním jen tyto commity:

| Commit                                                   | Proč ho Lazurio potřebuje                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hosted: configurable client session TTL`                | `T3CODE_CLIENT_SESSION_TTL` (Machines nastavuje `365d`).                                                                                                                                                |
| `hosted: serve behind an explicit HTTPS external origin` | `T3CODE_EXTERNAL_ORIGIN`: server na loopbacku za proxy je dosažitelný zvenku, používá Secure cookie `__Host-t3_session` a mutace a WebSocket upgrady autentizované cookie přijímá jen z tohoto originu. |
| `hosted: explicit environment label`                     | `T3CODE_ENVIRONMENT_LABEL` pojmenuje kontejnerový Workspace (například `Iotor / Management`).                                                                                                           |
| in-app update from the configured release channel        | `T3CODE_RELEASE_REPOSITORY` a server-advertised `availableServerUpdate`: Mašina nabízí aktualizaci na nejvyšší vydání z nastaveného repozitáře a instaluje ho tlačítkem Update. Navrženo upstreamu.     |
| `release: Lazurio distribution`                          | Tento dokument, `Dockerfile.lazurio`, `.dockerignore`, kontraktní test a workflow `lazurio-fork-ci.yml`, `lazurio-cli-archives.yml` a `lazurio-release.yml`.                                            |

Nenastavené proměnné zachovají upstream chování. Commit odstraň, jakmile
upstream nabídne ekvivalent. Klienty, sdílené balíčky a wire kontrakty
(`apps/web`, `apps/mobile`, `apps/desktop`, `packages/`) overlay mění jen v
přesných souborech z allowlistu `allowed_upstream_changes` v
`lazurio-fork-ci.yml`. Každý záznam je vědomé rozhodnutí se zdůvodněním;
jakoukoli jinou změnu pod těmito cestami CI odmítne. Verze se razítkují jen při buildu
upstream skriptem `scripts/update-release-package-versions.ts`, do Gitu se
necommitují.

## Kdy vydávat

- **Nový upstream stable** (`pingdotgg/t3code` vydal `vX.Y.Z`): přestav
  overlay na nový tag (viz další sekce) a vydej `X.Y.Z-lazurio.1`.
- **Vlastní oprava nebo změna overlaye** na stejné bázi: po merge do `main`
  vydej další `-lazurio.N`.
- Nevydávej upstream nightly ani preview a nevydávej z jiné branche než `main`.
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
   **immutable** vydáním `v…-lazurio.N`. Jiný tag nestačí. Ověř, že tag
   vydání míří přesně na starý `main` a že vydání je immutable:

   ```bash
   expected_old_main="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
   capture=v0.0.42-lazurio.3   # poslední vydání
   test "$(gh api "repos/Lazurio/t3code/git/ref/tags/$capture" --jq .object.sha)" = "$expected_old_main"
   test "$(gh api "repos/Lazurio/t3code/releases/tags/$capture" --jq .immutable)" = true
   ```

   Pokud poslední vydání nemíří na současný `main`, vydej ho nejdřív. Admin
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
   VERSION=0.0.42-lazurio.0 KEY=linux-x64 RUST_TARGET=x86_64-unknown-linux-gnu  # Mac: darwin-arm64, aarch64-apple-darwin
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

3. **Canary.** Po publikaci klikni na Update nejdřív na canary Mašině (Matějova
   osobní VM nebo Spectoda VM101). Ověř verzi v T3, přihlášení, terminál a jeden
   agentní turn. Teprve potom dej vědět ostatním Mašinám.

## Spuštění vydání

Vydání se spouští jen z `main` a jen z commitu, který je právě na jeho špičce:

```bash
VERSION=0.0.42-lazurio.1
SOURCE_SHA="$(git ls-remote https://github.com/Lazurio/t3code.git refs/heads/main | cut -f1)"
UPSTREAM_TAG=v0.0.42
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
   ověří, že tag ani vydání ještě neexistují a že verze je nejvyšší.
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
   - publikuje GitHub Release jako `latest`.

   Existující tag, vydání ani image nikdy nepřepíše.

Tagy `v*-lazurio.*` chrání ruleset 24037218 „Protect Lazurio channel tags“.
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
VERSION=0.0.42-lazurio.1
mkdir -p "/tmp/t3-$VERSION" && cd "/tmp/t3-$VERSION"
gh release download "v$VERSION" --repo Lazurio/t3code
sha256sum --check SHA256SUMS            # macOS: shasum -a 256 --check SHA256SUMS
gh attestation verify "t3-$VERSION-linux-x64.tar.gz" --repo Lazurio/t3code
gh attestation verify "t3-$VERSION-darwin-arm64.tar.gz" --repo Lazurio/t3code
gh attestation verify "oci://ghcr.io/lazurio/t3code:$VERSION" --repo Lazurio/t3code
gh release view --repo Lazurio/t3code --json tagName,isLatest
```

Pak proveď Update na canary Mašině (viz Testování).

## Rollback

Tlačítkem se na nižší verzi vrátit nedá. Rollback je vždy nové, vyšší vydání:
oprav chybu (nebo revertni commit) na `main` a vydej další `-lazurio.N`.

Nouzové cesty, když Mašina nenaběhne a na opravu se nedá čekat:

- na Mašině `t3 update <předchozí verze> --allow-downgrade`;
- v Machines vrátit pin na předchozí známou dobrou verzi, reviewovaným PR.

## Co nedělat

- Publikované vydání, jeho assety ani tag nikdy nemaž a nepřepisuj. Chybné
  vydání nahradí vyšší verze.
- Nepublikuj vydání ručně (`gh release create`). Tag `v*-lazurio.*` ručně
  vytvořit ani nejde; kanál plní jen workflow.
- Nepoužívej release App mimo workflow a její privátní klíč nikam nekopíruj.
- Nepoužívej příznak pre-release jako canary, servery ho neskryjí.
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
