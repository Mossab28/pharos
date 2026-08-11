import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="home">
    <h1>Pharos</h1>
    <p>Transfert de fichiers par la lumière. Écran d’un côté, caméra de l’autre. Pas de réseau entre les deux.</p>
    <p class="target">Même carré (~560 px). Envoi jusqu'à 120 Hz écran, caméra en 60 fps (120 si dispo).</p>
    <div class="actions">
      <a class="btn" href="/send/">Envoyer</a>
      <a class="btn btn-secondary" href="/receive/">Recevoir</a>
    </div>
  </main>
`;
