`fade-out.mp4` est une vidéo synthétique de huit secondes : image noire 16 × 16,
sinusoïde 220 Hz et fade-out sur les deux dernières secondes. Aucun contenu TikTok
ni morceau de la bibliothèque personnelle n’est inclus.

Génération :
```sh
ffmpeg -f lavfi -i 'color=c=black:s=16x16:r=10:d=8' -f lavfi -i 'sine=frequency=220:sample_rate=44100:duration=8' -af 'volume=1.6,afade=t=out:st=6:d=2' -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart -shortest fade-out.mp4
```

`fade-outro.mp4` reprend le signal avec deux secondes de tonalité 880 Hz à la fin pour représenter une outro sonore distincte.

Le test complet utilise `transition-song.wav` (45 s de musique synthétique déterministe, générateur de `tests/audio-match-desktop.cjs`) et ses extraits `transition-edit-outro.mp4` et `transition-slow-outro.mp4`. Ils reprennent réellement les secondes 14 à 26 du fichier source, avec un fade sur les deux dernières secondes puis un jingle synthétique de trois secondes. La version `slow` est ralentie à 0,8×. Le point de reprise est calculé par le véritable moteur ; il n’est pas fourni au test par une réponse simulée.
