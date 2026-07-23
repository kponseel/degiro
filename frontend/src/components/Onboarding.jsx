import { useState } from 'react';
import Uploader from './Uploader.jsx';

/**
 * Parcours de bienvenue d'un compte sans données : guide l'utilisateur pour
 * attacher son premier portefeuille (et, en option, son relevé de compte).
 * @param onFinished  appelé après le premier import de portefeuille réussi
 * @param onSkip      « Explorer d'abord » — entre dans l'app sans importer
 */
export default function Onboarding({ user, onFinished, onSkip }) {
  const [portfolioDone, setPortfolioDone] = useState(false);

  return (
    <div className="gate" style={{ alignItems: 'flex-start', paddingTop: 48 }}>
      <div className="card card-pad" style={{ maxWidth: 640, width: '100%' }}>
        <div className="brand" style={{ padding: 0, marginBottom: 6 }}>
          <span className="brand-mark">DEGIRO Analyzer</span>
          <span className="brand-sub">Bienvenue</span>
        </div>
        <h2 style={{ margin: '10px 0 4px' }}>Bienvenue {user?.pseudo} 👋</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Ton compte est prêt — il ne lui manque que tes données. Deux étapes et c'est parti.
        </p>

        <ol className="onboard-steps">
          <li className={portfolioDone ? 'done' : ''}>
            <div className="step-head">
              <span className="step-num">{portfolioDone ? '✓' : '1'}</span>
              <div>
                <strong>Exporte ton portefeuille depuis DEGIRO</strong>
                <div className="muted step-hint">
                  Site DEGIRO → <em>Portefeuille</em> → bouton <em>Exporter</em> (en haut à droite) → format <strong>CSV</strong>.
                  Toute langue acceptée.
                </div>
              </div>
            </div>
          </li>
          <li className={portfolioDone ? 'done' : ''}>
            <div className="step-head">
              <span className="step-num">{portfolioDone ? '✓' : '2'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>Importe-le ici</strong>
                <div style={{ marginTop: 10 }}>
                  <Uploader
                    hint="auto"
                    title="Portefeuille (positions)"
                    description="Portfolio.csv — tes lignes actuelles"
                    onDone={(res) => { if (res.kind === 'portfolio') setPortfolioDone(true); }}
                  />
                </div>
              </div>
            </div>
          </li>
          <li>
            <div className="step-head">
              <span className="step-num">3</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>Optionnel : ton relevé de compte</strong>
                <div className="muted step-hint">
                  Account.csv (DEGIRO → <em>Activité</em> → <em>Relevés</em>) active les <strong>dividendes</strong> et
                  la <strong>vraie performance (TWR)</strong>. Tu pourras le faire plus tard depuis Import / Réglages.
                </div>
                <div style={{ marginTop: 10 }}>
                  <Uploader hint="auto" title="Relevé de compte" description="Account.csv — dépôts, dividendes, frais" />
                </div>
              </div>
            </div>
          </li>
        </ol>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          {portfolioDone ? (
            <button className="btn" onClick={onFinished}>Voir mon portefeuille →</button>
          ) : (
            <button className="btn ghost" onClick={onSkip}>Explorer d'abord, importer plus tard</button>
          )}
        </div>
      </div>
    </div>
  );
}