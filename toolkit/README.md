# La Plume Media — Internal AI Toolkit

Dit is een **afgeleide producttaal voor interne AI-tools**. Dit pakket is nadrukkelijk **niet** de officiële La Plume Media-brandguide.

## In 2 minuten starten

1. Pak de ZIP uit.
2. Open `index.html` voor het visuele overzicht of `components.html` voor direct kopieerbare HTML.
3. Kopieer `tokens.css`, `toolkit.css` en `assets/` naar je nieuwe project.
4. Plaats of merge `AGENTS.md` in de **projectroot**.
5. Gebruik voor Cursor bovendien `.cursor/rules/la-plume-toolkit.mdc`.
6. Gebruik voor Google Antigravity bovendien `.agents/rules/la-plume-toolkit.md` en zet die workspace-regel op **Always On**.
7. Vraag je AI-agent expliciet om eerst `TOOLKIT-INSTRUCTIONS.md` en `toolkit-manifest.json` te lezen.

## Eerste prompt voor je IDE

> Lees eerst AGENTS.md, TOOLKIT-INSTRUCTIONS.md, toolkit-manifest.json, tokens.css, toolkit.css en components.html. Gebruik dit pakket als bindende visuele en interactionele basis voor de interne tool die we gaan bouwen. Het is een afgeleide La Plume Media-producttaal, geen officiële huisstijlhandleiding. Behoud de bestaande projectarchitectuur, hergebruik de componenten en tokens, houd teksten goed leesbaar en pas alleen de patronen toe die relevant zijn voor deze tool. Beschrijf eerst kort hoe je de toolkit gaat toepassen en implementeer daarna de gevraagde functionaliteit.

## Bestandskaart

- `index.html`: zelfstandige, offline visuele referentie.
- `components.html`: zelfstandige componentencatalogus met semantische HTML.
- `tokens.css`: complete ontwerpvariabelen en lokale Montserrat-fonts.
- `toolkit.css`: herbruikbare, frameworkonafhankelijke componentstijlen.
- `toolkit-manifest.json`: machineleesbare context, grenzen en componentinventaris.
- `TOOLKIT-INSTRUCTIONS.md`: volledige implementatie-instructie.
- `AGENTS.md`: generieke projectinstructie voor AI-agents.
- `GEMINI.md`: alternatieve root-instructie voor Gemini-gebaseerde agents.
- `.cursor/rules/la-plume-toolkit.mdc`: altijd actieve Cursor-projectregel.
- `.agents/rules/la-plume-toolkit.md`: workspace-regel voor Google Antigravity.
- `assets/`: logo en lokale fontbestanden; geen externe CDN nodig.

## Belangrijk bij bestaande projecten

Overschrijf een bestaande `AGENTS.md`, `GEMINI.md` of regelsmap niet blind. Voeg de relevante instructie samen en behoud bestaande projectregels. Staat de toolkit in een submap, plaats de IDE-regel en rootinstructie alsnog op de plek waar de IDE projectregels daadwerkelijk inleest.
