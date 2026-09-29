# Implementatie-instructie voor AI-IDE’s en coding agents

## 1. Wat dit pakket is

Dit pakket beschrijft een **afgeleide interface- en componentstijl voor interne AI-tools van La Plume Media**. Het is geïnspireerd op bestaande merkassets en een subset van de huisstijl, maar het is **geen officiële brandguide**, geen volledige huisstijl en geen autoritatieve instructie voor externe communicatie.

De juiste interpretatie is:

`officiële merkankers → afgeleide interne productlaag → specifieke AI-tool`

Gebruik dit pakket voor interne assistenten, promptbuilders, contenttools, workflowhulpmiddelen, dashboards en experimenten. Gebruik het niet om een officiële merkhandleiding, publiek marketingplatform of externe klanthuisstijl te reconstrueren.

## 2. Verplichte leesvolgorde

Lees, in deze volgorde:

1. De actuele gebruikersopdracht.
2. Bestaande projectinstructies, waaronder `AGENTS.md` of `GEMINI.md`.
3. Dit bestand.
4. `toolkit-manifest.json` voor scope, componentinventaris en technische grenzen.
5. `tokens.css` voor de visuele waarheid.
6. `toolkit.css` voor productiegeschikte componentstijlen.
7. `components.html` voor semantische voorbeelden.
8. `index.html` uitsluitend als visuele referentie, niet als verplichte applicatielayout.

Bij conflict geldt: actuele gebruikersopdracht > bestaande projectregels > dit instructiebestand > manifest > tokens > componentvoorbeelden.

## 3. Visuele identiteit

### Verplicht

- Gebruik Montserrat met Verdana als fallback en laad lokale fonts uit `assets/fonts/`.
- Gebruik Space Indigo `#1F2449` als merkanker voor donkere oppervlakken, koppen en actieve keuzes.
- Gebruik Staal Blauw `#70979D` voor rustige accenten en Palm Groen `#7D9168` voor positieve of ondersteunende staten.
- Gebruik Cyan `#0EB1D1` spaarzaam als herkenbare **interne digitale productlaag**.
- Gebruik het bestaande logo uit `assets/logo.svg` ongewijzigd en in de juiste verhouding.
- Laat de interne toepassing herkenbaar zijn via contextlabels of functionele interfacecopy.
- Gebruik kleuren uitsluitend via CSS-custom-properties of een nette mapping naar het bestaande design-token-systeem van het project.

### Optioneel

- Donkere hero of header.
- Subtiel raster met `.lpm-surface-grid` op een donkere header of geselecteerd leeg scherm.
- Cyan scope-chip of interne productbadge.
- Donkere of groene kaarten wanneer ze de inhoud ondersteunen.

### Niet doen

- De toolkit presenteren als officiële huisstijlrichtlijn.
- De toolkitpagina één-op-één nabouwen wanneer de gevraagde tool een andere layout nodig heeft.
- Elke pagina voorzien van een grote marketinghero.
- Random nieuwe merkpaletten, glimmende neonaccenten, drukke gradients, oversized schaduwen of speelse bounceanimaties introduceren.
- Het raster overal toepassen; het is een optioneel hulpmiddel, geen verplicht merkonderdeel.

## 4. Leesbaarheid en toegankelijkheid

- Bodytekst: minimaal 16 px.
- Reguliere interface-labels, knoppen en badges: minimaal 14 px.
- Hulpteksten en onderschriften: minimaal 13 px.
- Uitzonderlijke metadata of compacte labels: minimaal 12 px, nooit kleiner.
- Klik- en touchdoelen: minimaal 44 × 44 px.
- Gebruik semantische labels voor alle formulieren en expliciete `for`/`id`-koppelingen.
- Zorg voor toetsenbordtoegang, zichtbare focus en goede kleurcontrasten.
- Gebruik op gekleurde kaarten witte of voldoende contrastrijke tekst; geen grijze tekst op groen.
- Centreer de stip in radiobuttons exact met `left:50%; top:50%; transform:translate(-50%,-50%)`.
- Respecteer `prefers-reduced-motion` voor alle animaties.

## 5. Componenten en gebruik

### Buttons

- Primary: donkere pill, duidelijke werkwoordelijke actie zoals “Genereer concept”.
- Secondary/brand: Space Indigo voor een secundaire duidelijke productactie.
- Outline: ondergeschikte acties zoals instellingen, terug of annuleren.
- Houd de tekst leesbaar en gebruik geen pictogram zonder toegankelijk label.

### Badges

- Neutraal/indigo: tooltype, AI-status of categorie.
- Groen: succes, gereed of afgerond.
- Quiet: interne scope of minder belangrijke metadata.
- Houd badges functioneel; geen decoratieve stapels zonder betekenis.

### Cards

- Gebruik kaarten voor tools, output, workflows of samenvattingen.
- Donker of groen mag, mits alle tekst duidelijk leesbaar blijft.
- Hover mag maximaal circa 2–4 px omhoog bewegen met een subtiele schaduw.

### Formulieren

- Geef ieder veld een betekenisvol label, realistische placeholder en zo nodig helptekst.
- Gebruik radio’s voor exact één keuze; checkboxes voor meerdere onafhankelijke keuzes.
- Gebruik een slider alleen wanneer een schaal of intensiteit werkelijk zinvol is.
- Toon loading, empty, success en error op een rustige, begrijpelijke manier.

### AI-specifieke interactie

- Vertel gebruikers wat de tool doet en wat ze moeten aanleveren.
- Geef gegenereerde output een duidelijke status: concept, controle nodig, gereed of mislukt.
- Laat altijd ruimte voor menselijke beoordeling en redactie.
- Presenteer aannames of bronnen transparant als die een rol spelen.
- Introduceer geen ongeautoriseerde externe API-calls, datadeling of opslag.

## 6. Motion

- Fast: 160 ms; base: 240 ms; slow: 380 ms.
- Gebruik `cubic-bezier(.2,.72,.2,1)` als standaard easing.
- Geschikte patronen: soft lift, accent reveal, focus glow en subtiele richtingaanwijzing.
- Animateer bij voorkeur `transform` en `opacity`; vermijd layoutverspringingen.
- Een CTA die naar rechts schuift gebruikt bijvoorbeeld `transform:translateX(6px)` met een expliciete transition.
- Geen permanente beweging, bounce, confetti of nadrukkelijke “AI-magie”.

## 7. Technische integratie

### Plain HTML / CSS

```html
<link rel="stylesheet" href="toolkit/toolkit.css">
```

Gebruik de `lpm-` classes uit `components.html`. `toolkit.css` importeert automatisch `tokens.css`, die lokale fontbestanden laadt.

### React, Next, Vue of Svelte

- Importeer `toolkit.css` in de bestaande globale stylesheet of app-entry.
- Gebruik de bestaande componentarchitectuur van het project.
- Vertaal HTML-voorbeelden naar frameworkcomponenten zonder visueel gedrag of toegankelijkheid te verliezen.
- Maak herbruikbare wrappers voor Button, Badge, Card, Field, Choice en Range wanneer het project dat logisch maakt.

### Tailwind of ander token-systeem

- Map de `--lpm-*` tokens naar het bestaande theme.
- Vermijd dubbele, conflicterende bronnen van waarheid.
- Houd CSS-waarden, breakpoints, motion en toegankelijkheid gelijkwaardig.

### Bestaand project

- Inspecteer eerst de bestaande layout, routing, componenten en dependencykeuzes.
- Hergebruik bestaande infrastructuur; introduceer geen nieuw framework voor deze toolkit.
- Overschrijf bestaande `AGENTS.md` of andere regels niet zonder de inhoud samen te voegen.
- Als de toolkit in een submap staat, zorg dat rootinstructies en IDE-regels op projectniveau actief zijn.

## 8. IDE-configuratie

### Cursor

Plaats `AGENTS.md` in de projectroot en `.cursor/rules/la-plume-toolkit.mdc` in de projectmap. De meegeleverde `.mdc` heeft `alwaysApply: true`. Daardoor ontvangt de agent de kerninstructie bij iedere relevante sessie. Laat de volledige toelichting in dit document staan en verwijs er vanuit de rule naar.

### Google Antigravity

Plaats `AGENTS.md` of `GEMINI.md` in de projectroot. Plaats aanvullend `.agents/rules/la-plume-toolkit.md` in de workspace-root en stel deze regel in de Antigravity-interface in op **Always On**. Gebruik geen oudere `.agent/rules`-map voor nieuwe projecten wanneer `.agents/rules` beschikbaar is.

### Andere agents

Gebruik `AGENTS.md` als eerste voorkeur. Als een omgeving een eigen regelsbestand vraagt, maak een dunne projectspecifieke verwijzing naar dit document en het manifest. Kopieer de bronregels niet op meerdere plaatsen zonder synchronisatie.

## 9. Startprompt voor elk nieuw project

> We gaan een interne tool voor La Plume Media bouwen. Lees eerst AGENTS.md, TOOLKIT-INSTRUCTIONS.md, toolkit-manifest.json, tokens.css, toolkit.css en components.html. Gebruik deze afgeleide interne AI-toolkit als bindende basis voor kleur, typografie, componenten, toegankelijkheid en motion. Dit is geen officiële brandguide. Pas alleen de relevante onderdelen toe, houd de bestaande projectarchitectuur intact, maak een bruikbaar werkoppervlak en vermeld kort welke toolkitpatronen je gebruikt. Bouw daarna de volgende tool: [OMSCHRIJF JE TOOL].

## 10. Controle vóór oplevering

- Is zichtbaar dat dit een interne tool is, niet een publieke merkwebsite?
- Kloppen Montserrat, merkankers en het subtiele cyan-productaccent?
- Zijn alle teksten comfortabel leesbaar en alle contrasten voldoende?
- Zijn radio’s, checkboxes, sliders en formuliervelden semantisch en toegankelijk?
- Is motion rustig, vloeiend en uit te zetten met `prefers-reduced-motion`?
- Is het optionele headergrid alleen gebruikt wanneer het de interface helpt?
- Is AI-output transparant gepresenteerd en klaar voor menselijke controle?
- Is de bestaande projectarchitectuur behouden?
