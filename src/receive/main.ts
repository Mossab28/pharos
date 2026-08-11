import "../style.css";
import { unpackBands } from "../shared/band";
import { gzipDecompress } from "../shared/compress";
import { FountainDecoder } from "../shared/fountain";
import { sampleBands } from "../shared/frame";
import { PROFILES, type ProfileId } from "../shared/profile";
import { detectFinders } from "./detect";

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
      <span id="status" class="status"></span>
    </header>
    <div class="stage receive-stage">
      <video id="video" playsinline muted autoplay></video>
      <canvas id="overlay"></canvas>
      <div id="progress" class="progress"></div>
    </div>
    <a id="download" class="download" hidden></a>
  </main>
`;

const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const progressEl = document.querySelector<HTMLDivElement>("#progress")!;
const download = document.querySelector<HTMLAnchorElement>("#download")!;
const profileSel = document.querySelector<HTMLSelectElement>("#profile")!;

let decoder: FountainDecoder | null = null;
let metaName = "file.bin";
let streamId: number | null = null;
let running = false;
let busy = false;
let framesOk = 0;
let framesSeen = 0;
let packetsOk = 0;
let t0 = 0;
let bytesIngested = 0;

document.querySelector("#start")!.addEventListener("click", () => {
  void startCamera();
});

async function startCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    },
  });
  video.srcObject = stream;
  await video.play();
  running = true;
  t0 = performance.now();
  statusEl.textContent = "Pointe vers l'écran d'envoi";

  const onFrame = () => {
    if (!running) return;
    if (!busy) processFrame();
    if ("requestVideoFrameCallback" in video) {
      (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(onFrame);
    } else {
      requestAnimationFrame(onFrame);
    }
  };
  onFrame();
}

function processFrame(): void {
  const profileId = profileSel.value as ProfileId;
  const profile = PROFILES[profileId];
  if (video.readyState < 2) return;

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  busy = true;
  try {
    overlay.width = w;
    overlay.height = h;
    const ctx = overlay.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    framesSeen++;

    const corners = detectFinders(image);
    if (!corners) {
      progressEl.textContent = `Recherche du cadre… ${packetsOk} paquets / ${framesSeen} frames`;
      return;
    }

    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i]!.x, corners[i]!.y);
    ctx.closePath();
    ctx.stroke();

    const bandCount = profile.packetsPerFrame;
    const bandBytes = sampleBands(image, profile, corners, bandCount);
    const { header, packets } = unpackBands(bandBytes);
    if (!header && packets.length === 0) return;
    framesOk++;

    if (header && streamId !== header.streamId) {
      streamId = header.streamId;
      decoder = new FountainDecoder(header.blockCount, header.blockSize, header.fileSize, header.fileCrc);
      metaName = new TextDecoder().decode(header.nameBytes);
      statusEl.textContent = `Flux ${metaName}`;
      bytesIngested = 0;
      packetsOk = 0;
    }

    if (!decoder) return;

    for (const pkt of packets) {
      if (decoder.uniqueEsi.has(pkt.esi)) continue;
      const before = decoder.solvedCount;
      decoder.ingest(pkt.esi, pkt.data);
      packetsOk++;
      if (decoder.solvedCount > before) bytesIngested = decoder.solvedCount * decoder.blockSize;
    }

    const pct = ((decoder.solvedCount / decoder.k) * 100).toFixed(1);
    const elapsed = (performance.now() - t0) / 1000;
    const mbps = elapsed > 0 ? ((bytesIngested * 8) / elapsed / 1e6).toFixed(2) : "0";
    progressEl.textContent = `${pct}% · ${mbps} Mbit/s · ${packetsOk} paquets · frames ${framesOk}/${framesSeen}`;

    if (decoder.done) void finish();
  } finally {
    busy = false;
  }
}

async function finish(): Promise<void> {
  if (!decoder) return;
  const assembled = decoder.assemble();
  if (!assembled) {
    statusEl.textContent = "CRC fichier invalide, on continue…";
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
  const mbps = ((assembled.length * 8) / elapsed / 1e6).toFixed(2);
  progressEl.textContent = `Terminé en ${elapsed.toFixed(1)}s · ${mbps} Mbit/s soutenus`;
}
