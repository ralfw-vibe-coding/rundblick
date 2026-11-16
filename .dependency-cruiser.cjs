// Schichtregeln aus requirements/design.html, Abschnitt 2.
// Jede Regel verbietet eine Richtung; erlaubt ist, was nicht verboten ist.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'basis-ist-blatt', severity: 'error', comment: 'Reine Helfer hängen nur vom Schema ab.',
      from: { path: '^src/basis/' }, to: { path: '^src/', pathNot: ['^src/basis/', '^src/schema/'] } },
    { name: 'schema-ist-blatt', severity: 'error', comment: 'Das Schema sind reine Typen.',
      from: { path: '^src/schema/' }, to: { path: '^src/', pathNot: '^src/schema/' } },
    { name: 'client-kennt-nur-body-interface', severity: 'error',
      comment: 'Client kennt nur das Body interface (+ Schema-Typen, Basis).',
      from: { path: '^src/client/' },
      to: { path: '^src/', pathNot: ['^src/client/', '^src/body/interface\\.ts$', '^src/schema/', '^src/basis/'] } },
    { name: 'body-kennt-nur-interfaces', severity: 'error',
      comment: 'Body kennt Domain interface und Provider interfaces – keine Implementierungen.',
      from: { path: '^src/body/' },
      to: { path: '^src/', pathNot: ['^src/body/', '^src/domain/interface\\.ts$', '^src/providers/[^/]+/interface\\.ts$', '^src/schema/', '^src/basis/'] } },
    { name: 'domain-kennt-nur-eventstore', severity: 'error',
      comment: 'Domain kennt nur den Domain state provider (Event Store interface).',
      from: { path: '^src/domain/' },
      to: { path: '^src/', pathNot: ['^src/domain/', '^src/providers/eventstore/interface\\.ts$', '^src/schema/', '^src/basis/'] } },
    { name: 'provider-unabhaengig', severity: 'error',
      comment: 'Provider kennen nur ihr Interface, Schema und Basis.',
      from: { path: '^src/providers/([^/]+)/' },
      to: { path: '^src/', pathNot: ['^src/providers/$1/', '^src/schema/', '^src/basis/'] } },
    { name: 'kern-ohne-plattform', severity: 'error', comment: 'Body und Domain ohne Node/Electron.',
      from: { path: '^src/(body|domain|basis|schema)/', pathNot: '\\.test\\.ts$' }, to: { dependencyTypes: ['core'] } },
    { name: 'kern-ohne-electron', severity: 'error',
      from: { path: '^src/(body|domain|providers|basis|schema)/' }, to: { path: 'node_modules/electron' } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
