---
name: lazurio-upstream-rebuild
description: Přestaví Lazurio T3 Code na nové stabilní vydání upstream T3 Code end to end podle runbooku forku (inventura, rozhodnutí, candidate, CI, review, zachycení starého main, výměna main, preview, Ring 0 s ověřením v prohlížeči, stable a plán dalších vln). Použij, když upstream vydá stable vX.Y.Z, když se otevře issue „Přestavba na upstream T3 Code“ nebo když Operátor řekne „použij skill“ k nové verzi. Nepoužívej na běžnou opravu overlaye na stejné bázi.
---

# Přestavba Lazurio T3 Code na nový upstream

Tento skill vede práci. **Kroky, příkazy a overlay drží jen runbook**
[`docs/operations/lazurio-fork-release.md`](../../../docs/operations/lazurio-fork-release.md)
(sekce „Nové stabilní vydání upstreamu“, etapy 1–9) a
[`docs/operations/lazurio-overlay.md`](../../../docs/operations/lazurio-overlay.md). Než začneš,
přečti obě celé na aktuálním `main` (ne ze starého checkoutu). Když runbook při práci nesedí,
oprav runbook ve stejné přestavbě (řádek 5); tenhle skill nerozšiřuj o kroky.

## Mandát

Na začátku si od Operátora ujasni rozsah (bez něj platí jen etapy 2–5, viz runbook
„Zadání pro Task Agenta“):

- etapy, které smíš udělat sám (typicky 2–9 bez vln mimo Ring 0);
- že schválení vydání v `lazurio-t3code-release` děláš jeho účtem, vždy jen na přesném SHA
  a verzi, které jsi sám ověřil;
- co chce u řádků overlaye určitě zachovat a co posoudíš sám;
- komu patří Ring 0 a kdo tam ještě pracuje (domluv se s těmi vlákny dřív, než něco nasadíš).

Rozhodnutí, která by schvaloval Admin, smíš brát jako schválená jen tehdy, když to zadání výslovně
říká; i pak je zapiš do issue přestavby s citací a zdrojem.

## Průběh

1. **Orientace.** Root `AGENTS.md`, worktree disciplína (primární checkout nech na `main`),
   volné místo na disku (počítej asi 1 GB na worktree s `node_modules`), toolchain
   (pnpm a vite-plus přes `npx --yes pnpm@<verze z package.json>`), aktivní tailnet a vlákna,
   která pracují na Ring 0. Ověř přesný tag proti `pingdotgg/t3code` (etapa 2).
2. **Issue přestavby** podle šablony z runbooku: přejmenuj otevřené issue na novou verzi, nebo
   založ nové. Vstupy vyplň hned.
3. **Inventura paralelně, jen čtení** (etapa 2 a brány z etapy 5). Rozděl řádky do skupin,
   které spolu sdílejí soubory (osvědčilo se: hosted a vydávání 1–5 s branami; server prohlížeče
   Environmentu 8, 10–12; web 6, 7, 9, 13, 16, 17; spravovaná složka, přihlášení a párování 15, 18,
   19; agenti a otázky 20–22; Buddy 23–28; usměrnění a fronta 30–33). Dodatek, který na `main`
   nese pozdější commit, vrať do jeho řádku. Každé skupině dej společné zadání (cesty, SHA, závazná přání
   Operátora, formát zprávy po řádcích) a ať píše zprávu do souboru. Zprávy čti sám a tvrzení, na kterých stojí rozhodnutí, ověř v kódu.
4. **Rozhodnutí do issue dřív, než se změní kód.** Tabulka po řádcích (ponechat, přestavět,
   zmenšit, odebrat, nabídnout upstreamu) a brány. Kde upstream umí totéž stejně dobře, řádek odeber.
5. **Zachycení starého `main`.** Když se `main` od posledního stable liší mimo `docs/`, vydej
   nejdřív stable na staré bázi: preview na Ring 0 (záloha databáze, `t3 update` s potvrzením),
   kontrola v prohlížeči, pak stable ze špičky `main`. Dispatch dělá jiný účet než schvalovatel
   (environment má `prevent_self_review`); ověř publikované vydání podle runbooku.
6. **Candidate** (etapa 3). Řádky, které jdou přenést s malou úpravou, přehraj sám rovnou do větve
   `lazurio/rebuild-vX.Y.Z` po souborech (runbook, etapa 3). Těžké řádky dej implementačním
   skupinám ve vlastních worktree z přesného tagu, každá commit na řádek; společné zadání jako
   u inventury, k tomu „nikdy nepushuj, nesahej na `main`“. Závislosti mezi skupinami řeš dočasným
   lešením, které při integraci zahodíš. Commity skupin přenes do větve cherry-pickem v pořadí
   Cílového stacku, řádek 5 poslední. Pre-commit hook od v0.1.5 spouští `knip:check` nad celým
   repozitářem: přehrávej s `--no-verify` a knip pusť nad hotovým stackem (runbook, etapa 3).
   Opravu nad hotovým stackem adresuj řádku, který dotčené místo přidal (`git log -S`, runbook,
   etapa 3); fixup mířený na dřívější řádek autosquash nepřehraje.
7. **Kontrola integrace.** Diff každého řádku přečti sám, typecheck, lint a testy spusť sám (ne jen
   převezmi hlášení skupin; k nim `vp run knip:check`; ve worktree vnořeném v jiném repozitáři ověř formát a lint podle
   runbooku, etapa 3), a teprve pak push a draft PR (etapa 4). Když `pull_request` CI na
   draft PR neběží, spusť `Lazurio Fork CI` ručně na větvi.
8. **Review** od Stewarda (nebo review agenta jeho Organizace) na přesném headu. Skutečné vady oprav hned;
   drobnosti a rozšiřování scope odmítni věcnou námitkou v PR (root `AGENTS.md`, rozhodnutí 0163).
9. **Brány kompatibility** (etapa 5): každou zapiš do issue i s tím, jak je ověřená.
10. **Výměna `main`** (etapa 6) přesně podle runbooku: přesné SHA, `--force-with-lease`, nikdy
    automatický retry; po výměně vypni nové upstream workflow.
11. **Preview a Ring 0** (etapa 7): kontroly z runbooku a kontrola v prohlížeči. Ta potřebuje
    přihlášení člověka nebo testovací účet z lokální custody Ring 0; použij vlastní profil
    prohlížeče, ať tě neodhlásí test jiného vlákna. Agentní turn s Codexem i Claude jen tam, kde je
    AI.
12. **Stable** (etapa 8) ze stejného commitu po souhlasu Admina (nebo podle mandátu), Ring 0 zpět
    na stable a test tlačítka Update z předchozího stable.
13. **Další vlny** nenasazuj sám, pokud to mandát neříká: předlož Operátorovi plán (Environmenty,
    pořadí, okna, přepnutí tailnetu, změny Machines a Platformy, oznámení lidem).
14. **Po vydání** (etapa 9): návrhy upstreamu, runbook (Cílový stack, „Upstream a přestavba“, vše,
    co při přestavbě nesedělo), zavření issue.

## Kdy se zeptat Operátora

Jen když odpověď nenajdeš v runbooku, rozhodovacím registru, issue ani kódu, nebo když bez něj
nejde pokračovat bezpečně: přihlášení člověka, rozhodnutí mimo mandát (nové chování, které zadání
nepokrývá), nasazení mimo Ring 0, a selhání, které vyžaduje volbu mezi dvěma mechanismy. Ptej se
jednou a sdruženě.

## Handoff

Pro Operátora česky a lidsky: co se změnilo pro lidi na Environmentech, které funkce overlaye
zůstaly, které nahradil upstream a proč, co je ověřené v prohlížeči. Odkazy na PR, vydání a issue,
přesné SHA a verze, plán dalších vln a co zůstává otevřené.
