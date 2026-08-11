import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="home">
    <h1>Pharos</h1>
    <p>Transfert de fichiers par la lumière. Écran d’un côté, caméra de l’autre. Pas de réseau entre les deux.</p>
    <p class="target">Même carré (~560 px). Modules noir/blanc + coins colorés, calé pour que l'iPhone lise vraiment.</p>
    <div class="actions">
      <a class="btn" href="/send/">Envoyer</a>
      <a class="btn btn-secondary" href="/receive/">Recevoir</a>
    </div>
  </main>
`;
