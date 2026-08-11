import "../style.css";
import { unpackBands } from "../shared/band";
import { gzipDecompress } from "../shared/compress";
import { FountainDecoder } from "../shared/fountain";
import { sampleBands } from "../shared/frame";
import type { Point } from "../shared/geometry";
import { PROFILES, type ProfileId } from "../shared/profile";
import { detectFinders } from "./detect";

const PROCESS_MAX = 720;
/** Keep using last corners this many misses before dropping lock. */
const LOCK_HOLD = 20;

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
      <button id="start" type="button">Caméra</button>
      <span id="status" class="status"></span>
    </header>
    <div class="stage receive-stage">
      <video id="video" playsinline webkit-playsinline muted autoplay></video>
      <canvas id="overlay"></canvas>
      <div class="hud">
        <div class="hud-label" id="hudLabel">Caméra arrêtée</div>
        <div class="bar-track"><div class="bar-fill" id="barFill"></div></div>
        <div class="hud-meta" id="hudMeta">Appuie sur Caméra, puis vise le carré</div>
      </div>
      <a id="download" class="download" hidden></a>
    </div>
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

type Corners = [Point, Point, Point, Point];

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
let lastCorners: Corners | null = null;
let missStreak = 0;
let uiMode: "idle" | "search" | "lock" | "recv" | "done" = "idle";
let lastMeta = "";

document.querySelector("#start")!.addEventListener("click", () => {
  void startCamera();
});

function setProgress(pct: number, label: string, meta: string, mode: typeof uiMode): void {
  barFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (mode !== uiMode) {
    uiMode = mode;
    hudLabel.textContent = label;
  } else if (hudLabel.textContent !== label && (mode === "recv" || mode === "done")) {
    hudLabel.textContent = label;
  }
  if (meta !== lastMeta) {
    lastMeta = meta;
    hudMeta.textContent = meta;
  }
}

async function startCamera(): Promise<void> {
  const stream = await navigator.mediaDevices
    .getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
      },
    })
    .catch(async () =>
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, frameRate: { ideal: 60 } },
      }),
    );

  const track = stream.getVideoTracks()[0];
  if (track) {
    try {
      await track.applyConstraints({ frameRate: { ideal: 120 } });
    } catch {
      try {
        await track.applyConstraints({ frameRate: { ideal: 60 } });
      } catch {
        /* keep */
      }
    }
  }

  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.srcObject = stream;
  await video.play();
  running = true;
  t0 = performance.now();
  lastCorners = null;
  missStreak = 0;
  setProgress(4, "Recherche du cadre", "Les 4 coins colorés doivent être visibles", "search");

  const settings = track?.getSettings();
  const camFps = settings?.frameRate ? Math.round(settings.frameRate) : "?";
  statusEl.textContent = `${camFps} fps`;

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

    const found = detectFinders(image);
    let corners: Corners | null = null;
    if (found) {
      lastCorners = found;
      missStreak = 0;
      corners = found;
    } else if (lastCorners && missStreak < LOCK_HOLD) {
      missStreak++;
      corners = lastCorners;
    } else {
      lastCorners = null;
      missStreak = 0;
      const pct = decoder ? (decoder.solvedCount / decoder.k) * 100 : 6;
      setProgress(
        pct > 0 ? pct : 6,
        decoder ? `En pause ${pct.toFixed(0)}%` : "Recherche du cadre",
        decoder ? "Remets le carré dans le viseur" : "Cherche rouge / vert / bleu / jaune",
        decoder ? "recv" : "search",
      );
      return;
    }

    ctx.strokeStyle = missStreak > 0 ? "rgba(110,231,255,0.45)" : "#6ee7ff";
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
      setProgress(14, "Cadre verrouillé", "Lecture de l'en-tête…", "lock");
      return;
    }

    for (const pkt of packets) {
      if (decoder.uniqueEsi.has(pkt.esi)) continue;
      const before = decoder.solvedCount;
      decoder.ingest(pkt.esi, pkt.data);
      packetsOk++;
      if (decoder.solvedCount > before) bytesIngested = decoder.solvedCount * decoder.blockSize;
    }
    if (packets.length > 0) framesOk++;

    const pct = (decoder.solvedCount / decoder.k) * 100;
    const elapsed = (performance.now() - t0) / 1000;
    const mbps = elapsed > 0 ? (bytesIngested * 8) / elapsed / 1e6 : 0;

    if (pct > 0) {
      setProgress(
        pct,
        `Réception ${pct.toFixed(0)}%`,
        `${mbps.toFixed(2)} Mbit/s · ${packetsOk} paquets`,
        "recv",
      );
    } else {
      setProgress(16, "Cadre verrouillé", "En attente des premières données…", "lock");
    }

    if (decoder.done) await finish();
  } finally {
    busy = false;
  }
}

async function finish(): Promise<void> {
  if (!decoder) return;
  const assembled = decoder.assemble();
  if (!assembled) {
    setProgress(96, "Presque…", "Vérification, on continue", "recv");
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
  statusEl.textContent = "Prêt";
  const elapsed = (performance.now() - t0) / 1000;
  const mbps = (assembled.length * 8) / elapsed / 1e6;
  setProgress(100, "Terminé", `${elapsed.toFixed(1)}s · ${mbps.toFixed(2)} Mbit/s`, "done");
}
