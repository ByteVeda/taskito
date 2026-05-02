import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Brokerless',
    description: (
      <>
        Start with SQLite, scale to Postgres. No Redis, RabbitMQ, or other
        broker to install, configure, or operate. Same code, three backends.
      </>
    ),
  },
  {
    title: 'Rust-powered',
    description: (
      <>
        The scheduler, dispatcher, and storage engine are all Rust. Async
        worker pool, native tokio runtime, and PyO3 bindings keep the
        Python boundary thin and fast.
      </>
    ),
  },
  {
    title: 'Python-native',
    description: (
      <>
        Decorate a function, get a task. Async tasks, periodic tasks, DAG
        workflows, resource injection, retries, rate limits, and a full
        observability stack — all from a clean Python API.
      </>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
