# La Plume Media Internal AI Toolkit — verplichte projectinstructie

Deze repository bevat of gebruikt de La Plume Media Internal AI Toolkit. Lees voor iedere frontend-, component-, interface- of stylingtaak eerst `TOOLKIT-INSTRUCTIONS.md`, `toolkit-manifest.json`, `tokens.css`, `toolkit.css` en de relevante voorbeelden in `components.html`. Als de toolkit in een submap staat, zoek deze bestanden daar en gebruik dezelfde prioriteit.

## Niet onderhandelbaar

1. Dit is een afgeleide interface- en productstijl voor **interne La Plume Media AI-tools**. Het is geen officiële brandguide. Beschrijf of behandel het nooit als de volledige officiële merkidentiteit.
2. Gebruik Montserrat, Space Indigo `#1F2449`, Staal Blauw `#70979D`, Palm Groen `#7D9168` en productaccent Cyan `#0EB1D1` consequent via tokens. Gebruik het bestaande SVG-logo zonder vervorming.
3. Houd de interne context zichtbaar: bijvoorbeeld “Internal tools”, “AI-assistent”, “Alleen intern” of een vergelijkbaar functioneel label. De productlaag mag herkenbaar verschillen van publieksmarketing.
4. Gebruik semantische HTML, bestaande componenten, rustige layouts, voldoende witruimte en keyboard-toegankelijke interacties. Respecteer de bestaande technische architectuur en kies geen extra framework zonder reden.
5. Typografie: standaard body minimaal 16 px; reguliere labels minimaal 14 px; hulptekst minimaal 13 px; absoluut nooit onder 12 px. Zorg voor duidelijk contrast en klikdoelen van minstens 44 px.
6. Animaties zijn subtiel: 160–380 ms, `cubic-bezier(.2,.72,.2,1)`, kleine verplaatsingen. Ondersteun altijd `prefers-reduced-motion`. Geen opvallende loops, bounce, neon of overdreven gradients.
7. Het raster in donkere headers is een **optioneel** productpatroon (`.lpm-surface-grid`), niet verplicht en niet bedoeld voor elke kaart of elk scherm.
8. Schrijf interfacecopy in natuurlijk Nederlands: warm, helder, behulpzaam en professioneel. Vermijd corporate jargon en presenteer AI-output als concept dat menselijke controle nodig heeft.
9. Gebruik `tokens.css` en `toolkit.css` als bron. Map de tokens naar React, Vue, Tailwind of andere bestaande projectstructuur zonder de visuele betekenis te veranderen.
10. Bij conflict wint een expliciete huidige gebruikersinstructie; meld relevante conflicten met de toolkit transparant.

## Werkwijze

- Inspecteer eerst de bestaande app en de gevraagde gebruikersflow.
- Selecteer alleen relevante componenten en patronen uit de toolkit.
- Bouw de tool als werkoppervlak: primaire actie en bruikbaar resultaat bovenaan.
- Voeg passende loading-, empty-, success- en errorstaten toe.
- Controleer responsive gedrag, leesbaarheid, contrast, focusstaten en interne positionering.
- Geef aan het einde kort aan welke toolkitonderdelen zijn gebruikt en wat optioneel of projectspecifiek is.
