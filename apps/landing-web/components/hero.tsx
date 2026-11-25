import { HeroVortex } from './hero-vortex';
import { Illo } from './illo';
import { LANDING_LINKS } from './landing-links';
import { CheckCircleIcon, PendingIcon, RunningIcon } from './icons';

export function Hero() {
  return (
    <section className="hero wrap" aria-labelledby="hero-title">
      <HeroVortex />
      <div className="hero__copy" data-vortex-calm>
        <h1 id="hero-title">Hand off tasks between organizations on exact terms</h1>
        <p className="lead">
          Porden moves a task from one organization to another. Each handoff has a locked version, a
          human approval step when the sender requires it, and a signed receipt. A receipt means
          accepted, not resolved.
        </p>
        <div className="actions">
          <a className="btn btn--primary" href={LANDING_LINKS.getStarted}>
            Get started
          </a>
          <a className="btn btn--quiet" href="#how">
            See how it works
          </a>
        </div>
      </div>
      <div className="hero__stage">
        <div className="well hero__well">
          <Illo name="handoff-stage" className="illo--hero" />
        </div>
        <figure className="runs">
          <figcaption className="runs__title">Illustration. Not live data.</figcaption>
          <ul>
            <li>
              <CheckCircleIcon />
              <strong>Locked version</strong>
              <span>Terms fixed</span>
            </li>
            <li>
              <CheckCircleIcon />
              <strong>Human approval</strong>
              <span>If required</span>
            </li>
            <li className="is-live">
              <RunningIcon />
              <strong>Receiver accepts</strong>
              <span>Waiting</span>
            </li>
            <li>
              <PendingIcon />
              <strong>Signed receipt</strong>
              <span>After acceptance</span>
            </li>
          </ul>
        </figure>
      </div>
      <dl className="figures" data-vortex-calm>
        <div>
          <dt>Locked versions</dt>
          <dd>The terms of a version never change. A change creates a new version.</dd>
        </div>
        <div>
          <dt>Approval set by the sender</dt>
          <dd>The sender’s policy decides whether a human approves the exact terms.</dd>
        </div>
        <div>
          <dt>Signed receipts</dt>
          <dd>Each recorded action gets a signed receipt that names the exact version.</dd>
        </div>
      </dl>
    </section>
  );
}
