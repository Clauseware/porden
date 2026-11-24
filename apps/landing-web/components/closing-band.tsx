import { Illo } from './illo';
import { LANDING_LINKS } from './landing-links';

export function ClosingBand() {
  return (
    <section className="wrap closing" id="start" aria-labelledby="start-title">
      <div className="well closing__well">
        <div className="closing__copy">
          <h2 id="start-title">Send your first handoff</h2>
          <p className="lead">
            Create a task for another organization, lock its terms, and keep every decision in one
            history.
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
        <Illo name="handoff-transfer" />
      </div>
    </section>
  );
}
