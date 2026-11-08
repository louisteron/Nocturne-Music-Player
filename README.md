# Nocturne Music Player

Application de bureau pour macOS et Windows — version **0.12.0**.

## Télécharger

Les installateurs sont disponibles dans [la release v0.12.0](https://github.com/louisteron/Nocturne-Music-Player/releases/tag/v0.12.0) :

- Mac Apple Silicon : `Nocturne-0.12.0-arm64.dmg`
- Mac Intel : `Nocturne-0.12.0.dmg`
- Windows x64 : `Nocturne Setup 0.12.0.exe`

Les installateurs ne sont pas signés.

## Fonctionnalités

- Musiques locales, import de dossiers et sous-dossiers, classement par albums.
- Bibliothèque Volumio avec lecture sur l’ordinateur.
- Navigation fluide par albums et lecteur CD.
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
