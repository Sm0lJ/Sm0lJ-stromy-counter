# Sm0lJ-stromy-counter

Statická webová aplikácia na počítanie čiel kmeňov (pňov, polien v hromade)
z fotky. Publikovaná cez GitHub Pages.

## Ako to funguje

Čisto v prehliadači, bez externých knižníc (žiadne OpenCV):

1. Každému pixelu sa vypočíta „drevo skóre“ (svetlé teplé odtiene čiel kmeňov).
2. Prah medzi drevom a pozadím sa určí automaticky (Otsuova metóda).
3. Maska sa morfologicky vyčistí (zalepia sa praskliny, zmaže sa šum).
4. Na maske sa spraví dištančná transformácia a jej lokálne maximá sú stredy
   polien — vďaka tomu sa správne oddelia aj polená, ktoré sa dotýkajú.

## Použitie

1. **📷 Odfotiť / vybrať fotku** — na mobile otvorí foťák alebo galériu.
   Prípadne **Živý náhľad kamery** a potom **Odfotiť a spočítať**.
2. Výsledok sa zobrazí hneď; každé nájdené poleno má zelený krúžok.
3. Chyby opravíš ťuknutím do obrázka: ťuknutím na krúžok ho zmažeš,
   ťuknutím na prehliadnuté poleno ho pridáš. Počet sa priebežne aktualizuje.

## Nastavenia

- **Najmenšie poleno** — priemer v pixeloch fotky, pod ktorým sa nález ignoruje.
  Zväčši, keď počíta drobné fliačiky navyše; zmenši, keď vynecháva malé polienka.
- **Citlivosť na drevo** — korekcia automatického prahu svetlosti.
  Plus = viac plochy sa berie ako drevo, mínus = menej.
- **Zobraziť masku dreva** — ladiaca pomôcka; zeleno podfarbí plochu,
  ktorú algoritmus považuje za drevo.

## Publikovanie

Repo obsahuje workflow `.github/workflows/pages.yml`, ktorý pri pushi na `main`
nasadí obsah repozitára na GitHub Pages.
