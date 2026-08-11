import "../style.css";
import { unpackBands } from "../shared/band";
import { gzipDecompress } from "../shared/compress";
import { FountainDecoder } from "../shared/fountain";
import { sampleBands } from "../shared/frame";
import type { Point } from "../shared/geometry";
import { PROFILES, type ProfileId } from "../shared/profile";
import { detectFinders } from "./detect";

/** Decode at most this often. Full sample every camera frame freezes Mobile Safari. */
const DECODE_HZ = 10;
const PROCESS_MAX = 480;
const LOCK_HOLD = 8;

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
const wctx = work.getContext("2d", { willReadFrequently: true, alpha: false })!;

type Corners = [Point, Point, Point, Point];

let decoder: FountainDecoder | null = null;
let metaName = "file.bin";
let streamId: number | null = null;
let running = false;
let busy = false;
let packetsOk = 0;
let t0 = 0;
let bytesIngested = 0;
let lastCorners: Corners | null = null;
let missStreak = 0;
let uiMode: "idle" | "search" | "lock" | "recv" | "done" = "idle";
let lastMeta = "";
let timer: number | null = null;
let overlaySized = false;

document.querySelector("#start")!.addEventListener("click", () => {
  void startCamera();
});

function setProgress(pct: number, label: string, meta: string, mode: typeof uiMode): void {
  barFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (mode !== uiMode || hudLabel.textContent !== label) {
    uiMode = mode;
    hudLabel.textContent = label;
  }
  if (meta !== lastMeta) {
    lastMeta = meta;
    hudMeta.textContent = meta;
  }
}

async function startCamera(): Promise<void> {
  // Keep the preview light on iPhone: 720p / 30 fps is enough for mono modules.
  const stream = await navigator.mediaDevices
    .getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    })
    .catch(async () =>
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      }),
    );

  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.srcObject = stream;
  await video.play();
  running = true;
  t0 = performance.now();
  lastCorners = null;
  missStreak = 0;
  overlaySized = false;
  setProgress(4, "Recherche du cadre", "Les 4 coins colorés doivent être visibles", "search");

  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings();
  statusEl.textContent = settings?.frameRate ? `${Math.round(settings.frameRate)} fps` : "";

  if (timer != null) window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (!running || busy) return;
    void tick();
  }, 1000 / DECODE_HZ);
}

async function tick(): Promise<void> {
  const profile = PROFILES[profileSel.value as ProfileId];
  if (video.readyState < 2) return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  busy = true;
  try {
    const scale = Math.min(1, PROCESS_MAX / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    if (work.width !== w || work.height !== h) {
      work.width = w;
      work.height = h;
    }
    wctx.drawImage(video, 0, 0, w, h);
    const image = wctx.getImageData(0, 0, w, h);

    if (!overlaySized || overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
      overlaySized = true;
    }
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
    const { header, packets, okBands, headerOk } = unpackBands(bandBytes);

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
      setProgress(
        headerOk ? 20 : 12,
        "Cadre verrouillé",
        headerOk ? `En-tête ok · ${okBands}/${bandCount}` : `Pas encore de données · ${okBands}/${bandCount}`,
        "lock",
      );
      return;
    }

    for (const pkt of packets) {
      if (decoder.uniqueEsi.has(pkt.esi)) continue;
      const before = decoder.solvedCount;
      decoder.ingest(pkt.esi, pkt.data);
      packetsOk++;
      if (decoder.solvedCount > before) bytesIngested = decoder.solvedCount * decoder.blockSize;
    }

    const pct = (decoder.solvedCount / decoder.k) * 100;
    const elapsed = (performance.now() - t0) / 1000;
    const mbps = elapsed > 0 ? (bytesIngested * 8) / elapsed / 1e6 : 0;

    if (pct > 0) {
      setProgress(pct, `Réception ${pct.toFixed(0)}%`, `${mbps.toFixed(2)} Mbit/s · ${packetsOk} paquets`, "recv");
    } else {
      setProgress(
        18,
        "Cadre verrouillé",
        okBands > 0 ? `Données en cours · ${okBands}/${bandCount}` : `0 paquet valide · reste stable`,
        "lock",
      );
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
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
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
