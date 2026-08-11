# Pharos

Transfert de fichiers par la lumière: un écran envoie, une caméra reçoit. Pas de compte, pas de pairing, pas de réseau entre les deux appareils.

Cible: **dépasser ~40 Mbit/s** (plafond palette 6 bits @120 Hz), toujours en **560 px**.

## Format

Même empreinte. RGB quantifié **4 bits/canal** (12 bits/cellule), grille 280×280, **10 bandes** CRC-indépendantes, render HiDPI, pacing vsync.

| Profil | Grille | Bits/cellule | Bandes | Théorique @60 / @120 |
|---|---|---|---|---|
| Fast | 280×280 | 12 | 10 | ~55 / ~110 Mbit/s |
| Robust | 140×140 | 6 | 2 | plus tolérant |

## Live

- https://pharos.fundordie.fund
- https://pharos.51-91-121-153.sslip.io

## Essayer

```bash
npm install
npm run dev
```

1. Sur l’ordinateur: ouvre `/send/`, choisis un fichier, monte la luminosité.
2. Sur le téléphone: ouvre l’URL HTTPS affichée par Vite (certificat auto-signé à accepter une fois), va sur `/receive/`, autorise la caméra, vise l’écran.

Les deux appareils doivent utiliser le **même profil**.

## État

POC navigateur. Le chemin optique (détection des finders, échantillonnage, CRC) est en place; le débit réel dépend de l’écran, de la caméra, de la lumière et de la tenue. Mesure affichée en direct sur la page réception.

## Stack

Vite, TypeScript, canvas + `getUserMedia`. Rien à installer côté téléphone.
