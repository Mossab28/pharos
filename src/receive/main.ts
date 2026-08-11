import "../style.css";
import { unpackBands } from "../shared/band";
import { gzipDecompress } from "../shared/compress";
import { FountainDecoder } from "../shared/fountain";
import { sampleBands } from "../shared/frame";
import { PROFILES, type ProfileId } from "../shared/profile";
import { detectFinders } from "./detect";

const PROCESS_MAX = 720;

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main class="page receive-page">
    <header class="bar">
      <a href="/">Pharos</a>
      <label class="field">
        <span>Profil</span>
        <select id="profile">
          <option value="fast" selected>Fast</option>
          <option value="robust">Robust</option>
        </select>
      </label>
      <button id="start" type="button">Démarrer la caméra</button>
      <span id="status" class="status">Même profil que l'envoi</span>
    </header>
    <div class="stage receive-stage">
      <video id="video" playsinline muted autoplay></video>
      <canvas id="overlay"></canvas>
      <div class="hud">
        <div class="hud-label" id="hudLabel">Caméra arrêtée</div>
        <div class="bar-track"><div class="bar-fill" id="barFill"></div></div>
        <div class="hud-meta" id="hudMeta">Lance la caméra, vise le carré</div>
      </div>
    </div>
    <a id="download" class="download" hidden></a>
  </main>
`;

const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const hudLabel = document.querySelector<HTMLDivElement>("#hudLabel")!;
const hudMeta = document.querySelector<HTMLDivElement>("#hudMeta")!;
const barFill = document.querySelector<HTMLDivElement>("#barFill")!;
const download = document.querySelector<HTMLAnchorElement>("#download")!;
const profileSel = document.querySelector<HTMLSelectElement>("#profile")!;
const work = document.createElement("canvas");

let decoder: FountainDecoder | null = null;
let metaName = "file.bin";
let streamId: number | null = null;
let running = false;
let busy = false;
let framesOk = 0;
let framesSeen = 0;
let packetsOk = 0;
let lockedFrames = 0;
let t0 = 0;
let bytesIngested = 0;
let lastUi = 0;

document.querySelector("#start")!.addEventListener("click", () => {
  void startCamera();
});

function setProgress(pct: number, label: string, meta: string): void {
  barFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  hudLabel.textContent = label;
  hudMeta.textContent = meta;
}

async function startCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  video.srcObject = stream;
  await video.play();
  running = true;
  t0 = performance.now();
  statusEl.textContent = "Pointe le carré d'envoi";
  setProgress(0, "Recherche du cadre", "Vise le carré jusqu'à le verrouiller");

  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings();
  if (settings?.frameRate) {
    statusEl.textContent = `Caméra ~${Math.round(settings.frameRate)} fps`;
  }

  const onFrame = () => {
    if (!running) return;
    if (!busy) void processFrame();
    if ("requestVideoFrameCallback" in video) {
      (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(onFrame);
    } else {
      requestAnimationFrame(onFrame);
    }
  };
  onFrame();
}

async function processFrame(): Promise<void> {
  const profileId = profileSel.value as ProfileId;
  const profile = PROFILES[profileId];
  if (video.readyState < 2) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  busy = true;
  try {
    const scale = Math.min(1, PROCESS_MAX / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    work.width = w;
    work.height = h;
    const wctx = work.getContext("2d", { willReadFrequently: true })!;
    wctx.drawImage(video, 0, 0, w, h);
    const image = wctx.getImageData(0, 0, w, h);
    framesSeen++;

    overlay.width = w;
    overlay.height = h;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);

    const corners = detectFinders(image);
    const now = performance.now();

    if (!corners) {
      lockedFrames = 0;
      if (now - lastUi > 80) {
        lastUi = now;
        const pulse = 8 + (framesSeen % 20);
        setProgress(
          pulse,
          "Recherche du cadre",
          decoder
            ? `${((decoder.solvedCount / decoder.k) * 100).toFixed(0)}% déjà reçu · recadre`
            : `${framesSeen} frames · rapproche-toi du carré`,
        );
      }
      return;
    }

    lockedFrames++;
    ctx.strokeStyle = "#6ee7ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i]!.x, corners[i]!.y);
    ctx.closePath();
    ctx.stroke();

    const bandCount = profile.packetsPerFrame;
    const bandBytes = sampleBands(image, profile, corners, bandCount);
    const { header, packets } = unpackBands(bandBytes);

    if (header && streamId !== header.streamId) {
      streamId = header.streamId;
      decoder = new FountainDecoder(header.blockCount, header.blockSize, header.fileSize, header.fileCrc);
      metaName = new TextDecoder().decode(header.nameBytes);
      statusEl.textContent = metaName;
      bytesIngested = 0;
      packetsOk = 0;
      t0 = performance.now();
    }

    if (!decoder) {
      setProgress(18, "Cadre verrouillé", packets.length ? "En-tête en cours…" : "Cadre vu, en attente de données");
      return;
    }

    let newPackets = 0;
    for (const pkt of packets) {
      if (decoder.uniqueEsi.has(pkt.esi)) continue;
      const before = decoder.solvedCount;
      decoder.ingest(pkt.esi, pkt.data);
      packetsOk++;
      newPackets++;
      if (decoder.solvedCount > before) bytesIngested = decoder.solvedCount * decoder.blockSize;
    }
    if (packets.length > 0) framesOk++;

    const pct = (decoder.solvedCount / decoder.k) * 100;
    const elapsed = (performance.now() - t0) / 1000;
    const mbps = elapsed > 0 ? (bytesIngested * 8) / elapsed / 1e6 : 0;
    setProgress(
      Math.max(pct, packets.length ? 12 : 20),
      pct > 0 ? `Réception ${pct.toFixed(0)}%` : "Cadre verrouillé",
      pct > 0
        ? `${mbps.toFixed(2)} Mbit/s · ${packetsOk} paquets · ${newPackets ? "flux ok" : "en attente"}`
        : `Cadre ok · ${packets.length} bande(s) lue(s) · garde le cadre plein écran`,
    );

    if (decoder.done) await finish();
  } finally {
    busy = false;
  }
}

async function finish(): Promise<void> {
  if (!decoder) return;
  const assembled = decoder.assemble();
  if (!assembled) {
    setProgress(95, "Presque…", "CRC invalide, on continue");
    return;
  }
  running = false;
  let bytes = assembled;
  let name = metaName;
  if (name.endsWith(".gz")) {
    bytes = await gzipDecompress(assembled);
    name = name.slice(0, -3);
  }
  const blob = new Blob([bytes as BlobPart]);
  download.href = URL.createObjectURL(blob);
  download.download = name;
  download.hidden = false;
  download.textContent = `Télécharger ${name}`;
  statusEl.textContent = "Fichier prêt";
  const elapsed = (performance.now() - t0) / 1000;
  const mbps = (assembled.length * 8) / elapsed / 1e6;
  setProgress(100, "Terminé", `${elapsed.toFixed(1)}s · ${mbps.toFixed(2)} Mbit/s`);
}
