import "../style.css";
import { packBands } from "../shared/band";
import { maybeCompress } from "../shared/compress";
import { crc32 } from "../shared/crc32";
import { encodePacket, packMeta, splitBlocks, type FountainHeader } from "../shared/fountain";
import { renderBands } from "../shared/frame";
import {
  DISPLAY_CSS_PX,
  outerSize,
  PROFILES,
  resolveLayout,
  type ProfileId,
} from "../shared/profile";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main class="page send-page">
    <header class="bar">
      <a href="/">Pharos</a>
      <label class="field">
        <span>Profil</span>
        <select id="profile">
          <option value="fast" selected>Fast</option>
          <option value="robust">Robust</option>
        </select>
      </label>
      <button id="pick" type="button">Choisir un fichier</button>
      <input id="file" type="file" hidden />
      <span id="status" class="status"></span>
    </header>
    <div class="stage">
      <canvas id="frame"></canvas>
    </div>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#frame")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const profileSel = document.querySelector<HTMLSelectElement>("#profile")!;
const fileInput = document.querySelector<HTMLInputElement>("#file")!;

let stop: (() => void) | null = null;

document.querySelector("#pick")!.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  stop?.();
  stop = await startSend(file, profileSel.value as ProfileId);
});

profileSel.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  stop?.();
  void startSend(file, profileSel.value as ProfileId).then((s) => {
    stop = s;
  });
});

async function startSend(file: File, profileId: ProfileId): Promise<() => void> {
  const profile = PROFILES[profileId];
  const raw = new Uint8Array(await file.arrayBuffer());
  const { bytes, gzipped } = await maybeCompress(raw);
  const name = gzipped ? `${file.name}.gz` : file.name;
  const nameBytes = new TextEncoder().encode(name.slice(0, 48));
  const streamId = (Math.random() * 0xffffffff) >>> 0;

  const headerProbe: FountainHeader = {
    streamId,
    blockCount: 1,
    blockSize: 1,
    fileSize: bytes.length,
    fileCrc: crc32(bytes),
    nameBytes,
  };
  const headerLen = packMeta(headerProbe).length;
  const { bandCount, blockSize, useful } = resolveLayout(profile, headerLen);

  const blocks = splitBlocks(bytes, blockSize);
  const header: FountainHeader = {
    streamId,
    blockCount: blocks.length,
    blockSize,
    fileSize: bytes.length,
    fileCrc: crc32(bytes),
    nameBytes,
  };

  const mbps120 = ((useful * 8 * 120) / 1e6).toFixed(0);
  const mbps60 = ((useful * 8 * 60) / 1e6).toFixed(0);
  statusEl.textContent = `${name} · ${useful} o/frame · ${bandCount} bandes · ~${mbps60}/${mbps120} Mbit/s @60/120Hz`;

  let esi = 0;
  let frameSeq = 0;
  let alive = true;
  // Render sharper than CSS size so cells survive downscale + camera.
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const ppc = Math.max(2, Math.round((DISPLAY_CSS_PX * dpr) / outerSize(profile)));
  canvas.style.width = `${DISPLAY_CSS_PX}px`;
  canvas.style.height = `${DISPLAY_CSS_PX}px`;

  const tick = () => {
    if (!alive) return;
    const packets = [];
    for (let i = 0; i < bandCount; i++) {
      packets.push({ esi, data: encodePacket(blocks, esi).data });
      esi++;
    }
    const bands = packBands(profile, header, packets);
    renderBands(canvas, profile, bands, ppc, frameSeq);
    frameSeq++;
  };

  // One optical frame per display refresh (60/120 Hz).
  let raf = 0;
  const loop = () => {
    if (!alive) return;
    tick();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
  };
}
