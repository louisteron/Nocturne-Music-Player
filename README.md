# Nocturne Music Player

Application de bureau pour macOS et Windows — version **0.16.2**.

Le code source du **visualiseur** provient du projet [dsViz de malakachakra](https://github.com/malakachakra/dsViz), révision `889b2c5`. Son moteur, ses scènes et son analyse audio ont été adaptés pour fonctionner avec le lecteur Nocturne.

## Télécharger la dernière release publiée

Les installateurs sont disponibles dans [la release v0.16.2](https://github.com/louisteron/Nocturne-Music-Player/releases/tag/v0.16.2) :

- Mac Apple Silicon : `Nocturne-0.16.2-arm64.dmg`
- Mac Intel : `Nocturne-0.16.2.dmg`
- Windows x64 : `Nocturne.Setup.0.16.2.exe`

Les installateurs ne sont pas signés.

## Fonctionnalités

- Musiques locales, import de dossiers et sous-dossiers, classement par albums.
- Bibliothèque Volumio avec lecture sur l’ordinateur.
- Navigation fluide par albums et lecteur CD.
- Visualiseur dsViz / lemondrop, intégré depuis le code source fourni (révision `889b2c5`) : 39 scènes actives (toutes les variantes Henry avec pyramide et œil sont exclues), fluides, particules et espaces 3D. Analyse réelle de la forme d’onde et du spectre, détection des basses et des impacts. Les scènes changent entre 12 et 16 secondes, avec des fondus de huit secondes. Les groupes Lumière, Vie et particules, Fluides et Ondes et signal permettent de filtrer les scènes ; le bouton « Autre animation » les change immédiatement.
- Analyse locale du son pour les fichiers, Volumio et vidéos natives TikTok ; YouTube est analysé lorsque son lecteur autorise la capture audio. Si le signal est indisponible, un message l’indique et le visuel n’invente pas de réaction au son. La sensibilité de l’analyse est ajustée sans changer le volume de lecture. Aucun microphone, enregistrement ou transfert audio.
- Paroles synchronisées, récupérées auprès de LRCLIB après activation.
- YouTube Music intégré : recherche et lecture dans l’application.
- Bloqueur publicitaire YouTube activé par défaut, désactivable dans l’onglet YouTube Music ; filtres actualisables avec le bouton ↻.
- Edits TikTok sélectionnés automatiquement à partir du titre et de l’artiste, avec connexion TikTok si nécessaire.
- Lecture du son de l’edit, puis reprise du morceau d’origine. Pour les fichiers locaux et Volumio, le calage utilise Chromaprint ; sur YouTube Music, la reprise est approximative.

Les connexions, bibliothèques et préférences personnelles restent dans les données locales de l’application. Elles ne sont pas incluses dans ce dépôt. La recherche TikTok transmet le titre et l’artiste ; LRCLIB utilise les métadonnées du morceau pour rechercher les paroles. Les services externes peuvent modifier leur fonctionnement.

## Développement

Avec Node.js et npm installés :

```sh
npm ci
npm start
```

Vérification et tests :

```sh
npm run check
npm test
```

Compilation :

```sh
npm run dist:mac
npm run dist:win
```

Les sorties se trouvent dans `dist/`. Les versions Mac Intel et Windows sont compilées ; le parcours réel YouTube Music → edit TikTok → reprise a été vérifié sur Mac Apple Silicon.

## Composants tiers

Chromaprint et ses notices sont dans `vendor/fpcalc/`. Les sources et notices des filtres publicitaires sont dans `electron/filters/`. Pour reconstruire leur instantané : `npm run filters:update`.

Le moteur dsViz et sa notice sont dans `src/vendor/dsviz/`. Les sources originales de l’archive fournie sont conservées dans `vendor/dsviz/upstream/`. `npm run visualizer:build` reconstruit l’adaptation Nocturne : moteur, scènes et analyse audio d’origine, sans les fonctions microphone, partage d’écran, lecteur autonome ou démonstration du site initial.

Le visualiseur conserve une résolution Retina jusqu’à 3840 × 2160, des mouvements et une luminosité modérés, ainsi qu’un lissage de l’affichage. Le rendu fonctionne dans un worker OffscreenCanvas, directement sur la carte graphique. La scène suivante est préparée à l’avance, avec compilation parallèle des shaders quand le pilote le permet et initialisation fractionnée des particules. La résolution s’adapte à la charge GPU pour privilégier la fluidité. Le son provient du lecteur Nocturne ; aucun microphone ni partage d’écran n’est demandé.

Validation de performance : Slime Mould, Tungsten et Murmuration testées en résolution élevée ; intervalle maximal de 12 ms entre les vérifications de réactivité de l’interface sur le Mac de développement. Ce résultat concerne ce test et ne garantit pas une fréquence identique sur tous les ordinateurs.

Les tags de version `v*` lancent la compilation des installateurs sur GitHub Actions. La release n’est publiée qu’après la réussite des trois compilations ; elle contient aussi `SHA256SUMS.txt`.
