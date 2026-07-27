import React from 'react';

/**
 * Dernier filet de l'interface.
 *
 * React démonte tout l'arbre quand un rendu lève : sans ce garde-fou, un champ
 * absent dans une réponse de l'API — une clé manquante, un tableau devenu nul —
 * ne donne pas un message d'erreur mais une **page entièrement blanche**, sans
 * la moindre indication ni moyen de repartir.
 *
 * Il ne s'agit pas de masquer les défauts : l'erreur reste visible (repliée) pour
 * pouvoir être rapportée, et un bouton permet de recharger.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Trace dans la console du navigateur : c'est là qu'on ira la chercher.
    console.error('Erreur d’affichage :', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="center" style={{ padding: 24 }}>
        <div className="card card-pad" style={{ maxWidth: 560 }}>
          <div className="card-title">Quelque chose s’est mal passé</div>
          <p className="muted" style={{ marginTop: 0 }}>
            L’affichage de cette page a échoué. Tes données ne sont pas touchées — il s’agit
            d’un problème d’affichage, pas d’un problème de portefeuille.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <button className="btn" onClick={() => window.location.reload()}>Recharger la page</button>
            <button
              className="btn ghost"
              onClick={() => { window.location.hash = '#overview'; window.location.reload(); }}
            >
              Retour au portefeuille
            </button>
          </div>
          <details style={{ marginTop: 16 }}>
            <summary className="link-btn" style={{ cursor: 'pointer' }}>Détail technique</summary>
            <pre className="prompt-pre" style={{ marginTop: 10 }}>{String(error?.stack || error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
